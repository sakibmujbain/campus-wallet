import { NextResponse } from "next/server";
import { z } from "zod";
import { getViewer } from "@/lib/viewer";
import { redeemPoints } from "@/db/rewards";
import { mapPgError } from "@/lib/format";

export const runtime = "nodejs";

const Body = z.object({
  points: z.coerce.number().int().positive().max(100_000_000),
  // Required: a money-out mutation must be idempotent, so a retry replays the one txn
  // instead of paying twice. The client always sends a stable per-intent key.
  idempotencyKey: z.string().uuid(),
});

export async function POST(req: Request) {
  const v = await getViewer();
  if (!v) return NextResponse.json({ ok: false, error: "not authenticated" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "invalid input" }, { status: 400 });

  try {
    await redeemPoints(v.appUserId, parsed.data.points, parsed.data.idempotencyKey);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const m = mapPgError(err);
    return NextResponse.json(m.body, { status: m.status });
  }
}
