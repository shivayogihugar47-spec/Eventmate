import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const openrouterConfigured = Boolean(process.env.OPENROUTER_API_KEY);
  let databaseReady = false;

  try {
    const rows = await sql`SELECT 1 AS result`;
    databaseReady = rows.length > 0;
  } catch {
    databaseReady = false;
  }

  const report = {
    status: databaseReady && openrouterConfigured ? "ok" : "degraded",
    database: databaseReady ? "ok" : "unavailable",
    openrouter: openrouterConfigured ? "configured" : "missing",
  } as const;

  return NextResponse.json(report, {
    status: databaseReady && openrouterConfigured ? 200 : 503,
  });
}
