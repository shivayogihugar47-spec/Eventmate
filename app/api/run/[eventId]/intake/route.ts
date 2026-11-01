import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "@/lib/db";
import { analyzeImpact, applyChanges } from "@/lib/run/impact";
import { parseChangeText, parseQuickChange } from "@/lib/run/intake";
import { generateOptions } from "@/lib/run/options";
import { verifyOptions, deterministicShiftOption } from "@/lib/run/verify";
import { consumeRateLimit, loadOwnedOrganizerRun, rateLimitIdentity } from "@/lib/run/security";
import type { PlanRisk, RunChange, RunOption } from "@/lib/run/types";
import { commitPlanVersion, RunApiError } from "@/lib/run/apply";
import { isUuid, parseJsonBody } from "@/lib/apiRequest";

const RequestSchema = z.object({
  version: z.number().int().positive(),
  text: z.string().max(1200).optional(),
  action: z.enum(["delay-15", "delay-30", "task-done", "vendor-cancelled", "more-guests", "rain", "venue-issue"]).optional(),
  taskId: z.string().uuid().optional(),
  idempotencyKey: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/).optional(),
}).refine((value) => Boolean(value.text?.trim()) !== Boolean(value.action), {
  message: "Provide either a change description or a quick action.",
});

type RouteContext = { params: Promise<{ eventId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  if (!isUuid(eventId)) return NextResponse.json({ error: "Event not found." }, { status: 404 });
  const parsedBody = await parseJsonBody(request, RequestSchema, 8 * 1024);
  if (!parsedBody.success) {
    return NextResponse.json({ error: parsedBody.error }, { status: parsedBody.status });
  }

  const body = parsedBody.data;
  try {
    if (!await consumeRateLimit(`${eventId}:${rateLimitIdentity(request)}:intake`, 12)) {
      return NextResponse.json({ error: "Too many change requests. Please wait a minute and try again." }, { status: 429 });
    }
    const run = await loadOwnedOrganizerRun(request, eventId);
    if (run.version !== body.version) {
      const taskAlreadyDone = body.action === "task-done"
        && body.taskId
        && run.plan.timeline.some((task) => task.id === body.taskId && task.status === "done");
      if (taskAlreadyDone) {
        return NextResponse.json({ completedTask: true, version: run.version, plan: run.plan });
      }
      return NextResponse.json({ error: "The plan changed. Refresh to see the latest version.", stale: true }, { status: 409 });
    }

    let changes: RunChange[] = [];
    let clarifyingQuestion: string | null = null;
    if (body.action) {
      const change = parseQuickChange(body.action, run.plan);
      if (!change) return NextResponse.json({ error: "That quick action is not available." }, { status: 400 });
      if (body.taskId && ["delay-15", "delay-30", "task-done", "vendor-cancelled"].includes(body.action)) change.taskId = body.taskId;
      if (body.action === "vendor-cancelled" && !change.taskId) {
        return NextResponse.json({ error: "Choose the task whose vendor cancelled." }, { status: 400 });
      }
      if (body.action === "task-done" && !change.taskId) {
        return NextResponse.json({ error: "Choose the task you completed." }, { status: 400 });
      }
      changes = [change];
    } else {
      const parsed = await parseChangeText(body.text ?? "", run.plan);
      changes = parsed.changes;
      clarifyingQuestion = parsed.clarifyingQuestion;
    }

    if (clarifyingQuestion) {
      await sql`INSERT INTO plan_events (event_id, type, payload, actor)
        VALUES (${run.eventId}, 'CLARIFICATION', ${JSON.stringify({ question: clarifyingQuestion, input: body.text })}, 'organizer')`;
      return NextResponse.json({ clarifyingQuestion });
    }

    if (changes.length === 1 && changes[0].type === "TASK_DONE" && changes[0].taskId) {
      const task = run.plan.timeline.find((entry) => entry.id === changes[0].taskId);
      if (!task) return NextResponse.json({ error: "That task is not in this plan." }, { status: 400 });
      if (task.status === "done") {
        return NextResponse.json({ completedTask: true, version: run.version, plan: run.plan });
      }
      const change = { ...changes[0], actualAt: new Date().toISOString() };
      const result = await commitPlanVersion({
        eventId: run.eventId,
        expectedVersion: run.version,
        idempotencyKey: body.idempotencyKey ?? crypto.randomUUID(),
        plan: applyChanges(run.plan, [change]),
        changes: [change],
        note: `Task completed: ${task.task}`,
        actor: "organizer",
      });
      return NextResponse.json({ completedTask: true, version: result.version, plan: result.plan });
    }

    await Promise.all(changes.map((change) => sql`INSERT INTO plan_events (event_id, type, payload, actor)
      VALUES (${run.eventId}, ${change.type}, ${JSON.stringify(change)}, 'organizer')`));

    const impact = analyzeImpact(run.plan, changes);
    const risksRows = await sql`SELECT id, title, trigger_type, likelihood, backup_action, status
      FROM risks WHERE event_id = ${run.eventId} AND status IN ('ready', 'triggered')`;
    const risks: PlanRisk[] = risksRows.map((risk) => ({
      id: String(risk.id),
      title: String(risk.title),
      triggerType: String(risk.trigger_type) as PlanRisk["triggerType"],
      likelihood: String(risk.likelihood) as PlanRisk["likelihood"],
      backupAction: risk.backup_action as PlanRisk["backupAction"],
      status: risk.status as PlanRisk["status"],
    }));
    const priorities = Array.isArray(run.answers.priorities) ? run.answers.priorities.map(String) : [];
    const constraints = [
      run.plan.constraints?.venueClosesAt ? `Venue closes at ${run.plan.constraints.venueClosesAt}` : "",
      run.plan.constraints?.eventEndsAt ? `Event ends at ${run.plan.constraints.eventEndsAt}` : "",
    ].filter(Boolean);

    let options: RunOption[];
    try {
      options = await generateOptions({ plan: run.plan, changes, impact, risks, priorities, constraints });
    } catch (error) {
      if (!(error instanceof z.ZodError)) throw error;
      console.warn("[/api/run intake] Option output failed validation; trying a deterministic schedule-only fallback.", error.issues);
      const fallback = deterministicShiftOption(run.plan, changes, impact);
      if (!fallback) throw error;
      options = [fallback];
    }
    let verification = verifyOptions(run.plan, changes, impact, options);
    if (verification.verified.length === 0) {
      options = await generateOptions({
        plan: run.plan, changes, impact, risks, priorities, constraints,
        retryReasons: verification.failures, usePrepared: false,
      });
      verification = verifyOptions(run.plan, changes, impact, options);
    }
    if (verification.verified.length === 0) {
      const fallback = deterministicShiftOption(run.plan, changes, impact);
      if (fallback) verification = verifyOptions(run.plan, changes, impact, [fallback]);
    }
    if (verification.verified.length === 0) {
      return NextResponse.json({
        error: "I couldn't find a safe verified adjustment. Your plan is unchanged; refine the update and try again.",
        reasons: verification.failures,
      }, { status: 422 });
    }

    const payload = {
      changes,
      impact,
      options: verification.verified.map(({ title, operations, tradeoffs, rupeeImpact, source }) => ({
        title, operations, tradeoffs, rupeeImpact, source,
      })),
      verified: verification.verified,
    };
    const proposals = await sql`INSERT INTO run_proposals (event_id, source_version, payload)
      VALUES (${run.eventId}, ${run.version}, ${JSON.stringify(payload)}::jsonb) RETURNING id`;
    return NextResponse.json({
      proposalId: proposals[0].id,
      version: run.version,
      changes,
      impact,
      options: verification.verified.map(({ plan: optionPlan, report, ...option }) => ({
        ...option,
        report,
        plan: optionPlan,
      })),
    });
  } catch (error) {
    if (error instanceof RunApiError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) {
      console.error("[/api/run intake] Pipeline data failed schema validation.", error.issues);
      return NextResponse.json({
        error: "I couldn't safely validate an adjustment for that update. Your input is still here—please retry.",
      }, { status: 503 });
    }
    console.error("[/api/run intake]", error);
    return NextResponse.json({ error: "I couldn't safely prepare that change. Your input is still here—please retry." }, { status: 503 });
  }
}
