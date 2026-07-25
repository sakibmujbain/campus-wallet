import { pool } from "@/db/pool";
import { withTransaction } from "@/db/tx";

// ── Read models ─────────────────────────────────────────────────────────────

export interface DriveSummary {
  eventId: number;
  name: string;
  batch: string | null;
  status: string;
  collected: string;
  target: string;
  pct: string;
  rosterSize: number;
  defaulterCount: number;
}

/** Drives the viewer runs (admins see all). */
export async function listMyDrives(appUserId: number, isAdmin: boolean): Promise<DriveSummary[]> {
  const { rows } = await pool.query(
    `SELECT e.event_id::int AS "eventId", e.name, e.batch, e.status,
            COALESCE(pr.collected, 0)::text AS collected,
            COALESCE(pr.target, 0)::text    AS target,
            COALESCE(pr.pct_collected, 0)::text AS pct,
            COALESCE(pr.roster_size, 0)::int    AS "rosterSize",
            (SELECT count(*)::int FROM v_event_defaulters d WHERE d.event_id = e.event_id) AS "defaulterCount"
       FROM event e
       LEFT JOIN v_event_progress pr ON pr.event_id = e.event_id
      WHERE $2 OR e.organizer_user_id = $1
      ORDER BY e.event_id DESC`,
    [appUserId, isAdmin],
  );
  return rows as DriveSummary[];
}

export interface DriveDetail extends DriveSummary {
  description: string | null;
  deadline: string | null;
  organizerId: number;
}

/** A single drive, only if the viewer is its organizer (or an admin). Null otherwise. */
export async function getDrive(appUserId: number, isAdmin: boolean, eventId: number): Promise<DriveDetail | null> {
  const { rows } = await pool.query(
    `SELECT e.event_id::int AS "eventId", e.name, e.batch, e.status,
            e.description, e.deadline::text AS deadline, e.organizer_user_id::int AS "organizerId",
            COALESCE(pr.collected, 0)::text AS collected,
            COALESCE(pr.target, 0)::text    AS target,
            COALESCE(pr.pct_collected, 0)::text AS pct,
            COALESCE(pr.roster_size, 0)::int    AS "rosterSize",
            (SELECT count(*)::int FROM v_event_defaulters d WHERE d.event_id = e.event_id) AS "defaulterCount"
       FROM event e
       LEFT JOIN v_event_progress pr ON pr.event_id = e.event_id
      WHERE e.event_id = $1`,
    [eventId],
  );
  const d = rows[0] as DriveDetail | undefined;
  if (!d) return null;
  if (!isAdmin && d.organizerId !== appUserId) return null; // authorization: not your drive
  return d;
}

export interface RosterRow {
  studentId: number;
  studentName: string;
  studentNo: string | null;
  spendingAccountId: number | null;
  expected: string;
  paid: string;
  outstanding: string;
}

/** Full roster for a drive: each student's expected, paid, and outstanding. */
export async function listRoster(eventId: number): Promise<RosterRow[]> {
  const { rows } = await pool.query(
    `SELECT r.student_id::int AS "studentId",
            au.full_name       AS "studentName",
            st.student_no      AS "studentNo",
            sw.account_id::int AS "spendingAccountId",
            r.expected_amount::text AS expected,
            COALESCE(p.paid, 0)::text AS paid,
            (r.expected_amount - COALESCE(p.paid, 0))::text AS outstanding
       FROM event_roster r
       JOIN app_user au ON au.user_id    = r.student_id
       JOIN student  st ON st.student_id = r.student_id
       LEFT JOIN student_wallet sw ON sw.student_id = r.student_id AND sw.wallet_purpose = 'spending'
       LEFT JOIN (SELECT student_id, SUM(amount) AS paid FROM event_contribution WHERE event_id = $1 GROUP BY student_id) p
              ON p.student_id = r.student_id
      WHERE r.event_id = $1
      ORDER BY au.full_name`,
    [eventId],
  );
  return rows as RosterRow[];
}

export interface RosterCandidate {
  studentId: number;
  studentName: string;
  studentNo: string | null;
}

export interface CohortFilters {
  department?: string | null;
  hallId?: number | null;
  session?: string | null; // student.batch
}

/** Students matching a name/student_no query (and optional department/hall/session
 *  filters) who are NOT already on this drive's roster — powers the typeahead. */
export async function searchRosterCandidates(eventId: number, q: string, f: CohortFilters = {}): Promise<RosterCandidate[]> {
  const { rows } = await pool.query(
    `SELECT s.student_id::int AS "studentId", au.full_name AS "studentName", s.student_no AS "studentNo"
       FROM student s
       JOIN app_user au ON au.user_id = s.student_id
      WHERE (au.full_name ILIKE '%' || $2 || '%' OR s.student_no ILIKE '%' || $2 || '%')
        AND ($3::text   IS NULL OR s.department = $3)
        AND ($4::bigint IS NULL OR s.hall_id   = $4)
        AND ($5::text   IS NULL OR s.batch     = $5)
        AND NOT EXISTS (SELECT 1 FROM event_roster r WHERE r.event_id = $1 AND r.student_id = s.student_id)
      ORDER BY au.full_name
      LIMIT 10`,
    [eventId, q, f.department ?? null, f.hallId ?? null, f.session ?? null],
  );
  return rows as RosterCandidate[];
}

// ── Mutations (all run through withTransaction({userId}) for audit + GUC) ────

export async function createDrive(
  actorId: number,
  d: {
    name: string; scopeKind: string; scopeRef: string; perHead: string;
    deadline: string | null; description: string | null;
    autoRoster?: boolean; department?: string | null; hallId?: number | null; session?: string | null;
  },
): Promise<number> {
  // scopeRef AUTHORISES the drive (the organizer's granted batch scope). Who lands on the
  // roster is a separate question — department, hall and session are independent filters,
  // so a departmental tour can span every session and a hall drive every department.
  // Everything runs in one transaction so a roster failure can't leave an orphaned drive.
  const dept = d.department ?? null;
  const hall = d.hallId ?? null;
  const session = d.session ?? null;

  return withTransaction(async (c) => {
    const { rows } = await c.query(
      `SELECT create_empty_drive($1,$2,$3,$4,$5::numeric,$6::date,$7) AS id`,
      [actorId, d.name, d.scopeKind, d.scopeRef, d.perHead, d.deadline, d.description],
    );
    const eventId = Number(rows[0].id);

    // create_empty_drive stamps event.batch from the authorising scope; correct it to the
    // roster's actual session (or clear it when the drive deliberately spans sessions).
    if (session !== d.scopeRef) {
      await c.query(`SELECT set_drive_batch($1,$2,$3)`, [actorId, eventId, session]);
    }

    // add_filtered_to_roster requires at least one filter, so only call it when there is one.
    if (d.autoRoster !== false && (dept || hall || session)) {
      await c.query(
        `SELECT add_filtered_to_roster($1,$2,$3::numeric,$4,$5::bigint,$6)`,
        [actorId, eventId, d.perHead, dept, hall, session],
      );
    }
    return eventId;
  }, { userId: actorId });
}

/** How many students match a department / hall / session combination — powers the "N students
 *  match" hint so an organizer sees the size of a roster before committing to it. Mirrors the
 *  predicate inside add_filtered_to_roster exactly. */
export async function countMatchingStudents(f: CohortFilters): Promise<number> {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n
       FROM student s
      WHERE (NULLIF(trim($1), '') IS NULL OR s.department = $1)
        AND ($2::bigint IS NULL              OR s.hall_id   = $2)
        AND (NULLIF(trim($3), '') IS NULL OR s.batch     = $3)`,
    [f.department ?? null, f.hallId ?? null, f.session ?? null],
  );
  return Number(rows[0].n);
}

export async function addToRoster(actorId: number, eventId: number, studentId: number, expected: string): Promise<void> {
  await withTransaction(async (c) => {
    await c.query(`SELECT add_to_roster($1,$2,$3,$4::numeric)`, [actorId, eventId, studentId, expected]);
  }, { userId: actorId });
}

/** Bulk-add every student matching the given filters (department / hall / session)
 *  at a flat per-head, skipping anyone already rostered. Returns how many were added.
 *  At least one filter must be set (enforced in add_filtered_to_roster). */
export async function addFilteredToRoster(actorId: number, eventId: number, perHead: string, f: CohortFilters): Promise<number> {
  return withTransaction(async (c) => {
    const { rows } = await c.query(
      `SELECT add_filtered_to_roster($1,$2,$3::numeric,$4,$5::bigint,$6) AS n`,
      [actorId, eventId, perHead, f.department ?? null, f.hallId ?? null, f.session ?? null],
    );
    return Number(rows[0].n);
  }, { userId: actorId });
}

export async function removeFromRoster(actorId: number, eventId: number, studentId: number): Promise<void> {
  await withTransaction(async (c) => {
    await c.query(`SELECT remove_from_roster($1,$2,$3)`, [actorId, eventId, studentId]);
  }, { userId: actorId });
}

/** Rewrite a drive's description (organizer/admin only). Metadata only — the function
 *  touches no roster row, ledger entry, or status, so it works on finalized drives too. */
export async function updateDriveDescription(actorId: number, eventId: number, description: string | null): Promise<void> {
  await withTransaction(async (c) => {
    await c.query(`SELECT update_drive_description($1,$2,$3)`, [actorId, eventId, description]);
  }, { userId: actorId });
}

export async function setDriveStatus(actorId: number, eventId: number, status: string): Promise<void> {
  await withTransaction(async (c) => {
    await c.query(`SELECT set_drive_status($1,$2,$3)`, [actorId, eventId, status]);
  }, { userId: actorId });
}

/** Organizer-gated refund. refund_event() caps by the student's net contribution;
 *  we additionally assert the actor owns (or admins) the drive before calling it. */
export async function refundContribution(
  actorId: number, eventId: number, studentAccountId: number, amount: string, idem: string,
): Promise<string> {
  return withTransaction(async (c) => {
    const { rows } = await c.query(
      `SELECT e.organizer_user_id::int AS org, is_admin($1) AS admin
         FROM event e WHERE e.event_id = $2`,
      [actorId, eventId],
    );
    if (!rows[0]) {
      const e = new Error(`no such event ${eventId}`) as Error & { code?: string };
      e.code = "P0001"; // surfaces as a 422, matching settle_event's not-found path
      throw e;
    }
    if (rows[0].org !== actorId && !rows[0].admin) {
      const e = new Error("only the organizer or an admin may issue refunds") as Error & { code?: string };
      e.code = "42501";
      throw e;
    }
    const { rows: r } = await c.query(
      `SELECT refund_event($1,$2,$3::numeric,$4::uuid) AS txn`,
      [eventId, studentAccountId, amount, idem],
    );
    return String(r[0].txn);
  }, { userId: actorId, isolation: "serializable" });
}

export async function settleDrive(actorId: number, eventId: number, destination: number, idem: string): Promise<string | null> {
  return withTransaction(async (c) => {
    const { rows } = await c.query(`SELECT settle_event($1,$2,$3,$4::uuid) AS txn`, [actorId, eventId, destination, idem]);
    return rows[0].txn == null ? null : String(rows[0].txn);
  }, { userId: actorId, isolation: "serializable" });
}

export async function remindDefaulters(actorId: number, eventId: number): Promise<number> {
  return withTransaction(async (c) => {
    const { rows } = await c.query(`SELECT remind_defaulters($1,$2) AS n`, [actorId, eventId]);
    return Number(rows[0].n);
  }, { userId: actorId });
}
