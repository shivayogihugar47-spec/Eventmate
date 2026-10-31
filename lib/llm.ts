import OpenAI from "openai";
import { z } from "zod";

// ---------------------------------------------------------------------------
// OpenRouter client (OpenAI-compatible) – lazy singleton
//
// The client is created on first use rather than at module load so that
// Next.js can statically analyse routes during `next build` without requiring
// OPENROUTER_API_KEY to be present at build time.
// ---------------------------------------------------------------------------

let _client: OpenAI | null = null;

export function getOpenRouterClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY ?? "",
    });
  }
  return _client;
}

/** Convenience re-export for callers that used the old named export. */
export const openrouter = {
  get chat() {
    return getOpenRouterClient().chat;
  },
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChatMessage = OpenAI.Chat.ChatCompletionMessageParam;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip ```json ... ``` fences that some models wrap around their output. */
function stripCodeFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

// ---------------------------------------------------------------------------
// llmJson
// ---------------------------------------------------------------------------

/**
 * Call the configured OpenRouter model, parse the response as JSON, and
 * validate it against a Zod schema.  Retries once on parse/validation failure.
 *
 * @param system   System prompt.
 * @param messages Conversation history (role + content pairs).
 * @param schema   Zod schema to validate the parsed object against.
 * @returns        The validated, typed object.
 */
export async function llmJson<T>(
  system: string,
  messages: ChatMessage[],
  schema: z.ZodType<T>
): Promise<T> {
  const model = process.env.OPENROUTER_MODEL ?? "meta-llama/llama-3.3-70b-instruct:free";
  const fallbackModel = process.env.OPENROUTER_FALLBACK_MODEL ?? "openai/gpt-4o-mini";
  const client = getOpenRouterClient();

  const systemMessage: ChatMessage = {
    role: "system",
    content: `${system}\n\nIMPORTANT: Respond with valid JSON only. No markdown, no code fences, no explanation.`,
  };

  async function attempt(m: string): Promise<T> {
    const response = await client.chat.completions.create({
      model: m,
      messages: [systemMessage, ...messages],
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0]?.message?.content ?? "";
    const cleaned = stripCodeFences(raw);
    const parsed: unknown = JSON.parse(cleaned);
    return schema.parse(parsed);
  }

  try {
    return await attempt(model);
  } catch (firstError) {
    console.warn(`[llmJson] First attempt failed with ${model}, retrying with fallback ${fallbackModel}...`, firstError);
    try {
      return await attempt(fallbackModel);
    } catch (secondError) {
      console.error("[llmJson] Both attempts failed.", { firstError, secondError });
      throw secondError;
    }
  }
}
