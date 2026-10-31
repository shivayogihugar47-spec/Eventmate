import { NextResponse } from "next/server";
import { llmJson } from "@/lib/llm";
import { z } from "zod";

const CompareSchema = z.object({
  comparison: z.array(z.object({
    vendor: z.string(),
    included: z.array(z.string()),
    guestsCovered: z.string(),
    extraCharges: z.string(),
    questions: z.array(z.string()),
    budgetFit: z.string(),
    totalCost: z.number(),
  })),
  recommendation: z.string(),
});

export async function POST(req: Request) {
  try {
    const { quotes, budgetLine } = await req.json();

    const system = `Compare these vendor quotes. Be objective.
    Current budget allocation for this category: ${budgetLine}.
    State clearly that this only compares what was provided.`;

    const res = await llmJson(
      system,
      [{ role: "user", content: `Quotes: ${quotes}` }],
      CompareSchema
    );

    return NextResponse.json(res);
  } catch (err) {
      console.error("Compare API error:", err);
      return NextResponse.json({ error: "Failed to compare plans" }, { status: 500 });
    }
}
