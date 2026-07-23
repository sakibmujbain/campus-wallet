import { NextResponse } from "next/server";
import { z } from "zod";
import { getViewer } from "@/lib/viewer";
import { assessFees } from "@/db/fees";
import { mapPgError } from "@/lib/format";

export const runtime = "nodejs";

const Body = z.object({
  feeItemId: z.coerce.number().int().positive(),
  period: z.string().min(1).max(40),
});

export async function POST(req: Request) {
  const v = await getViewer();
  if (!v) return NextResponse.json({ ok: false, error: "not authenticated" }, { status: 401 });
  if (!v.isAdmin) return NextResponse.json({ ok: false, error: "admin only" }, { status: 403 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "invalid input" }, { status: 400 });

  try {
    const assessed = await assessFees(v.appUserId, parsed.data.feeItemId, parsed.data.period);
    return NextResponse.json({ ok: true, assessed });
  } catch (err) {
    const m = mapPgError(err);
    return NextResponse.json(m.body, { status: m.status });
  }
}
