// Integration smoke test for the ledger spine. Proves the core invariants end-to-end:
//   1. A balanced transfer moves money and derives balances correctly.
//   2. Idempotency: replaying the same key does NOT double-charge.
//   3. Overdraft: a debit below the account's floor is rejected.
//   4. Immutability: UPDATE/DELETE on ledger rows is rejected.
//   5. Balance integrity: an unbalanced transaction is rejected at COMMIT (deferred trigger).
// Run against a throwaway DB (CI uses a Postgres service container).
import "dotenv/config";
import pg from "pg";

const connectionString = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
const needsSsl = /sslmode=require|supabase\.com/.test(connectionString ?? "");
const client = new pg.Client({
  connectionString,
  ssl: needsSsl ? { rejectUnauthorized: false } : false,
});

let passed = 0;
const fail = (msg) => {
  console.error(`  ✗ ${msg}`);
  process.exitCode = 1;
};
const ok = (msg) => {
  console.log(`  ✓ ${msg}`);
  passed++;
};

async function expectError(promise, wantCodeOrText, label) {
  try {
    await promise;
    fail(`${label} — expected an error but the statement succeeded`);
  } catch (err) {
    const hay = `${err.code ?? ""} ${err.message ?? ""}`;
    if (hay.includes(wantCodeOrText)) ok(`${label} rejected (${err.code ?? "err"})`);
    else fail(`${label} — wrong error: ${err.message}`);
  }
}

await client.connect();
try {
  console.log("Seeding fresh demo accounts…");
  const { rows } = await client.query(`
    WITH open AS (
      INSERT INTO account (account_kind, currency, overdraft_floor)
      VALUES ('system', 'BDT', -1000000000000000) RETURNING account_id
    ), a AS (
      INSERT INTO account (account_kind, currency, overdraft_floor)
      VALUES ('student', 'BDT', 0) RETURNING account_id
    ), b AS (
      INSERT INTO account (account_kind, currency, overdraft_floor)
      VALUES ('student', 'BDT', 0) RETURNING account_id
    )
    SELECT (SELECT account_id FROM open) AS open_id,
           (SELECT account_id FROM a)    AS alice_id,
           (SELECT account_id FROM b)    AS bob_id
  `);
  const { open_id, alice_id, bob_id } = rows[0];

  // Fund Alice 1000 from the opening treasury.
  await client.query(`SELECT make_transfer($1,$2,1000.00,'BDT',gen_random_uuid(),'opening')`, [open_id, alice_id]);

  // 1. Balanced transfer Alice -> Bob 250.50
  await client.query(`SELECT make_transfer($1,$2,250.50,'BDT',gen_random_uuid(),'test')`, [alice_id, bob_id]);
  const bal = async (id) =>
    (await client.query(`SELECT COALESCE(balance,0)::text AS b FROM account_balance WHERE account_id=$1`, [id])).rows[0]?.b;
  if ((await bal(alice_id)) === "749.5000" && (await bal(bob_id)) === "250.5000") ok("balanced transfer derives correct balances");
  else fail(`balances wrong: alice=${await bal(alice_id)} bob=${await bal(bob_id)}`);

  // 2. Idempotency: same key twice -> one posting.
  const key = (await client.query(`SELECT gen_random_uuid() AS k`)).rows[0].k;
  const t1 = (await client.query(`SELECT make_transfer($1,$2,10.00,'BDT',$3,'idem')`, [alice_id, bob_id, key])).rows[0].make_transfer;
  const t2 = (await client.query(`SELECT make_transfer($1,$2,10.00,'BDT',$3,'idem')`, [alice_id, bob_id, key])).rows[0].make_transfer;
  if (t1 === t2 && (await bal(bob_id)) === "260.5000") ok("idempotent replay does not double-charge");
  else fail(`idempotency failed: t1=${t1} t2=${t2} bob=${await bal(bob_id)}`);

  // 3. Overdraft: Bob (floor 0) cannot send more than he has.
  await expectError(
    client.query(`SELECT make_transfer($1,$2,999999.00,'BDT',gen_random_uuid(),'overdraft')`, [bob_id, alice_id]),
    "overdraft floor",
    "overdraft debit",
  );

  // 4. Immutability: cannot UPDATE or DELETE a ledger entry.
  await expectError(client.query(`UPDATE ledger_entry SET amount = amount + 1`), "append-only", "ledger UPDATE");
  await expectError(client.query(`DELETE FROM ledger_entry`), "append-only", "ledger DELETE");

  // 5. Unbalanced transaction is rejected at COMMIT by the deferred constraint trigger.
  await expectError(
    (async () => {
      await client.query("BEGIN");
      const txn = (await client.query(
        `INSERT INTO ledger_transaction (idempotency_key, kind) VALUES (gen_random_uuid(),'bad') RETURNING txn_id`,
      )).rows[0].txn_id;
      // single non-zero leg -> cannot net to zero
      await client.query(`INSERT INTO ledger_entry (txn_id, account_id, currency, amount, txn_type) VALUES ($1,$2,'BDT',5.00,'bad')`, [txn, alice_id]);
      await client.query("COMMIT"); // deferred check fires here
    })(),
    "does not balance",
    "unbalanced transaction",
  );
  await client.query("ROLLBACK").catch(() => {});

  console.log(`\n${process.exitCode ? "SOME CHECKS FAILED" : "ALL CHECKS PASSED"} — ${passed} passed`);
} finally {
  await client.end();
}
