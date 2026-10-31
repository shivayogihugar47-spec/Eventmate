import { NextResponse } from "next/server";
import { llmJson } from "@/lib/llm";
import { z } from "zod";

const WhatIfSchema = z.object({
  costImpact: z.number(),
  affectedCategories: z.array(z.object({
    category: z.string(),
    change: z.number(),
    reason: z.string(),
  })),
  summary: z.string(),
});

export async function POST(req: Request) {
  try {
    const { eventId, scenario, currentPlan } = await req.json();
    console.log(`Processing scenario for event: ${eventId}`);

    const system = `You are a financial event strategist. Analyze a "What If" scenario.
    Estimate cost impact and which categories must give if the budget stays the same.
    Or if the budget increases, how it's distributed.
    Scenario: ${scenario}`;

    const res = await llmJson(
      system,
      [{ role: "user", content: `Current Plan: ${JSON.stringify(currentPlan)}` }],
      WhatIfSchema
    );

    return NextResponse.json(res);
  } catch (err) {
      console.error("WhatIf API error:", err);
      return NextResponse.json({ error: "Failed to process scenario" }, { status: 500 });
    }
}
