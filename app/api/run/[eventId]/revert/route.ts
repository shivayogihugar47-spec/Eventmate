import { NextResponse } from "next/server";
import { z } from "zod";
import { revertToPreviousVersion, RunApiError } from "@/lib/run/apply";
import { consumeRateLimit, rateLimitIdentity } from "@/lib/run/security";

const RevertSchema = z.object({
  version: z.number().int().positive(),
  idempotencyKey: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/),
});

type RouteContext = { params: Promise<{ eventId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  try {
    const body = RevertSchema.parse(await request.json());
    if (!await consumeRateLimit(`${eventId}:${rateLimitIdentity(request)}:revert`, 5)) {
      return NextResponse.json({ error: "Too many revert attempts. Try again shortly." }, { status: 429 });
    }
    const result = await revertToPreviousVersion({
      request,
      eventId,
      expectedVersion: body.version,
      idempotencyKey: body.idempotencyKey,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof RunApiError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ error: "The revert request is invalid." }, { status: 400 });
    console.error("[/api/run revert]", error);
    return NextResponse.json({ error: "Unable to restore the previous version. Refresh and retry." }, { status: 503 });
  }
}
