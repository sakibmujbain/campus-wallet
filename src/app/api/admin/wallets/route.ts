import { NextResponse } from "next/server";
import { z } from "zod";
import { getViewer } from "@/lib/viewer";
import { openPayee } from "@/db/adminops";
import { mapPgError } from "@/lib/format";

export const runtime = "nodejs";

const Body = z.object({
  kind: z.enum(["exam", "hall", "cafeteria"]),
  ref: z.string().min(1).max(80),
  ref2: z.string().max(80).optional().nullable(),
});

export async function POST(req: Request) {
  const v = await getViewer();
  if (!v) return NextResponse.json({ ok: false, error: "not authenticated" }, { status: 401 });
  if (!v.isAdmin) return NextResponse.json({ ok: false, error: "admin only" }, { status: 403 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "invalid input" }, { status: 400 });

  try {
    const accountId = await openPayee(v.appUserId, parsed.data.kind, parsed.data.ref, parsed.data.ref2 ?? null);
    return NextResponse.json({ ok: true, accountId });
  } catch (err) {
    const m = mapPgError(err);
    return NextResponse.json(m.body, { status: m.status });
  }
}
