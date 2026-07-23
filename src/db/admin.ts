import { pool } from "@/db/pool";
import { withTransaction } from "@/db/tx";

export interface UserGrant {
  capability: string;
  scopeKind: string;
  scopeRef: string | null;
}
export interface DirectoryUser {
  userId: number;
  fullName: string;
  email: string;
  studentNo: string | null;
  department: string | null;
  batch: string | null;
  kycStatus: string | null;
  grants: UserGrant[];
}

export async function listUsers(): Promise<DirectoryUser[]> {
  const { rows } = await pool.query(`
    SELECT au.user_id::int AS "userId", au.full_name AS "fullName", au.email,
           st.student_no AS "studentNo", st.department, st.batch,
           (SELECT status FROM kyc_verification k WHERE k.student_id = au.user_id ORDER BY verification_id DESC LIMIT 1) AS "kycStatus",
           COALESCE((SELECT jsonb_agg(jsonb_build_object('capability', capability, 'scopeKind', scope_kind, 'scopeRef', scope_ref) ORDER BY capability)
                       FROM role_grant WHERE user_id = au.user_id), '[]'::jsonb) AS grants
      FROM app_user au
      LEFT JOIN student st ON st.student_id = au.user_id
     ORDER BY au.user_id`);
  return rows as DirectoryUser[];
}

export interface RoleRequestRow {
  requestId: number;
  fullName: string;
  email: string;
  requestedRole: string;
  scopeKind: string | null;
  scopeRef: string | null;
  justification: string | null;
}

export async function listRoleRequests(): Promise<RoleRequestRow[]> {
  const { rows } = await pool.query(`
    SELECT rr.request_id::int AS "requestId", au.full_name AS "fullName", au.email,
           rr.requested_role AS "requestedRole", rr.scope_kind AS "scopeKind", rr.scope_ref AS "scopeRef", rr.justification
      FROM role_request rr JOIN app_user au ON au.user_id = rr.user_id
     WHERE rr.status = 'pending'
     ORDER BY rr.created_at`);
  return rows as RoleRequestRow[];
}

// ── Mutations (run through withTransaction({userId}) so audit_log.changed_by is set) ──

export async function promoteUser(adminId: number, targetId: number, capability: string, scopeKind: string, scopeRef: string | null): Promise<void> {
  await withTransaction(async (c) => {
    await c.query(`SELECT promote_user($1,$2,$3,$4,$5)`, [adminId, targetId, capability, scopeKind, scopeRef]);
  }, { userId: adminId });
}

export async function demoteUser(adminId: number, targetId: number, capability: string, scopeKind: string, scopeRef: string | null): Promise<void> {
  await withTransaction(async (c) => {
    await c.query(`SELECT demote_user($1,$2,$3,$4,$5)`, [adminId, targetId, capability, scopeKind, scopeRef]);
  }, { userId: adminId });
}

export async function decideRoleRequest(adminId: number, requestId: number, approve: boolean): Promise<void> {
  await withTransaction(async (c) => {
    await c.query(`SELECT decide_role_request($1,$2,$3)`, [adminId, requestId, approve]);
  }, { userId: adminId });
}

export async function setStudentDepartment(adminId: number, studentId: number, department: string): Promise<void> {
  await withTransaction(async (c) => {
    await c.query(`SELECT set_student_department($1,$2,$3)`, [adminId, studentId, department]);
  }, { userId: adminId });
}

/** Student self-declares a role (never admin). */
export async function requestRole(userId: number, role: string, scopeKind: string | null, scopeRef: string | null, justification: string | null): Promise<number> {
  return withTransaction(async (c) => {
    const { rows } = await c.query(`SELECT request_role($1,$2,$3,$4,$5) AS id`, [userId, role, scopeKind, scopeRef, justification]);
    return Number(rows[0].id);
  }, { userId });
}
