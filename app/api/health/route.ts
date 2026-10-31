export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { openrouter } from "@/lib/llm";
import { sql } from "@/lib/db";
import { authConfig } from "@/lib/auth";
import { callHello } from "@/lib/functions";

// ---------------------------------------------------------------------------
// GET /api/health
//
// Tests every wired service end-to-end:
//   1. OpenRouter LLM (chat completion)
//   2. Neon Postgres (SELECT 1)
//   3. Neon Auth (JWKS endpoint reachable)
//   4. Neon Functions (hello function invocation)
// ---------------------------------------------------------------------------

interface ServiceStatus {
  status: "ok" | "error";
  detail?: string;
}

interface HealthReport {
  openrouter: ServiceStatus;
  openrouter_model: string;
  database: ServiceStatus;
  neon_auth: ServiceStatus;
  neon_function_hello: ServiceStatus;
  allOk: boolean;
}

export async function GET() {
  const report: HealthReport = {
    openrouter: { status: "ok" },
    openrouter_model: process.env.OPENROUTER_MODEL ?? "(not set)",
    database: { status: "ok" },
    neon_auth: { status: "ok" },
    neon_function_hello: { status: "ok" },
    allOk: false,
  };

  // ── 1. OpenRouter ─────────────────────────────────────────────────────────
  try {
    const model =
      process.env.OPENROUTER_MODEL ?? "meta-llama/llama-3.3-70b-instruct:free";
    const response = await openrouter.chat.completions.create({
      model,
      messages: [{ role: "user", content: 'Reply with the single word "ok".' }],
      max_tokens: 5,
    });
    const content = response.choices[0]?.message?.content ?? "";
    if (!content) throw new Error("Empty response from OpenRouter.");
  } catch (err) {
    report.openrouter = {
      status: "error",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  // ── 2. Neon Postgres (pooled) ──────────────────────────────────────────────
  try {
    const rows = await sql`SELECT 1 AS result`;
    if (!rows?.length) throw new Error("No rows returned from SELECT 1.");
  } catch (err) {
    report.database = {
      status: "error",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  // ── 3. Neon Auth (JWKS endpoint reachability) ──────────────────────────────
  try {
    if (!authConfig.isConfigured) {
      throw new Error(
        "NEON_AUTH_BASE_URL or NEON_AUTH_JWKS_URL not set in environment."
      );
    }
    const res = await fetch(authConfig.jwksUrl);
    if (!res.ok) throw new Error(`JWKS endpoint returned HTTP ${res.status}`);
    // Validate it's actually a JWKS payload
    const body = (await res.json()) as { keys?: unknown };
    if (!Array.isArray(body.keys)) throw new Error("JWKS response missing keys array.");
  } catch (err) {
    report.neon_auth = {
      status: "error",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  // ── 4. Neon Function: hello ────────────────────────────────────────────────
  try {
    const text = await callHello();
    if (!text) throw new Error("Empty response from hello function.");
    // attach the response text so it's visible in the health output
    (report.neon_function_hello as ServiceStatus & { response?: string }).response = text;
  } catch (err) {
    report.neon_function_hello = {
      status: "error",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  report.allOk =
    report.openrouter.status === "ok" &&
    report.database.status === "ok" &&
    report.neon_auth.status === "ok" &&
    report.neon_function_hello.status === "ok";

  return NextResponse.json(report, { status: report.allOk ? 200 : 503 });
}
