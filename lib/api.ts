import type { EventPlan, AssistantCard } from "@/app/api/chat/route";
import type { ReplanDiff } from "@/lib/stages/replan";

export async function sendChatMessage(eventId: string, message: string) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventId, message }),
  });
  if (!res.ok) throw new Error("Failed to send message");
  return res.json() as Promise<{
    stage: "ask" | "plan" | "run" | "replan";
    card?: AssistantCard;
    plan?: EventPlan;
    diff?: ReplanDiff;
    role?: string;
    content?: string;
  }>;
}

export async function acceptReplan(eventId: string, suggestedPlan: EventPlan, note: string) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventId, action: "accept_replan", suggestedPlan, note }),
  });
  if (!res.ok) throw new Error("Failed to accept re-plan");
  return res.json();
}

export async function getWhatIf(eventId: string, scenario: string, currentPlan: EventPlan) {
  const res = await fetch("/api/whatif", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventId, scenario, currentPlan }),
  });
  if (!res.ok) throw new Error("Failed to analyze scenario");
  return res.json();
}

export async function compareQuotes(quotes: string, budgetLine: string) {
  const res = await fetch("/api/compare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quotes, budgetLine }),
  });
  if (!res.ok) throw new Error("Failed to compare quotes");
  return res.json();
}
