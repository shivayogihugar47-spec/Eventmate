import { z } from "zod";
import { llmJson } from "@/lib/llm";
import { matchPreparedRisks } from "./risks";
import { OperationSchema, type ImpactReport, type PlanRisk, type RunChange, type RunOption, type RunPlan } from "./types";

const OptionsSchema = z.object({
  options: z.array(z.object({
    title: z.string().min(4).max(120),
    operations: z.array(OperationSchema).min(1).max(12),
    tradeoffs: z.array(z.string().max(240)).min(1).max(5),
    rupeeImpact: z.number().int().min(-1_000_000_000).max(1_000_000_000),
  })).min(2).max(3),
});

export async function generateOptions(input: {
  plan: RunPlan;
  changes: RunChange[];
  impact: ImpactReport;
  risks: PlanRisk[];
  priorities: string[];
  constraints: string[];
  retryReasons?: string[];
  usePrepared?: boolean;
}): Promise<RunOption[]> {
  const prepared = input.usePrepared === false ? [] : matchPreparedRisks(input.risks, input.changes.map((change) => change.type));
  if (prepared.length > 0) {
    return [{
      title: `Plan B ready: ${prepared[0].title}`,
      operations: prepared[0].backupAction,
      tradeoffs: ["Uses the contingency prepared for this event."],
      rupeeImpact: 0,
      source: "prepared",
    }];
  }

  const result = await llmJson(
    `You are an event operations option generator. Return 2 or 3 ranked alternatives. ` +
      `Only propose structured operations: shift, shorten, parallelize, drop, swap_vendor, reassign, add_task. ` +
      `Never edit the event plan directly. Refer only to task IDs present in the plan. ` +
      `Respect dependencies, hard constraints and the organizer's priorities. ` +
      `rupeeImpact is the signed net INR change; use a negative amount for savings. ` +
      `Include plain-language tradeoffs. ${input.retryReasons?.length ? `Previous options failed verification: ${input.retryReasons.join("; ")}. Correct these failures.` : ""}`,
    [{
      role: "user",
      content: JSON.stringify({
        plan: input.plan,
        changes: input.changes,
        impact: input.impact,
        priorities: input.priorities,
        constraints: input.constraints,
      }),
    }],
    OptionsSchema,
  );
  return result.options.map((option) => ({ ...option, source: "generated" as const }));
}
