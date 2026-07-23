import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getSpendingAccountId, getStudent } from "@/lib/session";
import { makeTransfer } from "@/db/accounts";
import { pool } from "@/db/pool";

export const runtime = "nodejs";

// The payer is ALWAYS the logged-in student's spending wallet (server-derived,
// never trusted from the client). Routes through make_purchase -> round-up + points.
const Body = z.object({
  to: z.coerce.number().int().positive(),
  amount: z.string().regex(/^\d+(\.\d{1,4})?$/, "amount must be a positive decimal"),
  idempotencyKey: z.string().uuid().optional(),
});

export async function POST(req: Request) {
  const student = await getStudent();
  if (!student) return NextResponse.json({ ok: false, error: "not authenticated" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "invalid input" }, { status: 400 });
  }

  const from = await getSpendingAccountId(student.appUserId);
  if (from == null) return NextResponse.json({ ok: false, error: "no spending wallet" }, { status: 400 });

  // Authorize the target server-side: payments may only go to sanctioned campus
  // payees (never another student's wallet — that would let a user mint loyalty
  // points / self-deal by "paying" their own account).
  const { rows: allowed } = await pool.query(`SELECT 1 FROM v_payable_targets WHERE account_id = $1`, [parsed.data.to]);
  if (allowed.length === 0) {
    return NextResponse.json({ ok: false, error: "not a payable campus target" }, { status: 403 });
  }

  const idempotencyKey = parsed.data.idempotencyKey ?? randomUUID();
  try {
    const txnId = await makeTransfer({
      from,
      to: parsed.data.to,
      amount: parsed.data.amount,
      currency: "BDT",
      idempotencyKey,
      kind: "purchase",
      userId: student.appUserId,
    });
    return NextResponse.json({ ok: true, txnId, idempotencyKey });
  } catch (err) {
    const e = err as { message?: string; code?: string };
    const business = new Set(["23514", "23000", "23001", "P0001"]);
    if (e.code && business.has(e.code)) {
      return NextResponse.json({ ok: false, error: e.message ?? "payment rejected", code: e.code }, { status: 422 });
    }
    console.error("pay failed (internal):", err);
    return NextResponse.json({ ok: false, error: "payment failed" }, { status: 500 });
  }
}
