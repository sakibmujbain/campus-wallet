import { NextResponse } from "next/server";
import { z } from "zod";
import { getViewer } from "@/lib/viewer";
import { updateStudentAcademics } from "@/db/reference";
import { isValidDepartment, isValidSession } from "@/lib/du";
import { mapPgError } from "@/lib/format";

export const runtime = "nodejs";

const Body = z.object({
  department: z.string().min(1),
  hallId: z.coerce.number().int().positive(),
  session: z.string().min(1),
});

export async function POST(req: Request) {
  const v = await getViewer();
  if (!v) return NextResponse.json({ ok: false, error: "not authenticated" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "invalid input" }, { status: 400 });
  const d = parsed.data;
  if (!isValidDepartment(d.department)) return NextResponse.json({ ok: false, error: "unknown department" }, { status: 400 });
  if (!isValidSession(d.session)) return NextResponse.json({ ok: false, error: "unknown session" }, { status: 400 });

  try {
    await updateStudentAcademics(v.appUserId, d.department, d.hallId, d.session);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const m = mapPgError(err);
    return NextResponse.json(m.body, { status: m.status });
  }
}
