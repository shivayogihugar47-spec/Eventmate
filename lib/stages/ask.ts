import { z } from "zod";
import { sql } from "@/lib/db";
import { llmJson } from "@/lib/llm";
import type { AssistantCard } from "@/app/api/chat/route";
import { BUDGET_OPTIONS } from "@/lib/budget";

export const PRIORITIES = ["Food", "Decor", "Photography", "Venue", "Entertainment"];

export const AnswersSchema = z.object({
  eventType: z.string().nullable(),
  eventDate: z.string().nullable(),
  guestCount: z.string().nullable(),
  city: z.string().nullable(),
  budgetTotal: z.string().nullable(),
  priorities: z.array(z.string()).nullable(),
  theme: z.string().nullable().optional(),
  venueStyle: z.string().nullable().optional(),
  cateringType: z.string().nullable().optional(),
  specialRequirements: z.string().nullable().optional(),
});

export type Answers = z.infer<typeof AnswersSchema>;

const EXTRACTION_SYSTEM = `You are an expert data extractor for an event planning app.
Extract fields from the user's message. Only extract fields that are explicitly mentioned.

Use EXACTLY these keys, spelled in camelCase. Do not use snake_case or invent other keys:
- eventType: string — one of "wedding", "birthday", "community", "corporate", "festival", "other"
- eventDate: string — ISO format YYYY-MM-DD
- guestCount: string — e.g. "150"
- city: string
- budgetTotal: string — e.g. "₹5L", "Under ₹1L", "₹3–7L"
- priorities: string[] — a ranking drawn only from: Food, Decor, Photography, Venue, Entertainment
- theme: string
- venueStyle: string
- cateringType: string
- specialRequirements: string

Return a partial JSON object containing only the keys you found; omit the rest.`;

export function isAskComplete(answers: Answers): boolean {
  return !!(
    answers.eventType &&
    answers.eventDate &&
    answers.guestCount &&
    answers.city &&
    answers.budgetTotal &&
    answers.priorities &&
    answers.priorities.length === PRIORITIES.length
  );
}

export async function handleAsk(eventId: string, userMessage: string): Promise<AssistantCard> {
  // 1. Fetch current answers
  const rows = await sql`SELECT answers FROM events WHERE id = ${eventId}`;
  const currentAnswers = (rows[0]?.answers || {}) as Answers;

  // 2. Extract new fields from message. The question currently on screen is passed
  //    as context so that bare answers ("100", "Bangalore") map to the right field.
  const pending = getNextQuestion(currentAnswers);
  const extracted = await llmJson(
    EXTRACTION_SYSTEM,
    [{
      role: "user",
      content: `Question shown to the user: "${pending.title}"\nUser's answer: "${userMessage}"`,
    }],
    AnswersSchema.partial()
  );

  // 3. Merge answers
  const newAnswers: Answers = {
    ...currentAnswers,
    ...extracted,
  };

  // Special handling for priorities if they are mentioned but not fully ranked
  if (extracted.priorities && extracted.priorities.length > 0) {
    const uniquePriorities = Array.from(new Set([...(extracted.priorities || [])]));
    newAnswers.priorities = uniquePriorities.filter(p => PRIORITIES.includes(p));
  }

  // 4. Save to DB
  await sql`UPDATE events SET answers = ${JSON.stringify(newAnswers)} WHERE id = ${eventId}`;
  await sql`INSERT INTO messages (event_id, role, content) VALUES (${eventId}, 'user', ${userMessage})`;

  // 5. Determine next question
  return getNextQuestion(newAnswers);
}

function getNextQuestion(answers: Answers): AssistantCard {
  if (!answers.eventType) {
    return {
      step: 1,
      title: "What are you celebrating?",
      subtitle: "Hi! I'm Eve. Let's plan something extraordinary together.",
      options: [
        { label: "Wedding", value: "wedding" },
        { label: "Birthday", value: "birthday" },
        { label: "Community Event", value: "community" },
        { label: "Corporate", value: "corporate" },
        { label: "Festival", value: "festival" },
        { label: "Other", value: "other" },
      ],
    };
  }
  if (!answers.eventDate) {
    return {
      step: 2,
      title: "When is the big day?",
      subtitle: `${answers.eventType.charAt(0).toUpperCase() + answers.eventType.slice(1)}! A wonderful choice.`,
      inputType: "date",
    };
  }
  if (!answers.guestCount) {
    return {
      step: 3,
      title: "How many guests are we expecting?",
      subtitle: "Great! Knowing the scale helps me suggest the perfect venues.",
      options: [
        { label: "Under 50", value: "Under 50" },
        { label: "50–100", value: "50–100" },
        { label: "100–200", value: "100–200" },
        { label: "200–500", value: "200–500" },
        { label: "500+", value: "500+" },
      ],
    };
  }
  if (!answers.city) {
    return {
      step: 4,
      title: "Which city is hosting the event?",
      subtitle: "Perfect. I'll look for local vendors and venues there.",
      inputPlaceholder: "e.g. Bangalore, Mumbai, Delhi",
      inputType: "text",
    };
  }
  if (!answers.budgetTotal) {
    return {
      step: 5,
      title: "What's your total budget range?",
      subtitle: `I'll make sure every rupee is well-spent in ${answers.city}.`,
      options: BUDGET_OPTIONS,
    };
  }
  if (!answers.priorities || answers.priorities.length < PRIORITIES.length) {
    const remaining = PRIORITIES.filter(p => !answers.priorities?.includes(p));
    return {
      step: 6,
      title: "Rank your top priorities",
      subtitle: "Tell me what matters most: Food, Decor, Photography, Venue, or Entertainment?",
      hint: `Currently picked: ${answers.priorities?.join(", ") || "None"}`,
      options: remaining.map(p => ({ label: p, value: p })),
    };
  }

  // All core fields collected, but maybe add some flavor questions if time permits or just advance
  return {
    step: 7,
    title: "Anything else I should know?",
    subtitle: "Theme, catering style, or special requirements?",
    hint: "Type 'none' to generate your plan now.",
    inputType: "text",
  };
}
