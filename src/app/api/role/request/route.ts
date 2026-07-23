import { NextResponse } from "next/server";
import { z } from "zod";
import { getViewer } from "@/lib/viewer";
import { requestRole } from "@/db/admin";
import { mapPgError } from "@/lib/format";

export const runtime = "nodejs";

const Body = z.object({
  role: z.enum(["cr", "club_exec", "institution"]), // never admin
  scopeKind: z.string().max(20).optional().nullable(),
  scopeRef: z.string().max(80).optional().nullable(),
  justification: z.string().max(500).optional().nullable(),
});

export async function POST(req: Request) {
  const v = await getViewer();
  if (!v) return NextResponse.json({ ok: false, error: "not authenticated" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "invalid input" }, { status: 400 });

  try {
    const requestId = await requestRole(v.appUserId, parsed.data.role, parsed.data.scopeKind ?? null, parsed.data.scopeRef ?? null, parsed.data.justification ?? null);
    return NextResponse.json({ ok: true, requestId });
  } catch (err) {
    const m = mapPgError(err);
    // duplicate pending request surfaces as 23505 -> 422
    if ((err as { code?: string }).code === "23505") m.body.error = "You already have a pending request for that role.";
    return NextResponse.json(m.body, { status: m.status });
  }
}
