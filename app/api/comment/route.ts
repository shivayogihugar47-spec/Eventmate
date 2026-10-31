import { NextResponse } from "next/server";
import { getOpenRouterClient } from "@/lib/llm";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { step, answer, eventType, city } = await req.json() as {
      step: number; answer: string; eventType?: string; city?: string;
    };

    const client = getOpenRouterClient();
    const model = process.env.OPENROUTER_MODEL ?? "meta-llama/llama-3.3-70b-instruct";

    const context = [
      eventType ? `event: ${eventType}` : "",
      city ? `city: ${city}` : "",
    ].filter(Boolean).join(", ");

    const stepPrompts: Record<number, string> = {
      1: `User is planning a "${answer}". Generate ONE excited, warm, specific reaction sentence (12–16 words). Be genuinely enthusiastic. Reference something specific about that event type. No generic phrases. No emojis.`,
      2: `User set their ${eventType} date as "${answer}"${city ? ` in ${city}` : ""}. Generate ONE clever, anticipatory sentence (12–16 words) about the date — mention season, countdown, or excitement. No emojis.`,
      3: `User expects "${answer}" guests at their ${eventType}${city ? ` in ${city}` : ""}. Generate ONE witty sentence (12–16 words) reacting to that crowd size — could be funny, warm, or awe-inspiring. No emojis.`,
      4: `User's ${eventType} will be in "${answer}". Generate ONE sentence (12–16 words) that shows you know something specific and delightful about ${answer} as an event city. No emojis.`,
      5: `User's budget for their ${eventType} in ${city ?? "their city"} is "${answer}". Generate ONE confident, exciting sentence (12–16 words) about what's possible with that budget. Make them feel great. No emojis.`,
      6: `User chose "${answer}" theme for their ${eventType}. Generate ONE vivid, sensory sentence (12–16 words) describing what this theme will look and feel like. Paint a picture. No emojis.`,
      7: `User wants a "${answer}" venue for their ${eventType}. Generate ONE sentence (12–16 words) that gets them excited about that venue choice. Mention atmosphere or ambience. No emojis.`,
      8: `User chose "${answer}" catering for their ${eventType} with ${context}. Generate ONE delicious, mouth-watering sentence (12–16 words) about the food experience. Make it irresistible. No emojis.`,
      9: `User's special requirements: "${answer}". Generate ONE warm, reassuring sentence (12–16 words) confirming you will handle everything and make it perfect. Be specific to what they said. No emojis.`,
    };

    const prompt = stepPrompts[step] ?? `React warmly and specifically to: "${answer}" in context of ${context}. One sentence, 12-16 words. No emojis.`;

    const res = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: `You are Eve, a world-class event planner AI with incredible enthusiasm and expertise. 
You give SHORT, PUNCHY, SPECIFIC reactions that feel genuinely intelligent and personalized.
Never use emojis. Never be generic. Always surprise the user with how specific and insightful you are.
Respond with ONLY the reaction sentence — no quotes, no labels, nothing else.`,
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 80,
      temperature: 0.9,
    });

    const comment = (res.choices[0]?.message?.content ?? "")
      .trim()
      .replace(/^["']|["']$/g, "")
      .replace(/^Eve:\s*/i, "")
      .replace(/\.$/, "") + ".";

    return NextResponse.json({ comment });
  } catch {
    return NextResponse.json({ comment: "" });
  }
}
