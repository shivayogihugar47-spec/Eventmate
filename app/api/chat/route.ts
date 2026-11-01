import { NextResponse } from "next/server";
import { llmJson } from "@/lib/llm";
import { z } from "zod";
import { normalizeBudgetAmounts, parseBudget } from "@/lib/budget";
import { buildNextEventQuestion, type EventChatMessage } from "@/lib/eventQuestions";
import { normalizePlanForRun } from "@/lib/run/plan";
import { generateRisks } from "@/lib/run/risks";
import { saveLockedRun } from "@/lib/run/security";

export const dynamic = "force-dynamic";

// ─── Types exported for page.tsx ─────────────────────────────────────────────
export interface QuickOption { label: string; value: string; }
export interface AssistantCard {
  title: string;
  subtitle?: string;
  hint?: string;
  options?: QuickOption[];
  inputType?: "text" | "date" | "number";
  inputPlaceholder?: string;
  step: number;
}
export interface EventPlan {
  eventType: string; eventDate: string; guestCount: number;
  city: string; budgetTotal: number; theme?: string;
  venueStyle?: string; cateringType?: string; specialRequirements?: string;
  eventDetails?: Record<string, string>;
  highlights?: string[];
  timeline: TimelineItem[]; budgetBreakdown: BudgetItem[];
  vendors: VendorItem[]; checklist: ChecklistItem[];
}
export interface TimelineItem {
  time: string; task: string; owner: string; description?: string;
  status: "pending" | "in_progress" | "done" | "cancelled"; icon: string;
  id?: string; startAt?: string; durationMin?: number; dependsOn?: string[]; vendorName?: string; actualAt?: string;
}
export interface BudgetItem {
  category: string; allocated: number; percentage: number; icon: string; notes?: string;
}
export interface VendorItem {
  name: string; category: string; description?: string;
  status: "pending" | "contacted" | "booked";
  priority: "high" | "medium" | "low"; icon: string; estimatedCost?: string;
}
export interface ChecklistItem {
  task: string; dueDate: string; done: boolean; icon: string; category?: string;
}

const GeneratedPlanSchema = z.object({
  eventType: z.string().min(1).max(80),
  eventDate: z.string().min(1).max(40),
  guestCount: z.number().int().min(0).max(100_000),
  city: z.string().min(1).max(120),
  budgetTotal: z.number().int().min(1).max(1_000_000_000),
  theme: z.string().max(120).optional(),
  venueStyle: z.string().max(120).optional(),
  cateringType: z.string().max(120).optional(),
  specialRequirements: z.string().max(2000).optional(),
  eventDetails: z.record(z.string(), z.string()).optional(),
  highlights: z.array(z.string().max(240)).length(4),
  timeline: z.array(z.object({
    time: z.string().min(1).max(40),
    task: z.string().min(1).max(160),
    owner: z.string().max(120),
    description: z.string().max(500).optional(),
    status: z.enum(["pending", "in_progress", "done", "cancelled"]),
    icon: z.string().max(80),
  })).length(12),
  budgetBreakdown: z.array(z.object({
    category: z.string().min(1).max(120),
    allocated: z.number().int().min(0).max(1_000_000_000),
    percentage: z.number().min(0).max(100),
    icon: z.string().max(80),
    notes: z.string().max(500).optional(),
  })).length(8),
  vendors: z.array(z.object({
    name: z.string().min(1).max(120),
    category: z.string().min(1).max(120),
    description: z.string().max(500).optional(),
    status: z.enum(["pending", "contacted", "booked"]),
    priority: z.enum(["high", "medium", "low"]),
    icon: z.string().max(80),
    estimatedCost: z.string().max(120).optional(),
  })).length(10),
  checklist: z.array(z.object({
    task: z.string().min(1).max(160),
    dueDate: z.string().max(120),
    done: z.boolean(),
    icon: z.string().max(80),
    category: z.string().max(120).optional(),
  })).length(12),
});

// ─── Plan generation prompt ───────────────────────────────────────────────────
function buildPlanPrompt(d: Record<string, string | null>): string {
  const budgetTotal = parseBudget(d.budgetTotal ?? "");
  return `You are a professional event planner. Generate a complete, detailed event plan as JSON only (no markdown).

Event: ${d.eventType}, Date: ${d.eventDate}, Guests: ${d.guestCount}
City: ${d.city}, Budget: ${d.budgetTotal} (planning amount: ₹${budgetTotal}), Theme: ${d.theme ?? "Classic & Elegant"}
Venue: ${d.venueStyle ?? "TBD"}, Catering: ${d.cateringType ?? "TBD"}
Special: ${d.specialRequirements ?? "None"}
Occasion-specific details: ${JSON.stringify(d.eventDetails ?? {})}

Return ONLY this JSON structure:
{
  "eventType": "${d.eventType}",
  "eventDate": "${d.eventDate}",
  "guestCount": 100,
  "city": "${d.city}",
  "budgetTotal": ${budgetTotal},
  "theme": "${d.theme ?? "Classic & Elegant"}",
  "venueStyle": "${d.venueStyle ?? "Indoor"}",
  "cateringType": "${d.cateringType ?? "Both"}",
  "specialRequirements": "${d.specialRequirements ?? "None"}",
  "eventDetails": ${JSON.stringify(d.eventDetails ?? {})},
  "highlights": ["string1","string2","string3","string4"],
  "timeline": [{"time":"HH:MM AM/PM","task":"...","owner":"...","description":"...","status":"pending","icon":"lucide-name"}],
  "budgetBreakdown": [{"category":"...","allocated":0,"percentage":0,"icon":"lucide-name","notes":"..."}],
  "vendors": [{"name":"...","category":"...","description":"...","status":"pending","priority":"high","icon":"lucide-name","estimatedCost":"₹X–Y"}],
  "checklist": [{"task":"...","dueDate":"X weeks before","done":false,"icon":"lucide-name","category":"..."}]
}

Requirements:
- guestCount: parse "${d.guestCount}" to realistic integer (e.g. "50-100"→75, "Under 50"→30, "500+"→600)
- budgetTotal: use the exact planning amount ₹${budgetTotal}; do not recalculate it
- highlights: 4 exciting features specific to this event
- timeline: exactly 12 items covering full day from setup to wrap-up
- budgetBreakdown: exactly 8 categories, percentages sum to 100, amounts sum to budgetTotal
- vendors: exactly 10 vendors with realistic descriptions and cost estimates for ${d.city}
- checklist: exactly 12 action items across categories: Venue, Catering, Entertainment, Decor, Guest Management, Documentation
- Use occasion-specific details to tailor the timeline, vendors, checklist, and guest experience. For corporate events, account for the format, objective, duration, and AV/production needs; for weddings, account for ceremony traditions and personal moments.
- Make everything specific to ${d.eventType} in ${d.city} with ${d.theme} theme`;
}

// ─── POST /api/chat ───────────────────────────────────────────────────────────
export async function POST(request: Request) {
  let messages: EventChatMessage[] = [];
  let generatingPlan = false;
  try {
    const body = await request.json() as {
      messages: EventChatMessage[];
      generatePlan?: boolean;
      planData?: Record<string, string | null>;
    };
    messages = body.messages ?? [];
    generatingPlan = Boolean(body.generatePlan && body.planData);

    // ── Plan generation mode ────────────────────────────────────────────────
    if (generatingPlan && body.planData) {
      const plan = await llmJson(
        "You are a professional event planner. Return a detailed plan that matches the exact JSON structure requested by the user.",
        [{ role: "user", content: buildPlanPrompt(body.planData) }],
        GeneratedPlanSchema,
      );
      plan.budgetTotal = parseBudget(body.planData.budgetTotal ?? "");
      plan.budgetBreakdown = normalizeBudgetAmounts(plan.budgetBreakdown, plan.budgetTotal);
      const runPlan = normalizePlanForRun(plan);
      const risks = await generateRisks(runPlan);
      const run = await saveLockedRun(runPlan, body.planData, risks);
      return NextResponse.json({ plan: runPlan, run: { ...run, risks } });
    }

    return NextResponse.json(buildNextEventQuestion(messages));

  } catch (err) {
    console.error("[/api/chat]", err);
    if (generatingPlan) return NextResponse.json({ error: "Unable to generate the event plan." }, { status: 500 });
    return NextResponse.json(buildNextEventQuestion(messages));
  }
}
