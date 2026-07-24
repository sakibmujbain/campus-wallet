import { pool } from "./pool";
import { withTransaction } from "./tx";

export interface Hall {
  hallId: number;
  name: string;
}

/** All residential halls (for the signup / profile / roster hall dropdowns). */
export async function listHalls(): Promise<Hall[]> {
  const { rows } = await pool.query(`SELECT hall_id::int AS "hallId", name FROM hall ORDER BY name`);
  return rows as Hall[];
}

export interface StudentAcademics {
  department: string | null;
  hallId: number | null;
  hallName: string | null;
  session: string | null; // stored in student.batch (the cohort key)
}

export async function getStudentAcademics(appUserId: number): Promise<StudentAcademics> {
  const { rows } = await pool.query(
    `SELECT s.department, s.hall_id::int AS "hallId", h.name AS "hallName", s.batch AS session
       FROM student s LEFT JOIN hall h ON h.hall_id = s.hall_id
      WHERE s.student_id = $1`,
    [appUserId],
  );
  const r = rows[0] ?? {};
  return { department: r.department ?? null, hallId: r.hallId ?? null, hallName: r.hallName ?? null, session: r.session ?? null };
}

/** Self-service edit of the caller's own department / hall / session. */
export async function updateStudentAcademics(actorId: number, department: string, hallId: number, session: string): Promise<void> {
  await withTransaction(async (c) => {
    await c.query(`SELECT update_student_academics($1,$2,$3::bigint,$4)`, [actorId, department, hallId, session]);
  }, { userId: actorId });
}
