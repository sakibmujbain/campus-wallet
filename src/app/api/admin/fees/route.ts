import { NextResponse } from "next/server";
import { z } from "zod";
import { getViewer } from "@/lib/viewer";
import { createFeeItem } from "@/db/fees";
import { mapPgError } from "@/lib/format";

export const runtime = "nodejs";

const Body = z.object({
  name: z.string().min(1),
  category: z.enum(["exam", "hall_rent", "cafeteria", "library", "misc"]),
  collector: z.coerce.number().int().positive(),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  scopeKind: z.enum(["all", "batch", "department", "hall"]),
  scopeRef: z.string().optional().nullable(),
});

export async function POST(req: Request) {
  const v = await getViewer();
  if (!v) return NextResponse.json({ ok: false, error: "not authenticated" }, { status: 401 });
  if (!v.isAdmin) return NextResponse.json({ ok: false, error: "admin only" }, { status: 403 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "invalid input" }, { status: 400 });

  const d = parsed.data;
  try {
    const feeItemId = await createFeeItem(v.appUserId, {
      name: d.name,
      category: d.category,
      collector: d.collector,
      amount: d.amount,
      scopeKind: d.scopeKind,
      scopeRef: d.scopeKind === "all" ? null : d.scopeRef || null,
    });
    return NextResponse.json({ ok: true, feeItemId });
  } catch (err) {
    const m = mapPgError(err);
    return NextResponse.json(m.body, { status: m.status });
  }
}
