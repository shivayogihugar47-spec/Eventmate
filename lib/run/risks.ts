import { z } from "zod";
import { llmJson } from "@/lib/llm";
import { OperationSchema, type PlanRisk, type RunPlan } from "./types";

const RiskSchema = z.object({
  risks: z.array(z.object({
    title: z.string().min(4).max(120),
    triggerType: z.enum(["DELAY", "VENDOR_CANCELLED", "VENDOR_REPLACED", "GUEST_COUNT", "BUDGET", "DATE_MOVE", "VENUE_ISSUE", "WEATHER", "TASK_DONE"]),
    likelihood: z.enum(["low", "medium", "high"]),
    backupAction: z.array(OperationSchema).min(1).max(8),
  })).length(5),
});

function fallbackRisks(plan: RunPlan): PlanRisk[] {
  const firstTask = plan.timeline[0];
  const vendorTask = plan.timeline.find((task) => task.vendorName) ?? firstTask;
  const outdoorTask = plan.timeline.find((task) => /outdoor|garden|stage|ceremony|setup/i.test(task.task)) ?? firstTask;
  const lastTask = plan.timeline[plan.timeline.length - 1];
  if (!firstTask || !vendorTask || !outdoorTask || !lastTask) {
    throw new Error("Cannot prepare event contingencies without scheduled tasks.");
  }

  const risks: PlanRisk[] = [
    {
      title: `Delay affecting ${firstTask.task}`,
      triggerType: "DELAY",
      likelihood: "medium",
      backupAction: [{ type: "shift", taskId: firstTask.id, minutes: 15 }],
      status: "ready",
    },
    {
      title: `Vendor cancellation for ${vendorTask.task}`,
      triggerType: "VENDOR_CANCELLED",
      likelihood: "medium",
      backupAction: [{
        type: "swap_vendor",
        taskId: vendorTask.id,
        vendorName: "Backup vendor to confirm",
        costDelta: 0,
      }],
      status: "ready",
    },
    {
      title: `Guest surge beyond ${plan.guestCount} attendees`,
      triggerType: "GUEST_COUNT",
      likelihood: "low",
      backupAction: [{
        type: "add_task",
        task: "Prepare additional guest capacity",
        startAt: firstTask.startAt,
        durationMin: 15,
        owner: "Event coordinator",
        dependsOn: [],
      }],
      status: "ready",
    },
    {
      title: `${plan.constraints?.outdoor ? "Rain plan for outdoor event" : "Weather disruption plan"} near ${outdoorTask.task}`,
      triggerType: "WEATHER",
      likelihood: plan.constraints?.outdoor ? "high" : "low",
      backupAction: [{ type: "reassign", taskId: outdoorTask.id, owner: "Weather contingency lead" }],
      status: "ready",
    },
    {
      title: `Venue access issue affecting ${lastTask.task}`,
      triggerType: "VENUE_ISSUE",
      likelihood: "low",
      backupAction: [{ type: "reassign", taskId: lastTask.id, owner: "Venue coordinator" }],
      status: "ready",
    },
  ];

  return risks.map((risk) => ({
    ...risk,
    id: crypto.randomUUID(),
  }));
}

export async function generateRisks(plan: RunPlan): Promise<PlanRisk[]> {
  const month = Number(plan.eventDate.slice(5, 7));
  const season = month >= 3 && month <= 5 ? "hot season"
    : month >= 6 && month <= 9 ? "monsoon"
    : month >= 10 && month <= 11 ? "post-monsoon"
    : "cool season";
  const outdoor = Boolean(plan.constraints?.outdoor)
    || /outdoor|garden|open air|beach|field/i.test(`${plan.venueStyle ?? ""} ${plan.theme ?? ""}`);
  const taskIds = new Set(plan.timeline.map((task) => task.id));
  try {
    const result = await llmJson(
      `You are a contingency planner. Return exactly five event-specific risks for this event. ` +
        `Consider event type, ${season}, ${outdoor ? "outdoor" : "indoor"} setting, guest count, and vendors. ` +
        `Every backupAction must be one or more valid structured operations using only existing task IDs: ` +
        `shift, shorten, parallelize, drop, swap_vendor, reassign, or add_task. ` +
        `Prefer vendor replacement for cancellations, shift for delays, and schedule adjustments for weather or venue issues. ` +
        `Never invent task IDs. Use one matching triggerType per risk.`,
      [{
        role: "user",
        content: JSON.stringify({
          eventType: plan.eventType,
          eventDate: plan.eventDate,
          season,
          outdoor,
          guestCount: plan.guestCount,
          venue: plan.venueStyle,
          tasks: plan.timeline.map(({ id, task, vendorName, startAt, durationMin }) => ({ id, task, vendorName, startAt, durationMin })),
        }),
      }],
      RiskSchema,
    );

    return result.risks.map((risk) => {
      const backupAction = risk.backupAction.filter((operation) =>
        operation.type === "add_task"
          ? operation.dependsOn.every((id) => taskIds.has(id))
          : taskIds.has(operation.taskId)
            && (operation.type !== "parallelize" || taskIds.has(operation.withTaskId)),
      );
      if (backupAction.length === 0) {
        throw new Error(`The contingency "${risk.title}" did not include a valid action for this plan.`);
      }
      return { ...risk, backupAction, status: "ready" as const };
    });
  } catch (error) {
    console.warn("[RUN risks] AI contingencies were invalid; using task-linked fallback risks.", error);
    return fallbackRisks(plan);
  }
}

export function matchPreparedRisks(risks: PlanRisk[], triggerTypes: string[]): PlanRisk[] {
  const normalized = new Set(triggerTypes.map((type) => type.toUpperCase()));
  return risks.filter((risk) => risk.status !== "dismissed" && normalized.has(risk.triggerType));
}
