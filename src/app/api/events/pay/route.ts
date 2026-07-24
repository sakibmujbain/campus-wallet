import { NextResponse } from "next/server";
import { z } from "zod";
import { getViewer } from "@/lib/viewer";
import { payEvent } from "@/db/myevents";
import { mapPgError } from "@/lib/format";

export const runtime = "nodejs";

const Body = z.object({
  eventId: z.coerce.number().int().positive(),
  amount: z.string().regex(/^\d{1,12}(\.\d{1,4})?$/, "amount must be a decimal"),
  // Required: money-out mutation must be idempotent so a retry replays the one txn.
  idempotencyKey: z.string().uuid(),
});

export async function POST(req: Request) {
  const v = await getViewer();
  if (!v) return NextResponse.json({ ok: false, error: "not authenticated" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "invalid input" }, { status: 400 });

  try {
    const txn = await payEvent(v.appUserId, parsed.data.eventId, parsed.data.amount, parsed.data.idempotencyKey);
    return NextResponse.json({ ok: true, txn });
  } catch (err) {
    const m = mapPgError(err);
    return NextResponse.json(m.body, { status: m.status });
  }
}
