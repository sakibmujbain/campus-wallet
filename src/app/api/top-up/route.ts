import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getStudent } from "@/lib/session";
import { topUp } from "@/db/dues";
import { mapPgError } from "@/lib/format";

export const runtime = "nodejs";

const Body = z.object({
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "enter a valid amount"),
  idempotencyKey: z.string().uuid().optional(),
});

export async function POST(req: Request) {
  const student = await getStudent();
  if (!student) return NextResponse.json({ ok: false, error: "not authenticated" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error?.issues[0]?.message ?? "invalid input" }, { status: 400 });

  const idem = parsed.data.idempotencyKey ?? randomUUID();
  try {
    const txnId = await topUp(student.appUserId, parsed.data.amount, idem);
    return NextResponse.json({ ok: true, txnId });
  } catch (err) {
    const m = mapPgError(err);
    return NextResponse.json(m.body, { status: m.status });
  }
}
