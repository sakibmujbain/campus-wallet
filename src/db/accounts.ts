import { pool } from "./pool";
import { withTransaction } from "./tx";

export interface AccountBalance {
  accountId: number;
  accountKind: string;
  currency: string;
  /** NUMERIC is returned as a STRING to preserve exact precision — never a JS float. */
  balance: string;
}

export async function listAccountsWithBalances(): Promise<AccountBalance[]> {
  const { rows } = await pool.query(
    `SELECT account_id::int AS "accountId",
            account_kind     AS "accountKind",
            currency,
            balance::text    AS balance
       FROM v_account_balance
      ORDER BY account_id`,
  );
  return rows as AccountBalance[];
}

export interface TransferInput {
  from: number;
  to: number;
  /** decimal string, e.g. "250.50" — validated upstream, passed to ::numeric. */
  amount: string;
  currency: string;
  idempotencyKey: string;
  description?: string;
  /** 'purchase' routes through make_purchase() (triggers round-up + loyalty points). */
  kind?: "transfer" | "purchase";
  /** Logged-in app_user id — sets created_by on the txn and the RLS/audit GUC. */
  userId?: number;
}

export interface PayableTarget {
  accountId: number;
  currency: string;
  instKind: string;
  label: string;
}

/** The unified list of campus payees (hall / exam / cafeteria) across subtypes. */
export async function listPayableTargets(): Promise<PayableTarget[]> {
  const { rows } = await pool.query(
    `SELECT account_id::int AS "accountId", currency, inst_kind AS "instKind", label
       FROM v_payable_targets
      ORDER BY inst_kind, label`,
  );
  return rows as PayableTarget[];
}

export interface StudentWallet {
  accountId: number;
  studentName: string;
  studentNo: string;
  balance: string;
}

/** Student spending wallets, with the owner's name — the "pay from" list. */
export async function listStudentSpendingWallets(): Promise<StudentWallet[]> {
  const { rows } = await pool.query(
    `SELECT sw.account_id::int AS "accountId",
            au.full_name  AS "studentName",
            st.student_no AS "studentNo",
            COALESCE(b.balance, 0)::text AS balance
       FROM student_wallet sw
       JOIN student  st ON st.student_id = sw.student_id
       JOIN app_user au ON au.user_id    = st.student_id
       LEFT JOIN account_balance b ON b.account_id = sw.account_id
      WHERE sw.wallet_purpose = 'spending'
      ORDER BY au.full_name`,
  );
  return rows as StudentWallet[];
}

/** Moves money via the SECURITY DEFINER make_transfer()/make_purchase() inside a
 *  SERIALIZABLE, retrying transaction. 'purchase' additionally fires round-up + loyalty. */
export async function makeTransfer(input: TransferInput): Promise<string> {
  const fn = input.kind === "purchase" ? "make_purchase" : "make_transfer"; // controlled literal, not user input
  return withTransaction(
    async (client) => {
      const { rows } = await client.query(
        `SELECT ${fn}($1, $2, $3::numeric, $4, $5::uuid, $6, $7) AS txn_id`,
        [input.from, input.to, input.amount, input.currency, input.idempotencyKey, input.description ?? "web payment", input.userId ?? null],
      );
      return String(rows[0].txn_id);
    },
    { userId: input.userId, isolation: "serializable" },
  );
}

export interface EventProgress {
  eventId: number;
  name: string;
  batch: string | null;
  rosterSize: number;
  target: string;
  collected: string;
  pctCollected: string | null;
}

/** Live collection progress per event (from the aggregate/window view). */
export async function listEventProgress(): Promise<EventProgress[]> {
  const { rows } = await pool.query(
    `SELECT event_id::int   AS "eventId",
            name, batch,
            roster_size::int AS "rosterSize",
            target::text, collected::text,
            pct_collected::text AS "pctCollected"
       FROM v_event_progress
      ORDER BY event_id`,
  );
  return rows as EventProgress[];
}

export interface Defaulter {
  eventId: number;
  studentName: string;
  expected: string;
  paid: string;
  outstanding: string;
}

/** The live defaulter list across events (roster EXCEPT fully-paid). */
export async function listDefaulters(): Promise<Defaulter[]> {
  const { rows } = await pool.query(
    `SELECT event_id::int AS "eventId",
            full_name     AS "studentName",
            expected_amount::text AS expected,
            paid::text, outstanding::text
       FROM v_event_defaulters
      ORDER BY event_id, full_name`,
  );
  return rows as Defaulter[];
}
