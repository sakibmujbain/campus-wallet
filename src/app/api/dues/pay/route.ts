import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getStudent } from "@/lib/session";
import { payDue } from "@/db/dues";
import { mapPgError } from "@/lib/format";

export const runtime = "nodejs";

const Body = z.object({
  assessmentId: z.coerce.number().int().positive(),
  idempotencyKey: z.string().uuid().optional(),
});

export async function POST(req: Request) {
  const student = await getStudent();
  if (!student) return NextResponse.json({ ok: false, error: "not authenticated" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "invalid input" }, { status: 400 });

  const idem = parsed.data.idempotencyKey ?? randomUUID();
  try {
    const txnId = await payDue(student.appUserId, parsed.data.assessmentId, idem);
    return NextResponse.json({ ok: true, txnId });
  } catch (err) {
    const m = mapPgError(err);
    return NextResponse.json(m.body, { status: m.status });
  }
}
