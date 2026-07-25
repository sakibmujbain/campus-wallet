import { NextResponse } from "next/server";
import { getViewer } from "@/lib/viewer";
import { countMatchingStudents } from "@/db/organizer";

export const runtime = "nodejs";

// How many students match a department / hall / session combination. Read-only, and gated
// to organizers, so the new-drive form can show "N students match" before a roster is built
// — the difference between rostering 66 people and silently rostering nobody.
export async function GET(req: Request) {
  const v = await getViewer();
  if (!v) return NextResponse.json({ ok: false, error: "not authenticated" }, { status: 401 });
  if (!v.has("cr") && !v.has("club_exec")) return NextResponse.json({ ok: false, error: "organizer only" }, { status: 403 });

  const sp = new URL(req.url).searchParams;
  const department = sp.get("department")?.trim() || null;
  const session = sp.get("session")?.trim() || null;
  const hallRaw = sp.get("hallId");
  const hallId = hallRaw && Number.isInteger(Number(hallRaw)) ? Number(hallRaw) : null;

  // no filters at all would count the whole university — report 0 rather than mislead
  if (!department && !hallId && !session) return NextResponse.json({ ok: true, count: 0, unfiltered: true });

  const count = await countMatchingStudents({ department, hallId, session });
  return NextResponse.json({ ok: true, count });
}
