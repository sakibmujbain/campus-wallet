import { NextResponse } from "next/server";
import { z } from "zod";
import { getViewer } from "@/lib/viewer";
import { createDrive } from "@/db/organizer";
import { mapPgError } from "@/lib/format";

export const runtime = "nodejs";

// ≤12 integer digits keeps the value inside NUMERIC(20,4); a real-date refine rejects
// calendar-invalid strings like 2026-02-31 that the bare regex would pass to a ::date cast.
const decimal = z.string().regex(/^\d{1,12}(\.\d{1,4})?$/, "amount must be a decimal with at most 12 whole digits");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
  .refine((v) => { const d = new Date(`${v}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v; }, "not a real calendar date");

const Body = z.object({
  name: z.string().min(1).max(120),
  scopeKind: z.enum(["batch"]),
  scopeRef: z.string().min(1).max(80),
  perHead: decimal,
  deadline: isoDate.optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  // false = open an empty drive and hand-pick the roster on the console
  autoRoster: z.boolean().optional().default(true),
  // cohort mode only: narrow the auto-roster to a single department (null = whole session)
  department: z.string().max(120).optional().nullable(),
});

export async function POST(req: Request) {
  const v = await getViewer();
  if (!v) return NextResponse.json({ ok: false, error: "not authenticated" }, { status: 401 });
  if (!v.has("cr") && !v.has("club_exec")) return NextResponse.json({ ok: false, error: "organizer only" }, { status: 403 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "invalid input" }, { status: 400 });
  const d = parsed.data;

  try {
    const eventId = await createDrive(v.appUserId, {
      name: d.name, scopeKind: d.scopeKind, scopeRef: d.scopeRef, perHead: d.perHead,
      deadline: d.deadline ?? null, description: d.description ?? null, autoRoster: d.autoRoster,
      department: d.department ?? null,
    });
    return NextResponse.json({ ok: true, eventId });
  } catch (err) {
    const m = mapPgError(err);
    return NextResponse.json(m.body, { status: m.status });
  }
}
