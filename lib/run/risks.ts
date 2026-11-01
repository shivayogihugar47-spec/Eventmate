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

export async function generateRisks(plan: RunPlan): Promise<PlanRisk[]> {
  const month = Number(plan.eventDate.slice(5, 7));
  const season = month >= 3 && month <= 5 ? "hot season"
    : month >= 6 && month <= 9 ? "monsoon"
    : month >= 10 && month <= 11 ? "post-monsoon"
    : "cool season";
  const outdoor = Boolean(plan.constraints?.outdoor)
    || /outdoor|garden|open air|beach|field/i.test(`${plan.venueStyle ?? ""} ${plan.theme ?? ""}`);
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
  const taskIds = new Set(plan.timeline.map((task) => task.id));

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
}

export function matchPreparedRisks(risks: PlanRisk[], triggerTypes: string[]): PlanRisk[] {
  const normalized = new Set(triggerTypes.map((type) => type.toUpperCase()));
  return risks.filter((risk) => risk.status !== "dismissed" && normalized.has(risk.triggerType));
}
