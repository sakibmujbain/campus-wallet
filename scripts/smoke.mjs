// Integration smoke test for the ledger + payment-hub. Proves every invariant
// end-to-end against real Postgres. Self-contained: builds its own campus
// entities via the open_* helpers, so it runs on a fresh CI database.
//
// Phase 0 invariants:  balanced transfer · idempotency · overdraft ·
//                      append-only (UPDATE/DELETE) · deferred zero-sum.
// Phase 1 invariants:  totality (no subtype-less account) · disjointness ·
//                      Row-Level Security isolation · audit trail ·
//                      cache↔ledger reconciliation.
import "dotenv/config";
import pg from "pg";

const connectionString = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
const needsSsl = /sslmode=require|supabase\.com/.test(connectionString ?? "");
const client = new pg.Client({ connectionString, ssl: needsSsl ? { rejectUnauthorized: false } : false });

let passed = 0;
const fail = (m) => { console.error(`  ✗ ${m}`); process.exitCode = 1; };
const ok = (m) => { console.log(`  ✓ ${m}`); passed++; };

async function expectError(promise, want, label) {
  try {
    await promise;
    fail(`${label} — expected an error but it succeeded`);
  } catch (err) {
    const hay = `${err.code ?? ""} ${err.message ?? ""}`;
    if (hay.includes(want)) ok(`${label} rejected (${err.code ?? "err"})`);
    else fail(`${label} — wrong error: ${err.message}`);
  }
}

await client.connect();
try {
  const tag = String(Date.now()); // unique suffix so re-runs don't collide
  const bal = async (id) =>
    (await client.query(`SELECT COALESCE(balance,0)::text AS b FROM account_balance WHERE account_id=$1`, [id])).rows[0]?.b;

  console.log("Building fresh campus entities…");
  const hallId = (await client.query(`INSERT INTO hall(name) VALUES ($1) RETURNING hall_id`, [`SmokeHall-${tag}`])).rows[0].hall_id;
  const treasury = (await client.query(`SELECT open_system_account('treasury','BDT',-1000000000000000) AS id`)).rows[0].id;

  async function mkStudent(name, ix) {
    const uid = (await client.query(
      `INSERT INTO app_user(email, full_name, role) VALUES ($1,$2,'student') RETURNING user_id`,
      [`${name.toLowerCase()}-${tag}@smoke.edu.bd`, name],
    )).rows[0].user_id;
    await client.query(
      `INSERT INTO student(student_id, student_no, enrollment_date, hall_id, batch) VALUES ($1,$2,'2021-08-01',$3,'2021')`,
      [uid, `SM-${tag}-${ix}`, hallId],
    );
    const spend = (await client.query(`SELECT open_student_wallet($1,'spending') AS id`, [uid])).rows[0].id;
    return { uid, spend };
  }
  const alice = await mkStudent("Alice", 1);
  const bob = await mkStudent("Bob", 2);
  await client.query(`SELECT make_transfer($1,$2,1000.00,'BDT',gen_random_uuid(),'opening')`, [treasury, alice.spend]);

  // ── Phase 0 invariants ─────────────────────────────────────────────────
  await client.query(`SELECT make_transfer($1,$2,250.50,'BDT',gen_random_uuid(),'t')`, [alice.spend, bob.spend]);
  if ((await bal(alice.spend)) === "749.5000" && (await bal(bob.spend)) === "250.5000") ok("balanced transfer derives correct balances");
  else fail(`balances wrong: alice=${await bal(alice.spend)} bob=${await bal(bob.spend)}`);

  const key = (await client.query(`SELECT gen_random_uuid() AS k`)).rows[0].k;
  const t1 = (await client.query(`SELECT make_transfer($1,$2,10.00,'BDT',$3,'idem')`, [alice.spend, bob.spend, key])).rows[0].make_transfer;
  const t2 = (await client.query(`SELECT make_transfer($1,$2,10.00,'BDT',$3,'idem')`, [alice.spend, bob.spend, key])).rows[0].make_transfer;
  if (t1 === t2 && (await bal(bob.spend)) === "260.5000") ok("idempotent replay does not double-charge");
  else fail(`idempotency failed: t1=${t1} t2=${t2} bob=${await bal(bob.spend)}`);

  await expectError(
    client.query(`SELECT make_transfer($1,$2,999999.00,'BDT',gen_random_uuid(),'od')`, [bob.spend, alice.spend]),
    "overdraft floor", "overdraft debit");

  await expectError(client.query(`UPDATE ledger_entry SET amount = amount + 1`), "append-only", "ledger UPDATE");
  await expectError(client.query(`DELETE FROM ledger_entry`), "append-only", "ledger DELETE");

  await expectError((async () => {
    await client.query("BEGIN");
    const txn = (await client.query(`INSERT INTO ledger_transaction (idempotency_key, kind) VALUES (gen_random_uuid(),'bad') RETURNING txn_id`)).rows[0].txn_id;
    await client.query(`INSERT INTO ledger_entry (txn_id, account_id, currency, amount, txn_type) VALUES ($1,$2,'BDT',5.00,'bad')`, [txn, alice.spend]);
    await client.query("COMMIT");
  })(), "does not balance", "unbalanced transaction");
  await client.query("ROLLBACK").catch(() => {});

  // ── Phase 1 invariants ─────────────────────────────────────────────────
  // Totality: an account with no subtype row must be rejected at COMMIT.
  await expectError((async () => {
    await client.query("BEGIN");
    await client.query(`INSERT INTO account (account_kind, currency) VALUES ('student','BDT')`);
    await client.query("COMMIT");
  })(), "has no subtype", "account without subtype");
  await client.query("ROLLBACK").catch(() => {});

  // Disjointness: a student account cannot also be a system_account (composite FK).
  await expectError(
    client.query(`INSERT INTO system_account (account_id, system_role) VALUES ($1,'treasury')`, [alice.spend]),
    "23503", "disjoint specialization (composite FK)");

  // Row-Level Security: under a NON-bypass role + Alice's identity, only Alice's
  // wallets are visible. Pick a role this environment allows us to assume:
  // 'app_write' on vanilla/CI (postgres is superuser), 'authenticated' on Supabase.
  const canSetRole = async (role) => {
    try { await client.query("BEGIN"); await client.query(`SET LOCAL ROLE ${role}`); await client.query("ROLLBACK"); return true; }
    catch { await client.query("ROLLBACK").catch(() => {}); return false; }
  };
  const demoRole = (await canSetRole("app_write")) ? "app_write" : "authenticated";

  await client.query("BEGIN");
  await client.query(`SELECT set_config('app.current_user_id',$1,true)`, [String(alice.uid)]);
  await client.query(`SET LOCAL ROLE ${demoRole}`); // literal, not user input
  const rls = (await client.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE student_id = $1)::int AS mine,
            count(*) FILTER (WHERE account_id = $2)::int AS bobs
       FROM student_wallet`, [alice.uid, bob.spend])).rows[0];
  await client.query("COMMIT"); // SET LOCAL ROLE auto-resets at txn end
  if (rls.total >= 1 && rls.total === rls.mine && rls.bobs === 0) ok(`RLS isolates wallets via '${demoRole}' (Alice sees ${rls.mine}, Bob hidden)`);
  else fail(`RLS leaked via '${demoRole}': total=${rls.total} mine=${rls.mine} bobs=${rls.bobs}`);

  // Audit trail: wallet creations were captured.
  const audited = (await client.query(`SELECT count(*)::int AS n FROM audit_log WHERE table_name='student_wallet' AND op='INSERT'`)).rows[0].n;
  if (audited >= 2) ok(`audit trail captured wallet inserts (${audited})`);
  else fail(`audit trail empty (${audited})`);

  // Reconciliation: the cache equals SUM(ledger) for every account (0 drift rows).
  const drift = (await client.query(`SELECT count(*)::int AS n FROM reconcile_balances()`)).rows[0].n;
  if (drift === 0) ok("balance cache reconciles with the ledger (0 drift)");
  else fail(`reconciliation drift on ${drift} account(s)`);

  // Regression: the DEFERRED integrity checks must NOT false-fail when money is
  // committed by a NON-bypass (RLS-subject) role — the fix that makes them SECURITY DEFINER.
  if (await canSetRole("app_write")) {
    try {
      await client.query("BEGIN");
      await client.query(`SELECT set_config('app.current_user_id',$1,true)`, [String(alice.uid)]);
      await client.query("SET LOCAL ROLE app_write");
      await client.query(`SELECT make_transfer($1,$2,5.00,'BDT',gen_random_uuid(),'rls-commit')`, [alice.spend, bob.spend]);
      await client.query("COMMIT"); // deferred zero-sum fires here, as app_write
      ok("transfer commits under non-bypass role (deferred checks bypass RLS)");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      fail(`deferred check false-failed under app_write: ${e.message}`);
    }
  } else {
    const secdef = (await client.query(
      `SELECT bool_and(prosecdef) AS ok FROM pg_proc
        WHERE proname IN ('assert_txn_balanced','assert_txn_has_legs','assert_account_has_subtype','assert_inst_has_subtype')`)).rows[0].ok;
    if (secdef === true) ok("integrity triggers are SECURITY DEFINER (bypass RLS at COMMIT)");
    else fail("integrity triggers are NOT SECURITY DEFINER — would false-fail under RLS");
  }

  console.log(`\n${process.exitCode ? "SOME CHECKS FAILED" : "ALL CHECKS PASSED"} — ${passed} passed`);
} finally {
  await client.end();
}
