import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "@/lib/db";
import { RunApiError } from "@/lib/run/apply";
import { draftOwnerNotifications } from "@/lib/run/notify";
import { consumeRateLimit, loadOwnedOrganizerRun, rateLimitIdentity } from "@/lib/run/security";
import { ChangeSchema } from "@/lib/run/types";

const NotifySchema = z.object({
  version: z.number().int().positive(),
  changes: z.array(ChangeSchema).max(8),
  taskIds: z.array(z.string().uuid()).max(40),
});

type RouteContext = { params: Promise<{ eventId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  try {
    const body = NotifySchema.parse(await request.json());
    if (!await consumeRateLimit(`${eventId}:${rateLimitIdentity(request)}:notify`, 8)) {
      return NextResponse.json({ error: "Too many notification retries. Try again shortly." }, { status: 429 });
    }
    const run = await loadOwnedOrganizerRun(request, eventId);
    if (run.version !== body.version) throw new RunApiError("The plan changed. Refresh before retrying notifications.", 409);
    const messages = await draftOwnerNotifications(eventId, run.plan, body.changes, body.taskIds);
    await sql`INSERT INTO plan_events (event_id, type, payload, actor)
      VALUES (${eventId}, 'NOTIFY', ${JSON.stringify({
        version: run.version,
        taskIds: messages.map((message) => message.taskId),
      })}::jsonb, 'system')`;
    return NextResponse.json({ notifications: messages });
  } catch (error) {
    if (error instanceof RunApiError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Notification details are invalid." }, { status: 400 });
    console.error("[/api/run notify]", error);
    return NextResponse.json({ error: "Unable to prepare owner messages. Your change remains applied; please retry." }, { status: 503 });
  }
}
