import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { getViewer } from "@/lib/viewer";
import { addCohortToRoster, addToRoster, refundContribution, remindDefaulters, removeFromRoster, searchRosterCandidates, setDriveStatus, settleDrive } from "@/db/organizer";
import { mapPgError } from "@/lib/format";

export const runtime = "nodejs";

const amount = z.string().regex(/^\d{1,12}(\.\d{1,4})?$/, "amount must be a decimal with at most 12 whole digits");

const Body = z.object({
  action: z.enum(["roster_add", "roster_add_cohort", "roster_remove", "status", "refund", "settle", "remind"]),
  studentId: z.coerce.number().int().positive().optional(),
  studentAccountId: z.coerce.number().int().positive().optional(),
  destination: z.coerce.number().int().positive().optional(),
  amount: amount.optional(),
  expected: amount.optional(),
  perHead: amount.optional(),
  status: z.enum(["open", "closed", "cancelled"]).optional(),
  // A stable client key makes a retried/double-submitted refund replay the same txn
  // instead of issuing a second one (refund_event is idempotent by key).
  idempotencyKey: z.string().uuid().optional(),
});

// Search students to add to the roster (typeahead) — same organizer gate as POST.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const v = await getViewer();
  if (!v) return NextResponse.json({ ok: false, error: "not authenticated" }, { status: 401 });
  if (!v.has("cr") && !v.has("club_exec")) return NextResponse.json({ ok: false, error: "organizer only" }, { status: 403 });

  const eventId = Number((await params).id);
  if (!Number.isInteger(eventId) || eventId <= 0) return NextResponse.json({ ok: false, error: "bad drive id" }, { status: 400 });

  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ ok: true, candidates: [] });
  const candidates = await searchRosterCandidates(eventId, q);
  return NextResponse.json({ ok: true, candidates });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const v = await getViewer();
  if (!v) return NextResponse.json({ ok: false, error: "not authenticated" }, { status: 401 });
  if (!v.has("cr") && !v.has("club_exec")) return NextResponse.json({ ok: false, error: "organizer only" }, { status: 403 });

  const eventId = Number((await params).id);
  if (!Number.isInteger(eventId) || eventId <= 0) return NextResponse.json({ ok: false, error: "bad drive id" }, { status: 400 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "invalid input" }, { status: 400 });
  const d = parsed.data;

  try {
    switch (d.action) {
      case "roster_add":
        if (!d.studentId || !d.expected) return NextResponse.json({ ok: false, error: "studentId and expected required" }, { status: 400 });
        await addToRoster(v.appUserId, eventId, d.studentId, d.expected);
        break;
      case "roster_add_cohort": {
        if (!d.perHead) return NextResponse.json({ ok: false, error: "perHead required" }, { status: 400 });
        const added = await addCohortToRoster(v.appUserId, eventId, d.perHead);
        return NextResponse.json({ ok: true, added });
      }
      case "roster_remove":
        if (!d.studentId) return NextResponse.json({ ok: false, error: "studentId required" }, { status: 400 });
        await removeFromRoster(v.appUserId, eventId, d.studentId);
        break;
      case "status":
        if (!d.status) return NextResponse.json({ ok: false, error: "status required" }, { status: 400 });
        await setDriveStatus(v.appUserId, eventId, d.status);
        break;
      case "refund": {
        if (!d.studentAccountId || !d.amount) return NextResponse.json({ ok: false, error: "studentAccountId and amount required" }, { status: 400 });
        const txn = await refundContribution(v.appUserId, eventId, d.studentAccountId, d.amount, d.idempotencyKey ?? randomUUID());
        return NextResponse.json({ ok: true, txn });
      }
      case "settle": {
        if (!d.destination) return NextResponse.json({ ok: false, error: "destination required" }, { status: 400 });
        const txn = await settleDrive(v.appUserId, eventId, d.destination, randomUUID());
        return NextResponse.json({ ok: true, txn });
      }
      case "remind": {
        const n = await remindDefaulters(v.appUserId, eventId);
        return NextResponse.json({ ok: true, reminded: n });
      }
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const m = mapPgError(err);
    return NextResponse.json(m.body, { status: m.status });
  }
}
