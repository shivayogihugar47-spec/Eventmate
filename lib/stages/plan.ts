import { z } from "zod";
import { sql } from "@/lib/db";
import { llmJson } from "@/lib/llm";
import { parseBudget } from "@/lib/budget";
import { type Answers } from "./ask";
import type { EventPlan, TimelineItem, BudgetItem } from "@/app/api/chat/route";

export { parseBudget } from "@/lib/budget";

const PlanSchema = z.object({
  highlights: z.array(z.string()),
  budgetBreakdown: z.array(z.object({
    category: z.string(),
    weight: z.number(), // 1-10 scale for importance
    icon: z.string(),
    notes: z.string(),
  })),
  tasks: z.array(z.object({
    task: z.string(),
    durationDays: z.number(),
    dependsOnIndex: z.number().nullable(),
    owner: z.string(),
    description: z.string(),
    icon: z.string(),
  })),
  vendors: z.array(z.object({
    name: z.string(),
    category: z.string(),
    description: z.string(),
    priority: z.enum(["high", "medium", "low"]),
    icon: z.string(),
    estimatedCostRange: z.string(),
  })),
});

type RawPlan = z.infer<typeof PlanSchema>;

const PLAN_SYSTEM = `You are an expert event planner. Create a DETAILED plan.

Respond with a single JSON object using EXACTLY this shape — these exact camelCase keys and nothing else:

{
  "highlights": string[],                      // 4 short, exciting highlights
  "budgetBreakdown": [                         // exactly 8 items
    {
      "category": string,                      // e.g. "Venue", "Food", "Decor"
      "weight": number,                        // 1-10 relative importance
      "icon": string,                          // lucide icon name, e.g. "utensils", "flower2", "camera"
      "notes": string                          // one short sentence of guidance
    }
  ],
  "tasks": [                                   // exactly 12 items
    {
      "task": string,
      "durationDays": number,
      "dependsOnIndex": number | null,         // index into THIS tasks array, or null
      "owner": string,                         // e.g. "Planner", "Caterer", "Bride"
      "description": string,
      "icon": string
    }
  ],
  "vendors": [                                 // 4-6 items
    {
      "name": string,
      "category": string,
      "description": string,
      "priority": "high" | "medium" | "low",
      "icon": string,
      "estimatedCostRange": string             // e.g. "₹1.2L – ₹1.8L"
    }
  ]
}

Tasks are scheduled BACKWARD from the event date.`;

export async function generatePlan(eventId: string): Promise<EventPlan> {
  // 1. Fetch answers
  const rows = await sql`SELECT answers, event_type FROM events WHERE id = ${eventId}`;
  const answers = (rows[0]?.answers || {}) as Answers;
  const eventType = rows[0]?.event_type || answers.eventType || "Event";

  // 2. Parse budget
  const budgetTotal = parseBudget(answers.budgetTotal || "₹0");

  // 3. Call LLM
  const raw = await llmJson(
    PLAN_SYSTEM,
    [{ role: "user", content: `Plan for a ${eventType} in ${answers.city} on ${answers.eventDate}. Budget: ${answers.budgetTotal}. Priorities: ${answers.priorities?.join(", ")}.` }],
    PlanSchema
  );

  // 4. Normalize Budget
  const budgetBreakdown: BudgetItem[] = normalizeBudget(raw.budgetBreakdown, budgetTotal, answers.priorities || []);

  // 5. Schedule Tasks Backward
  const timeline: TimelineItem[] = scheduleTasks(raw.tasks, answers.eventDate || new Date().toISOString());

  const fullPlan: EventPlan = {
    eventType,
    eventDate: answers.eventDate || "",
    guestCount: parseInt(answers.guestCount?.replace(/[^0-9]/g, "") || "100"),
    city: answers.city || "",
    budgetTotal,
    theme: answers.theme || "Classic & Elegant",
    highlights: raw.highlights,
    timeline,
    budgetBreakdown,
    vendors: raw.vendors.map(v => ({
      ...v,
      status: "pending",
      estimatedCost: v.estimatedCostRange,
    })),
    checklist: raw.tasks.map((t, i) => ({
      task: t.task,
      dueDate: timeline[i].time,
      done: false,
      icon: t.icon,
      category: "Planning",
    })),
  };

  // 6. Save version 1
  await sql`INSERT INTO plan_versions (event_id, version, plan, change_note) VALUES (${eventId}, 1, ${JSON.stringify(fullPlan)}, 'Initial plan generated')`;
  
  // 7. Update event stage
  await sql`UPDATE events SET stage = 'run' WHERE id = ${eventId}`;

  return fullPlan;
}

export function normalizeBudget(raw: RawPlan["budgetBreakdown"], total: number, priorities: string[]): BudgetItem[] {
  // Priority boost: higher rank = higher weight
  const boostedWeights = raw.map(item => {
    // Try to find a match in priorities (case-insensitive and partial match)
    const priorityIndex = priorities.findIndex(p => 
      item.category.toLowerCase().includes(p.toLowerCase()) || 
      p.toLowerCase().includes(item.category.toLowerCase())
    );
    const boost = priorityIndex !== -1 ? (priorities.length - priorityIndex) * 3 : 0;
    return { ...item, weight: Math.max(1, item.weight + boost) };
  });

  const totalWeight = boostedWeights.reduce((sum, item) => sum + item.weight, 0);
  
  let currentSum = 0;
  return boostedWeights.map((item, i) => {
    let allocated = Math.round((item.weight / totalWeight) * total);
    
    // Ensure last item makes it sum to exactly total
    if (i === boostedWeights.length - 1) {
      allocated = total - currentSum;
    }
    currentSum += allocated;

    return {
      category: item.category,
      allocated,
      percentage: Math.round((allocated / total) * 100),
      icon: item.icon,
      notes: `${item.notes} (Estimate, not a confirmed quote)`,
    };
  });
}

export function scheduleTasks(rawTasks: RawPlan["tasks"], eventDateStr: string): TimelineItem[] {
  const eventDate = new Date(eventDateStr);
  const today = new Date();
  const timeline: TimelineItem[] = new Array(rawTasks.length);
  const finishDates: (Date | null)[] = new Array(rawTasks.length).fill(null);

  // Recursive function to calculate dates with compression
  function getFinishDate(index: number): Date {
    if (finishDates[index]) return finishDates[index]!;

    const t = rawTasks[index];
    let finishDate: Date;

    // Find tasks that depend on THIS task (i.e., THIS task must finish before THEY start)
    const dependents = rawTasks.filter(rt => rt.dependsOnIndex === index);
    
    if (dependents.length === 0) {
      // Terminal task - ends at event date
      finishDate = new Date(eventDate);
    } else {
      // Ends when the earliest dependent starts
      const dependentStartDates = dependents.map(d => {
        const dIdx = rawTasks.findIndex(rt => rt === d);
        const dFinish = getFinishDate(dIdx);
        const dStart = new Date(dFinish);
        dStart.setDate(dStart.getDate() - d.durationDays);
        return dStart;
      });
      finishDate = new Date(Math.min(...dependentStartDates.map(d => d.getTime())));
    }

    // Compression: if finishDate is in the past, move it to today + duration
    // Actually, if START date is in past, we compress.
    const startDate = new Date(finishDate);
    startDate.setDate(startDate.getDate() - t.durationDays);
    
    if (startDate < today) {
      // Compress: move start to today, but don't push finish beyond dependents
      startDate.setTime(today.getTime());
      if (startDate > finishDate) {
        finishDate.setTime(startDate.getTime()); // Minimum duration of 0 if really tight
      }
    }

    finishDates[index] = finishDate;
    return finishDate;
  }

  // Populate timeline
  for (let i = 0; i < rawTasks.length; i++) {
    const fDate = getFinishDate(i);
    const sDate = new Date(fDate);
    sDate.setDate(sDate.getDate() - rawTasks[i].durationDays);
    if (sDate < today) sDate.setTime(today.getTime());

    timeline[i] = {
      time: sDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      task: rawTasks[i].task,
      owner: rawTasks[i].owner,
      description: rawTasks[i].description,
      status: "pending",
      icon: rawTasks[i].icon,
    };
  }

  return timeline;
}
