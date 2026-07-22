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
    `SELECT account_id   AS "accountId",
            account_kind AS "accountKind",
            currency,
            balance::text AS balance
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
}

/** Calls the SECURITY DEFINER make_transfer() inside a SERIALIZABLE, retrying txn. */
export async function makeTransfer(input: TransferInput): Promise<string> {
  return withTransaction(
    async (client) => {
      const { rows } = await client.query(
        `SELECT make_transfer($1, $2, $3::numeric, $4, $5::uuid, $6) AS txn_id`,
        [input.from, input.to, input.amount, input.currency, input.idempotencyKey, input.description ?? "web transfer"],
      );
      return String(rows[0].txn_id);
    },
    { isolation: "serializable" },
  );
}
