import { NextResponse } from "next/server";
import { z } from "zod";
import { getViewer } from "@/lib/viewer";
import { demoteUser, promoteUser, setStudentDepartment } from "@/db/admin";
import { mapPgError } from "@/lib/format";

export const runtime = "nodejs";

const Body = z.object({
  action: z.enum(["promote", "demote", "department"]),
  targetId: z.coerce.number().int().positive(),
  capability: z.enum(["cr", "club_exec", "institution", "admin"]).optional(),
  scopeKind: z.string().max(20).optional().nullable(),
  scopeRef: z.string().max(80).optional().nullable(),
  department: z.string().max(80).optional().nullable(),
});

export async function POST(req: Request) {
  const v = await getViewer();
  if (!v) return NextResponse.json({ ok: false, error: "not authenticated" }, { status: 401 });
  if (!v.isAdmin) return NextResponse.json({ ok: false, error: "admin only" }, { status: 403 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "invalid input" }, { status: 400 });
  const d = parsed.data;

  try {
    if (d.action === "promote") {
      if (!d.capability) return NextResponse.json({ ok: false, error: "capability required" }, { status: 400 });
      await promoteUser(v.appUserId, d.targetId, d.capability, d.scopeKind || "all", d.scopeRef || null);
    } else if (d.action === "demote") {
      if (!d.capability) return NextResponse.json({ ok: false, error: "capability required" }, { status: 400 });
      await demoteUser(v.appUserId, d.targetId, d.capability, d.scopeKind || "all", d.scopeRef || null);
    } else {
      await setStudentDepartment(v.appUserId, d.targetId, d.department ?? "");
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const m = mapPgError(err);
    return NextResponse.json(m.body, { status: m.status });
  }
}
