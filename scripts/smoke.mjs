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
  const smokeBatch = `B${tag}`;   // per-run batch so the Phase-D cohort is exactly our 3 students
  const bal = async (id) =>
    (await client.query(`SELECT COALESCE(balance,0)::text AS b FROM account_balance WHERE account_id=$1`, [id])).rows[0]?.b;

  console.log("Building fresh campus entities…");
  const hallId = (await client.query(`INSERT INTO hall(name) VALUES ($1) RETURNING hall_id`, [`SmokeHall-${tag}`])).rows[0].hall_id;
  const treasury = (await client.query(`SELECT open_system_account('treasury','BDT',-1000000000000000) AS id`)).rows[0].id;
  await client.query(`SELECT open_system_account('loyalty_pool','BDT',-1000000000000000)`); // funds redemptions
  const cafeTill = (await client.query(`SELECT open_cafeteria_wallet($1,null) AS id`, [`SmokeCafe-${tag}`])).rows[0].id;

  async function mkStudent(name, ix) {
    const uid = (await client.query(
      `INSERT INTO app_user(email, full_name, role) VALUES ($1,$2,'student') RETURNING user_id`,
      [`${name.toLowerCase()}-${tag}@smoke.edu.bd`, name],
    )).rows[0].user_id;
    await client.query(
      `INSERT INTO student(student_id, student_no, enrollment_date, hall_id, batch) VALUES ($1,$2,(current_date - INTERVAL '1 year'),$3,$4)`,
      [uid, `SM-${tag}-${ix}`, hallId, smokeBatch],
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

  // ── Phase 2: e-KYC state machine, round-up savings, loyalty ────────────
  // A fully-provisioned student: funded spending, LOCKED savings, round-up on.
  const carol = await mkStudent("Carol", 3);
  const carolSave = (await client.query(`SELECT open_student_wallet($1,'savings') AS id`, [carol.uid])).rows[0].id;
  await client.query(`UPDATE student_wallet SET locked_until = current_date + 30 WHERE account_id = $1`, [carolSave]);
  await client.query(`INSERT INTO savings_config (student_id, enabled, step, locked_until) VALUES ($1, true, 10, current_date + 30)`, [carol.uid]);
  await client.query(`SELECT make_transfer($1,$2,1000.00,'BDT',gen_random_uuid(),'fund')`, [treasury, carol.spend]);

  // e-KYC: submit -> illegal transition blocked -> one-active enforced -> approve.
  const kycId = (await client.query(`SELECT submit_kyc($1,'edu_email') AS id`, [carol.uid])).rows[0].id;
  await expectError(
    client.query(`UPDATE kyc_verification SET status='alumni' WHERE verification_id=$1`, [kycId]),
    "illegal kyc transition", "illegal KYC transition (pending->alumni)");
  await expectError(
    client.query(`SELECT submit_kyc($1,'id_card')`, [carol.uid]),
    "23505", "second active KYC blocked (partial unique)");
  await client.query(`SELECT approve_kyc($1)`, [kycId]);
  const kstat = (await client.query(`SELECT status FROM kyc_verification WHERE verification_id=$1`, [kycId])).rows[0].status;
  if (kstat === "verified") ok("KYC pending->verified via approve()"); else fail(`KYC not verified: ${kstat}`);

  // Round-up: a 33 BDT purchase rounds to 40 -> 7 BDT swept into the locked savings.
  await client.query(`SELECT make_purchase($1,$2,33.00,'BDT',gen_random_uuid(),'cafeteria')`, [carol.spend, cafeTill]);
  const cSave = await bal(carolSave);
  const cSpend = await bal(carol.spend);
  if (cSave === "7.0000" && cSpend === "960.0000") ok("round-up sweeps spare into locked savings (33 -> +7)");
  else fail(`round-up wrong: savings=${cSave} spending=${cSpend}`);

  // Tuition Shield: debiting the locked savings wallet is rejected.
  await expectError(
    client.query(`SELECT make_transfer($1,$2,1.00,'BDT',gen_random_uuid(),'withdraw')`, [carolSave, carol.spend]),
    "is locked until", "locked-savings withdrawal");

  // Loyalty: the purchase accrued floor(33*0.1)=3 points (derived SUM).
  const pts = (await client.query(`SELECT COALESCE(points,0)::text AS p FROM v_point_balance WHERE student_id=$1`, [carol.uid])).rows[0]?.p;
  if (pts === "3.0000") ok("loyalty points accrue on purchase (33 BDT -> 3 pts)"); else fail(`points wrong: ${pts}`);

  await expectError(
    client.query(`SELECT redeem_points($1, 999999, gen_random_uuid())`, [carol.uid]),
    "insufficient points", "over-redemption blocked");

  // Redeem 3 pts -> 0.03 BDT credited; idempotent under replay.
  const redeemKey = (await client.query(`SELECT gen_random_uuid() AS k`)).rows[0].k;
  await client.query(`SELECT redeem_points($1, 3, $2)`, [carol.uid, redeemKey]);
  await client.query(`SELECT redeem_points($1, 3, $2)`, [carol.uid, redeemKey]); // replay
  const ptsAfter = (await client.query(`SELECT COALESCE(points,0)::text AS p FROM v_point_balance WHERE student_id=$1`, [carol.uid])).rows[0]?.p;
  const spendAfter = await bal(carol.spend);
  if (ptsAfter === "0.0000" && spendAfter === "960.0300") ok("points redeemed to BDT, atomic + idempotent"); else fail(`redeem wrong: pts=${ptsAfter} spend=${spendAfter}`);

  // Leaderboard: window-RANK() materialized view refreshes.
  await client.query(`SELECT refresh_leaderboard()`);
  const lb = (await client.query(`SELECT count(*)::int AS n FROM mv_loyalty_leaderboard`)).rows[0].n;
  if (lb >= 1) ok(`loyalty leaderboard refreshes (${lb} ranked)`); else fail("leaderboard empty");

  // The writer functions the app roles call must be SECURITY DEFINER — the app
  // holds only SELECT, so without it they'd error under the granted roles (this
  // check runs as owner, which is exactly what masks the bug otherwise).
  const writersSecdef = (await client.query(
    `SELECT bool_and(prosecdef) AS ok FROM pg_proc
      WHERE proname IN ('submit_kyc','approve_kyc','refresh_leaderboard','make_purchase','redeem_points')`)).rows[0].ok;
  if (writersSecdef === true) ok("KYC/loyalty writer functions are SECURITY DEFINER"); else fail("a writer function is not SECURITY DEFINER");

  // ── Phase 3: event wallets, defaulter list (EXCEPT), club overlap (INTERSECT) ──
  const eventId = (await client.query(`SELECT create_event('Smoke Picnic','2024',$1,NULL) AS id`, [alice.uid])).rows[0].id;
  await client.query(`INSERT INTO event_roster(event_id, student_id, expected_amount) VALUES ($1,$2,500),($1,$3,500),($1,$4,500)`, [eventId, alice.uid, bob.uid, carol.uid]);
  await client.query(`SELECT pay_event($1,$2,500.00,gen_random_uuid())`, [alice.spend, eventId]); // full
  await client.query(`SELECT pay_event($1,$2,200.00,gen_random_uuid())`, [bob.spend, eventId]);   // partial; carol unpaid

  const defRows = (await client.query(`SELECT student_id::int AS sid FROM v_event_defaulters WHERE event_id=$1`, [eventId])).rows;
  const defSet = new Set(defRows.map((r) => r.sid));
  if (defRows.length === 2 && defSet.has(Number(bob.uid)) && defSet.has(Number(carol.uid)) && !defSet.has(Number(alice.uid)))
    ok("defaulter list via EXCEPT (Bob partial + Carol unpaid; Alice cleared)");
  else fail(`defaulters wrong: ${JSON.stringify(defRows)}`);

  await client.query(`SELECT refund_event($1,$2,500.00,gen_random_uuid())`, [eventId, alice.spend]);
  const defAfter = (await client.query(`SELECT count(*)::int AS n FROM v_event_defaulters WHERE event_id=$1`, [eventId])).rows[0].n;
  if (defAfter === 3) ok("refund re-adds the student to the defaulter list"); else fail(`refund re-add wrong: ${defAfter}`);

  // Refund cap: can't refund more than the student's own net contribution (Bob paid 200).
  await expectError(
    client.query(`SELECT refund_event($1,$2,999.00,gen_random_uuid())`, [eventId, bob.spend]),
    "exceeds student net contribution", "over-refund blocked (cap)");

  const clubA = (await client.query(`INSERT INTO club(name) VALUES ($1) RETURNING club_id`, [`SmokeClubA-${tag}`])).rows[0].club_id;
  const clubB = (await client.query(`INSERT INTO club(name) VALUES ($1) RETURNING club_id`, [`SmokeClubB-${tag}`])).rows[0].club_id;
  await client.query(`INSERT INTO club_member(club_id, student_id) VALUES ($1,$2),($1,$3)`, [clubA, alice.uid, bob.uid]);
  await client.query(`INSERT INTO club_member(club_id, student_id) VALUES ($1,$2),($1,$3)`, [clubB, bob.uid, carol.uid]);
  const overlap = (await client.query(`SELECT student_id::int AS sid FROM club_overlap($1,$2)`, [clubA, clubB])).rows;
  if (overlap.length === 1 && Number(overlap[0].sid) === Number(bob.uid)) ok("club overlap via INTERSECT (only the shared member)");
  else fail(`INTERSECT wrong: ${JSON.stringify(overlap)}`);

  // Pooled totality: a bare pooled account with no event subtype is rejected at COMMIT.
  await expectError((async () => {
    await client.query("BEGIN");
    await client.query(`INSERT INTO account (account_kind, currency) VALUES ('pooled','BDT')`);
    await client.query("COMMIT");
  })(), "has no subtype", "pooled account without subtype");
  await client.query("ROLLBACK").catch(() => {});

  // ── Auth provisioning (provision_student) ──
  const authUid = (await client.query(`SELECT gen_random_uuid() AS u`)).rows[0].u;
  const pid1 = (await client.query(`SELECT provision_student($1::uuid, $2, $3) AS id`, [authUid, `newstu-${tag}@x.edu.bd`, "New Student"])).rows[0].id;
  const pid2 = (await client.query(`SELECT provision_student($1::uuid, $2, $3) AS id`, [authUid, `newstu-${tag}@x.edu.bd`, "New Student"])).rows[0].id;
  if (pid1 === pid2) ok("provision_student is idempotent"); else fail(`provision not idempotent: ${pid1} ${pid2}`);

  const prov = (await client.query(
    `SELECT (SELECT status FROM kyc_verification WHERE student_id=$1) AS kyc,
            (SELECT count(*)::int FROM student_wallet WHERE student_id=$1) AS wallets,
            (SELECT b.balance::text FROM student_wallet sw JOIN account_balance b ON b.account_id=sw.account_id
              WHERE sw.student_id=$1 AND sw.wallet_purpose='spending') AS spend`, [pid1])).rows[0];
  if (prov.kyc === "verified" && prov.wallets === 2 && prov.spend === "1000.0000")
    ok("provisioned student: verified KYC + 2 wallets + 1000 welcome credit");
  else fail(`provision wrong: ${JSON.stringify(prov)}`);

  await expectError(
    client.query(`SELECT provision_student(gen_random_uuid(), $1, 'X')`, [`bad-${tag}@gmail.com`]),
    "requires a .edu.bd", "non-.edu.bd registration blocked");

  // ── Roles & authorization (Phase A) ──
  const adminUid = (await client.query(`SELECT provision_student(gen_random_uuid(), $1, 'Admin') AS id`, [`admin-${tag}@x.edu.bd`])).rows[0].id;
  const targetUid = (await client.query(`SELECT provision_student(gen_random_uuid(), $1, 'Target') AS id`, [`target-${tag}@x.edu.bd`])).rows[0].id;

  await client.query(`SELECT ensure_admin($1)`, [adminUid]);
  if ((await client.query(`SELECT is_admin($1) AS a`, [adminUid])).rows[0].a === true) ok("ensure_admin grants admin"); else fail("ensure_admin failed");

  await expectError(client.query(`SELECT request_role($1,'admin')`, [targetUid]), "cannot request the admin role", "requesting admin blocked");
  await expectError(client.query(`SELECT promote_user($1,$2,'cr')`, [targetUid, adminUid]), "only an admin", "non-admin promote blocked (42501)");

  await client.query(`SELECT promote_user($1,$2,'cr','batch','CSE-2021')`, [adminUid, targetUid]);
  if ((await client.query(`SELECT count(*)::int c FROM role_grant WHERE user_id=$1 AND capability='cr'`, [targetUid])).rows[0].c === 1) ok("admin promotes user to cr (scoped)"); else fail("promote failed");

  const reqId = (await client.query(`SELECT request_role($1,'club_exec','club','Robotics') AS id`, [targetUid])).rows[0].id;
  await client.query(`SELECT decide_role_request($1,$2,true)`, [adminUid, reqId]);
  if ((await client.query(`SELECT count(*)::int c FROM role_grant WHERE user_id=$1 AND capability='club_exec'`, [targetUid])).rows[0].c === 1) ok("approve role request grants the capability"); else fail("decide_role_request failed");

  // Department assignment (Phase C): admin sets it; non-admin is blocked; blank clears it.
  await client.query(`SELECT set_student_department($1,$2,'CSE')`, [adminUid, targetUid]);
  if ((await client.query(`SELECT department FROM student WHERE student_id=$1`, [targetUid])).rows[0].department === "CSE") ok("admin sets student department"); else fail("set_student_department did not set");
  await expectError(client.query(`SELECT set_student_department($1,$2,'EEE')`, [targetUid, adminUid]), "only an admin", "non-admin department set blocked (42501)");
  await client.query(`SELECT set_student_department($1,$2,'   ')`, [adminUid, targetUid]);
  if ((await client.query(`SELECT department FROM student WHERE student_id=$1`, [targetUid])).rows[0].department === null) ok("blank department normalizes to NULL"); else fail("blank department not cleared");

  // ── Fees, dues, top-up (Phase B) ──
  const feeId = (await client.query(`SELECT create_fee_item($1,'Smoke Fee','misc',$2,250.00,'all',NULL) AS id`, [adminUid, cafeTill])).rows[0].id;
  const assessed = (await client.query(`SELECT assess_fees($1,$2,$3) AS n`, [adminUid, feeId, `SmokePeriod-${tag}`])).rows[0].n;
  if (assessed >= 1) ok(`assess_fees snapshots dues to ${assessed} student(s)`); else fail("assess_fees created none");

  await expectError(client.query(`SELECT create_fee_item($1,'X','misc',$2,10.00,'all',NULL)`, [targetUid, cafeTill]), "only an admin", "non-admin fee create blocked");

  const aAssess = (await client.query(`SELECT assessment_id::int AS id FROM student_assessment WHERE fee_item_id=$1 AND student_id=$2`, [feeId, alice.uid])).rows[0].id;
  await client.query("BEGIN");
  await client.query(`SELECT set_config('app.current_user_id',$1,true)`, [String(alice.uid)]);
  const payTxn = (await client.query(`SELECT pay_fee($1, gen_random_uuid()) AS txn`, [aAssess])).rows[0].txn;
  await client.query("COMMIT");
  if ((await client.query(`SELECT status FROM student_assessment WHERE assessment_id=$1`, [aAssess])).rows[0].status === "paid") ok("pay_fee settles the assessment at the exact amount");
  else fail("pay_fee did not mark paid");
  if ((await client.query(`SELECT count(*)::int c FROM point_ledger WHERE source_txn_id=$1`, [payTxn])).rows[0].c === 0) ok("mandatory fee earns NO loyalty points"); else fail("fee minted points");

  const bAssess = (await client.query(`SELECT assessment_id::int AS id FROM student_assessment WHERE fee_item_id=$1 AND student_id=$2`, [feeId, bob.uid])).rows[0].id;
  await expectError((async () => {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.current_user_id',$1,true)`, [String(alice.uid)]);
    await client.query(`SELECT pay_fee($1, gen_random_uuid())`, [bAssess]);
    await client.query("COMMIT");
  })(), "not assessed to you", "paying someone else's fee blocked");
  await client.query("ROLLBACK").catch(() => {});

  const cBefore = await bal(carol.spend);
  await client.query("BEGIN");
  await client.query(`SELECT set_config('app.current_user_id',$1,true)`, [String(carol.uid)]);
  await client.query(`SELECT top_up(500.00, gen_random_uuid())`);
  await client.query("COMMIT");
  const cAfter = await bal(carol.spend);
  if (Math.round((Number(cAfter) - Number(cBefore)) * 100) === 50000) ok("top_up credits the spending wallet (+500)"); else fail(`top_up wrong: ${cBefore} -> ${cAfter}`);

  // Idempotency hardening: a key that paid one due CANNOT settle another same-collector due for free.
  await client.query(`SELECT assess_fees($1,$2,$3)`, [adminUid, feeId, `SmokeP2-${tag}`]); // 2nd period, same collector, all students
  const c1 = (await client.query(`SELECT assessment_id::int AS id FROM student_assessment WHERE fee_item_id=$1 AND student_id=$2 AND period=$3`, [feeId, carol.uid, `SmokePeriod-${tag}`])).rows[0].id;
  const c2 = (await client.query(`SELECT assessment_id::int AS id FROM student_assessment WHERE fee_item_id=$1 AND student_id=$2 AND period=$3`, [feeId, carol.uid, `SmokeP2-${tag}`])).rows[0].id;
  const reuseKey = (await client.query(`SELECT gen_random_uuid() AS k`)).rows[0].k;
  await client.query("BEGIN");
  await client.query(`SELECT set_config('app.current_user_id',$1,true)`, [String(carol.uid)]);
  const c1txn = (await client.query(`SELECT pay_fee($1,$2::uuid) AS t`, [c1, reuseKey])).rows[0].t;
  await client.query("COMMIT");
  await expectError((async () => {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.current_user_id',$1,true)`, [String(carol.uid)]);
    await client.query(`SELECT pay_fee($1,$2::uuid)`, [c2, reuseKey]);
    await client.query("COMMIT");
  })(), "already settled another fee", "reused idem key can't clear a second due");
  await client.query("ROLLBACK").catch(() => {});

  await client.query("BEGIN");
  await client.query(`SELECT set_config('app.current_user_id',$1,true)`, [String(carol.uid)]);
  const c1txn2 = (await client.query(`SELECT pay_fee($1,$2::uuid) AS t`, [c1, reuseKey])).rows[0].t;
  await client.query("COMMIT");
  if (c1txn === c1txn2) ok("paying an already-paid fee replays idempotently (same txn)"); else fail(`retry not idempotent: ${c1txn} vs ${c1txn2}`);

  // ── Organizer console: scoped drives, lifecycle, reminders, settle (Phase D) ──
  // Grant the target a CR scope over the smoke students' batch ('2024'), then prove
  // scope-enforced creation, roster auto-populate, and the settlement guardrails.
  await client.query(`SELECT promote_user($1,$2,'cr','batch',$3)`, [adminUid, targetUid, smokeBatch]);

  await expectError(client.query(`SELECT create_drive($1,'Rogue Drive','batch',$2,300)`, [bob.uid, smokeBatch]),
    "42501", "create_drive blocked for a non-covering actor");

  const drive = (await client.query(`SELECT create_drive($1,'Smoke Batch Trip','batch',$2,300) AS id`, [targetUid, smokeBatch])).rows[0].id;
  const rosterN = (await client.query(`SELECT count(*)::int AS n FROM event_roster WHERE event_id=$1`, [drive])).rows[0].n;
  if (rosterN === 3) ok("create_drive auto-populates the batch cohort onto the roster (3)"); else fail(`roster wrong: ${rosterN}`);

  // Roster edit: remove then re-add a non-contributor.
  await client.query(`SELECT remove_from_roster($1,$2,$3)`, [targetUid, drive, carol.uid]);
  await client.query(`SELECT add_to_roster($1,$2,$3,300)`, [targetUid, drive, carol.uid]);
  if ((await client.query(`SELECT count(*)::int AS n FROM event_roster WHERE event_id=$1`, [drive])).rows[0].n === 3) ok("roster remove + re-add round-trips"); else fail("roster edit wrong");

  // Payments: Alice full (300), Bob partial (100) -> Bob + Carol are defaulters.
  // (Top Bob up first — his smoke wallet is nearly drained by the earlier tests.)
  const dwallet = (await client.query(`SELECT account_id::int AS id FROM event_wallet WHERE event_id=$1`, [drive])).rows[0].id;
  await client.query(`SELECT make_transfer($1,$2,500.00,'BDT',gen_random_uuid(),'drive funding')`, [treasury, bob.spend]);
  await client.query(`SELECT pay_event($1,$2,300.00,gen_random_uuid())`, [alice.spend, drive]);
  await client.query(`SELECT pay_event($1,$2,100.00,gen_random_uuid())`, [bob.spend, drive]);

  await expectError(client.query(`SELECT remove_from_roster($1,$2,$3)`, [targetUid, drive, alice.uid]),
    "with contributions", "cannot remove a student who has paid");

  // Closed drives reject new payments.
  await client.query(`SELECT set_drive_status($1,$2,'closed')`, [targetUid, drive]);
  await expectError(client.query(`SELECT pay_event($1,$2,300.00,gen_random_uuid())`, [carol.spend, drive]),
    "not open for payment", "payment into a closed drive blocked");
  await client.query(`SELECT set_drive_status($1,$2,'open')`, [targetUid, drive]);

  // Reminders land as notifications for defaulters only (Bob + Carol, never Alice).
  const reminded = (await client.query(`SELECT remind_defaulters($1,$2) AS n`, [targetUid, drive])).rows[0].n;
  const noteRows = (await client.query(
    `SELECT count(*) FILTER (WHERE user_id=$1)::int AS bob,
            count(*) FILTER (WHERE user_id=$2)::int AS carol,
            count(*) FILTER (WHERE user_id=$3)::int AS alice
       FROM notification WHERE kind='event_reminder'`, [bob.uid, carol.uid, alice.uid])).rows[0];
  if (reminded === 2 && noteRows.bob === 1 && noteRows.carol === 1 && noteRows.alice === 0)
    ok("remind_defaulters notifies only the unpaid (Bob + Carol)"); else fail(`remind wrong: ${reminded} ${JSON.stringify(noteRows)}`);

  const remind2 = (await client.query(`SELECT remind_defaulters($1,$2) AS n`, [targetUid, drive])).rows[0].n;
  if (remind2 === 0) ok("remind_defaulters is idempotent while reminders stay unread (0 new)"); else fail(`second remind not idempotent: ${remind2}`);

  // Settlement destination MUST be institutional — never a personal wallet.
  await expectError(client.query(`SELECT settle_event($1,$2,$3,gen_random_uuid())`, [targetUid, drive, alice.spend]),
    "must be an institutional wallet", "settle to a student wallet blocked");

  const cafeBefore = await bal(cafeTill);
  const settleTxn = (await client.query(`SELECT settle_event($1,$2,$3,gen_random_uuid()) AS t`, [targetUid, drive, cafeTill])).rows[0].t;
  const cafeAfter = await bal(cafeTill);
  const drivBal = await bal(dwallet);
  const dStatus = (await client.query(`SELECT status FROM event WHERE event_id=$1`, [drive])).rows[0].status;
  if (dStatus === "settled" && drivBal === "0.0000" && Math.round((Number(cafeAfter) - Number(cafeBefore)) * 100) === 40000)
    ok("settle_event sweeps the pool to an institutional treasury (+400) and marks settled");
  else fail(`settle wrong: status=${dStatus} pool=${drivBal} cafeΔ=${Number(cafeAfter) - Number(cafeBefore)}`);

  const reSettle = (await client.query(`SELECT settle_event($1,$2,$3,gen_random_uuid()) AS t`, [targetUid, drive, cafeTill])).rows[0].t;
  if (String(reSettle) === String(settleTxn)) ok("re-settling a settled drive is idempotent (same txn)"); else fail(`re-settle not idempotent: ${settleTxn} vs ${reSettle}`);

  await expectError(client.query(`SELECT pay_event($1,$2,300.00,gen_random_uuid())`, [carol.spend, drive]),
    "not open for payment", "payment into a settled drive blocked");
  await expectError(client.query(`SELECT refund_event($1,$2,50.00,gen_random_uuid())`, [drive, bob.spend]),
    "refunds are closed", "refund on a settled drive blocked (clear message, not overdraft)");

  // ── Admin control-plane ops: KYC approval + payee provisioning (Phase E) ──
  const dave = await mkStudent("Dave", 4);
  const daveKyc = (await client.query(`SELECT submit_kyc($1,'edu_email') AS id`, [dave.uid])).rows[0].id;
  await expectError(client.query(`SELECT admin_approve_kyc($1,$2)`, [targetUid, daveKyc]),
    "42501", "non-admin KYC approve blocked");
  await client.query(`SELECT admin_approve_kyc($1,$2)`, [adminUid, daveKyc]);
  if ((await client.query(`SELECT status FROM kyc_verification WHERE verification_id=$1`, [daveKyc])).rows[0].status === "verified")
    ok("admin_approve_kyc verifies a pending e-KYC"); else fail("admin_approve_kyc did not verify");
  await expectError(client.query(`SELECT admin_approve_kyc($1,$2)`, [adminUid, 2000000000]),
    "no pending or expired", "approving a nonexistent verification errors");

  await expectError(client.query(`SELECT admin_open_payee($1,'exam','X')`, [targetUid]),
    "42501", "non-admin payee create blocked");
  const payee = (await client.query(`SELECT admin_open_payee($1,'exam',$2) AS id`, [adminUid, `SmokeDept-${tag}`])).rows[0].id;
  if ((await client.query(`SELECT count(*)::int c FROM v_payable_targets WHERE account_id=$1`, [payee])).rows[0].c === 1)
    ok("admin_open_payee provisions an institutional payee"); else fail("payee missing from v_payable_targets");
  await expectError(client.query(`SELECT admin_open_payee($1,'exam',$2)`, [adminUid, `SmokeDept-${tag}`]),
    "already exists", "duplicate payee (same department) rejected");
  await expectError(client.query(`SELECT admin_open_payee($1,'bogus','x')`, [adminUid]),
    "unknown payee kind", "unknown payee kind rejected");
  await expectError(client.query(`SELECT admin_open_payee($1,'hall','notanid')`, [adminUid]),
    "hall reference must be", "hall payee with a non-numeric ref rejected");

  console.log(`\n${process.exitCode ? "SOME CHECKS FAILED" : "ALL CHECKS PASSED"} — ${passed} passed`);
} finally {
  await client.end();
}
