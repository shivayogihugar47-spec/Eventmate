import { z } from "zod";
import { sql } from "@/lib/db";
import { llmJson } from "@/lib/llm";
import type { EventPlan } from "@/app/api/chat/route";

const ReplanSchema = z.object({
  changes: z.array(z.object({
    field: z.string(),
    oldValue: z.string(),
    newValue: z.string(),
  })),
  tradeOffs: z.array(z.object({
    category: z.string(),
    impact: z.string(),
    reason: z.string(),
    rupeeImpact: z.number(),
  })),
  suggestedPlan: z.object({
    eventType: z.string(),
    eventDate: z.string(),
    guestCount: z.number(),
    city: z.string(),
    budgetTotal: z.number(),
    theme: z.string(),
    highlights: z.array(z.string()),
    timeline: z.array(z.any()),
    budgetBreakdown: z.array(z.any()),
    vendors: z.array(z.any()),
    checklist: z.array(z.any()),
  }),
});

export interface ReplanDiff {
  changes: { field: string; old: string; new: string }[];
  budgetDiff: { category: string; before: number; after: number; reason: string }[];
  taskDiff: { task: string; type: "added" | "removed" | "moved"; reason: string }[];
  suggestedPlan: EventPlan;
}

const REPLAN_SYSTEM = `You are an expert event strategist. The user is changing their event parameters.

Extract changes to: budget, date, guest count, or priorities. Propose trade-offs that respect the
user's priorities — cut lower-priority categories FIRST and never drop the user's top priority
below 90% of its current allocation.

Respond with a single JSON object using EXACTLY this shape (camelCase keys, nothing else):

{
  "changes": [
    { "field": string, "oldValue": string, "newValue": string }
  ],
  "tradeOffs": [
    {
      "category": string,      // must match a category in the current plan's budgetBreakdown
      "impact": string,        // short human-readable description of the change
      "reason": string,        // why this category is the right one to adjust
      "rupeeImpact": number    // signed INR delta: negative to cut, positive to add
    }
  ],
  "suggestedPlan": {}          // a COMPLETE plan object with exactly the same keys and
                               // nested item shape as the "Current Plan" shown below
}

The suggestedPlan must be the full plan (not a partial patch). "guestCount" and "budgetTotal"
are numbers. Keep every array non-empty and keep budgetBreakdown[].allocated summing to the new budget.`;

export async function handleReplan(eventId: string, userMessage: string): Promise<ReplanDiff> {
  // 1. Fetch current plan (latest version)
  const rows = await sql`SELECT plan FROM plan_versions WHERE event_id = ${eventId} ORDER BY version DESC LIMIT 1`;
  const currentPlan = rows[0]?.plan as EventPlan;

  if (!currentPlan) throw new Error("No existing plan to re-plan.");

  // 2. Fetch answers (for priorities)
  const eventRows = await sql`SELECT answers FROM events WHERE id = ${eventId}`;
  const answers = eventRows[0]?.answers || {};
  const priorities = answers.priorities || [];

  // 3. Call LLM to extract changes and propose trade-offs
  const res = await llmJson(
    REPLAN_SYSTEM,
    [
      { role: "system", content: `Current Plan: ${JSON.stringify(currentPlan)}\nPriorities: ${priorities.join(", ")}` },
      { role: "user", content: userMessage }
    ],
    ReplanSchema
  );

  // 4. Generate Diff
  const budgetDiff = res.tradeOffs.map(t => {
    const before = currentPlan.budgetBreakdown.find(b => b.category === t.category)?.allocated || 0;
    
    // Priority floor heuristic: Top priority category should not drop more than 10%
    let after = before + t.rupeeImpact;
    const isTopPriority = priorities[0] === t.category;
    if (isTopPriority && after < before * 0.9 && t.rupeeImpact < 0) {
      after = Math.round(before * 0.9);
    }

    return {
      category: t.category,
      before,
      after,
      reason: t.reason,
    };
  });

  // Task diff logic
  const taskDiff: ReplanDiff["taskDiff"] = [];
  const oldTasks = currentPlan.checklist.map(c => c.task);
  const newTasks = (res.suggestedPlan as EventPlan).checklist.map(c => c.task);

  // Added tasks
  newTasks.forEach(t => {
    if (!oldTasks.includes(t)) {
      taskDiff.push({ task: t, type: "added", reason: "Required for new plan parameters" });
    }
  });

  // Removed tasks
  oldTasks.forEach(t => {
    if (!newTasks.includes(t)) {
      taskDiff.push({ task: t, type: "removed", reason: "No longer fits budget/timeline" });
    }
  });

  // Moved tasks (date changed)
  (res.suggestedPlan as EventPlan).checklist.forEach(newTask => {
    const oldTask = currentPlan.checklist.find(c => c.task === newTask.task);
    if (oldTask && oldTask.dueDate !== newTask.dueDate) {
      taskDiff.push({ task: newTask.task, type: "moved", reason: `Rescheduled from ${oldTask.dueDate} to ${newTask.dueDate}` });
    }
  });
  
  // 5. Construct ReplanDiff
  const diff: ReplanDiff = {
    changes: res.changes.map(c => ({ field: c.field, old: c.oldValue, new: c.newValue })),
    budgetDiff,
    taskDiff,
    suggestedPlan: res.suggestedPlan as EventPlan,
  };

  return diff;
}

export async function commitReplan(eventId: string, suggestedPlan: EventPlan, note: string) {
  console.log(`Committing replan for event: ${eventId}, note: ${note}`);
  const rows = await sql`SELECT MAX(version) as max_v FROM plan_versions WHERE event_id = ${eventId}`;
  const nextVersion = (rows[0]?.max_v || 0) + 1;

  await sql`INSERT INTO plan_versions (event_id, version, plan, change_note) 
            VALUES (${eventId}, ${nextVersion}, ${JSON.stringify(suggestedPlan)}, ${note})`;
  
  // Also update the main answers in case budget/date/etc changed
  const answersUpdate: Record<string, string | number> = {};
  if (suggestedPlan.eventDate) answersUpdate.eventDate = suggestedPlan.eventDate;
  if (suggestedPlan.budgetTotal) answersUpdate.budgetTotal = `₹${suggestedPlan.budgetTotal}`;
  
  if (Object.keys(answersUpdate).length > 0) {
    const rows = await sql`SELECT answers FROM events WHERE id = ${eventId}`;
    const current = rows[0]?.answers || {};
    await sql`UPDATE events SET answers = ${JSON.stringify({ ...current, ...answersUpdate })} WHERE id = ${eventId}`;
  }
}
