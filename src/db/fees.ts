import { pool } from "@/db/pool";
import { withTransaction } from "@/db/tx";

export interface FeeItem {
  feeItemId: number;
  name: string;
  category: string;
  amount: string;
  scopeKind: string;
  scopeRef: string | null;
  active: boolean;
  collectorLabel: string;
  assessed: number;
}

export async function listFeeItems(): Promise<FeeItem[]> {
  const { rows } = await pool.query(`
    SELECT fi.fee_item_id::int AS "feeItemId", fi.name, fi.category, fi.amount::text AS amount,
           fi.scope_kind AS "scopeKind", fi.scope_ref AS "scopeRef", fi.active,
           COALESCE(t.label, '#' || fi.collector_account_id) AS "collectorLabel",
           (SELECT count(*) FROM student_assessment sa WHERE sa.fee_item_id = fi.fee_item_id)::int AS assessed
      FROM fee_item fi
      LEFT JOIN v_payable_targets t ON t.account_id = fi.collector_account_id
     ORDER BY fi.fee_item_id`);
  return rows as FeeItem[];
}

export interface Payee {
  accountId: number;
  label: string;
  instKind: string;
}
export async function listPayees(): Promise<Payee[]> {
  const { rows } = await pool.query(
    `SELECT account_id::int AS "accountId", label, inst_kind AS "instKind" FROM v_payable_targets ORDER BY inst_kind, label`,
  );
  return rows as Payee[];
}

export interface CreateFeeInput {
  name: string;
  category: string;
  collector: number;
  amount: string;
  scopeKind: string;
  scopeRef: string | null;
}
export async function createFeeItem(adminId: number, i: CreateFeeInput): Promise<number> {
  return withTransaction(
    async (c) => {
      const { rows } = await c.query(`SELECT create_fee_item($1,$2,$3,$4,$5::numeric,$6,$7) AS id`, [
        adminId, i.name, i.category, i.collector, i.amount, i.scopeKind, i.scopeRef,
      ]);
      return Number(rows[0].id);
    },
    { userId: adminId },
  );
}

export async function assessFees(adminId: number, feeItemId: number, period: string): Promise<number> {
  return withTransaction(
    async (c) => {
      const { rows } = await c.query(`SELECT assess_fees($1,$2,$3) AS n`, [adminId, feeItemId, period]);
      return Number(rows[0].n);
    },
    { userId: adminId },
  );
}
