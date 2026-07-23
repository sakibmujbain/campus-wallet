import { NextResponse } from "next/server";
import { getViewer } from "@/lib/viewer";
import { markAllRead } from "@/db/notifications";
import { mapPgError } from "@/lib/format";

export const runtime = "nodejs";

export async function POST() {
  const v = await getViewer();
  if (!v) return NextResponse.json({ ok: false, error: "not authenticated" }, { status: 401 });
  try {
    const n = await markAllRead(v.appUserId);
    return NextResponse.json({ ok: true, marked: n });
  } catch (err) {
    const m = mapPgError(err);
    return NextResponse.json(m.body, { status: m.status });
  }
}
