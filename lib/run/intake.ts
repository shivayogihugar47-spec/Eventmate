import { z } from "zod";
import { llmJson } from "@/lib/llm";
import { ChangeSchema, type RunChange, type RunPlan } from "./types";

const IntakeSchema = z.object({
  changes: z.array(ChangeSchema).max(8),
  clarifyingQuestion: z.string().max(240).nullable(),
});

const quickChanges: Record<string, (plan: RunPlan) => RunChange> = {
  "delay-15": (plan) => ({ type: "DELAY", taskId: nextTaskId(plan), minutes: 15, note: "Quick update: delayed 15 minutes" }),
  "delay-30": (plan) => ({ type: "DELAY", taskId: nextTaskId(plan), minutes: 30, note: "Quick update: delayed 30 minutes" }),
  "vendor-cancelled": () => ({ type: "VENDOR_CANCELLED", note: "Vendor cancelled" }),
  "more-guests": (plan) => ({ type: "GUEST_COUNT", guestCount: plan.guestCount + 10, note: "More guests are attending" }),
  rain: () => ({ type: "WEATHER", note: "Rain reported" }),
  "venue-issue": () => ({ type: "VENUE_ISSUE", note: "Venue issue reported" }),
};

function nextTaskId(plan: RunPlan): string | undefined {
  return plan.timeline.find((task) => task.status !== "done" && task.status !== "cancelled")?.id;
}

export function parseQuickChange(action: string, plan: RunPlan): RunChange | null {
  const create = quickChanges[action];
  if (!create) return null;
  const change = create(plan);
  return ChangeSchema.parse(change);
}

function validateChangeTargets(changes: RunChange[], plan: RunPlan): void {
  const taskIds = new Set(plan.timeline.map((task) => task.id));
  for (const change of changes) {
    if (change.taskId && !taskIds.has(change.taskId)) {
      throw new Error("The requested change refers to a task that is not in this plan.");
    }
    if (change.type === "DELAY" && !change.taskId && !change.taskName) {
      throw new Error("A delay must identify the affected task.");
    }
    if (change.type === "GUEST_COUNT" && change.guestCount === undefined) {
      throw new Error("The new guest count was not identified.");
    }
    if (change.type === "BUDGET" && change.budgetTotal === undefined) {
      throw new Error("The new budget was not identified.");
    }
    if (change.type === "DATE_MOVE" && !change.eventDate) {
      throw new Error("The new event date was not identified.");
    }
  }
}

export async function parseChangeText(text: string, plan: RunPlan): Promise<{
  changes: RunChange[];
  clarifyingQuestion: string | null;
}> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Tell Eve what changed before submitting.");
  if (trimmed.length > 1200) throw new Error("Keep the update under 1,200 characters.");

  const mentionsDelay = /\b(?:late|delayed|running behind|behind schedule)\b/i.test(trimmed);
  const includesDuration = /\b\d+(?:\.\d+)?\s*(?:minutes?|mins?|hours?|hrs?)\b/i.test(trimmed);
  if (mentionsDelay && !includesDuration) {
    const subjectMatch = trimmed.match(/\b(.{1,60}?)\s+(?:is|are|was|were|will be)\s+(?:hours?|late|delayed|running behind)\b/i);
    const subject = subjectMatch?.[1].replace(/^(?:the|our|my)\s+/i, "").trim();
    return {
      changes: [],
      clarifyingQuestion: subject
        ? `How many minutes late is ${subject}?`
        : "Which task is delayed, and by how many minutes?",
    };
  }

  let parsed: z.infer<typeof IntakeSchema>;
  try {
    parsed = await llmJson(
      `Convert the organizer's message into zero or more independent Change objects. ` +
        `Use only these types: DELAY, VENDOR_CANCELLED, VENDOR_REPLACED, GUEST_COUNT, BUDGET, DATE_MOVE, VENUE_ISSUE, WEATHER, TASK_DONE. ` +
        `A message may contain several changes. Match tasks/vendors to the supplied plan and use taskId when unambiguous. ` +
        `Convert times/durations to minutes, money to INR integer, dates to YYYY-MM-DD, venue closing time to HH:mm. ` +
        `If any requested change is ambiguous, ask exactly one concise clarifying question and return no changes. ` +
        `Do not invent values; do not make a plan or suggest actions.`,
      [
        { role: "user", content: `Event plan:\n${JSON.stringify(plan)}\n\nOrganizer update:\n${trimmed}` },
      ],
      IntakeSchema,
    );
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
    console.warn("[RUN intake] LLM returned changes that failed validation; asking organizer to clarify.", error.issues);
    return {
      changes: [],
      clarifyingQuestion: "I couldn't read that update clearly. Which task changed, and what is the new time or amount?",
    };
  }

  const changes = parsed.changes.map((change) => ChangeSchema.parse(change));
  validateChangeTargets(changes, plan);
  if (parsed.clarifyingQuestion && changes.length > 0) {
    throw new Error("Intake returned changes and a clarification together; please retry the update.");
  }
  if (changes.length === 0 && !parsed.clarifyingQuestion) {
    throw new Error("I couldn't identify a specific event change. Please describe what changed.");
  }
  return { changes, clarifyingQuestion: parsed.clarifyingQuestion, };
}
