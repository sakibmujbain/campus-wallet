import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { makeTransfer } from "@/db/accounts";

export const runtime = "nodejs"; // needs the `pg` driver, not the edge runtime

const Body = z.object({
  // account ids arrive as numbers from the UI, but BIGINT round-trips as strings
  // via node-postgres, so coerce to be safe against both.
  from: z.coerce.number().int().positive(),
  to: z.coerce.number().int().positive(),
  // Decimal STRING (never a float) — up to 4 fractional digits, matching NUMERIC(20,4).
  amount: z.string().regex(/^\d+(\.\d{1,4})?$/, "amount must be a positive decimal"),
  currency: z.string().length(3),
  idempotencyKey: z.string().uuid().optional(),
});

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "invalid input" }, { status: 400 });
  }

  const { from, to, amount, currency } = parsed.data;
  // Server-generated idempotency key unless the client supplied one (safe retries).
  const idempotencyKey = parsed.data.idempotencyKey ?? randomUUID();

  try {
    const txnId = await makeTransfer({ from, to, amount, currency, idempotencyKey });
    return NextResponse.json({ ok: true, txnId, idempotencyKey });
  } catch (err) {
    const e = err as { message?: string; code?: string };
    // Only surface SQLSTATEs our own DB functions raise for business-rule
    // violations (overdraft 23514, unbalanced/currency 23000, append-only 23001,
    // plain RAISE like same-account P0001). Everything else is an internal fault:
    // log it server-side and return a generic 500 without leaking DB internals.
    const businessCodes = new Set(["23514", "23000", "23001", "P0001"]);
    if (e.code && businessCodes.has(e.code)) {
      return NextResponse.json({ ok: false, error: e.message ?? "transfer rejected", code: e.code }, { status: 422 });
    }
    console.error("transfer failed (internal):", err);
    return NextResponse.json({ ok: false, error: "transfer failed" }, { status: 500 });
  }
}
