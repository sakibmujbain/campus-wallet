import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { pool } from "@/db/pool";

export type Capability = "cr" | "club_exec" | "institution" | "admin";
export interface Grant {
  capability: Capability;
  scopeKind: string;
  scopeRef: string | null;
}
export interface Viewer {
  appUserId: number;
  email: string;
  fullName: string;
  grants: Grant[];
  isAdmin: boolean;
  /** admin implies every capability */
  has: (cap: Capability) => boolean;
}

const adminEmails = () =>
  (process.env.ADMIN_EMAILS ?? "")
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

// Resolves the authenticated user to {appUserId, role grants}, provisioning on
// first visit. Works for ANY app_user (not only students). Cached per request.
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) return null;

  // Academic info entered at signup rides along in the auth user's metadata and is
  // applied on first provision (ignored for an already-provisioned/seeded student).
  const md = (user.user_metadata ?? {}) as Record<string, unknown>;
  const fullName = (md.full_name as string | undefined) ?? "";
  const department = (md.department as string | undefined) ?? null;
  const session = (md.session as string | undefined) ?? null;
  const hallNum = md.hall_id == null || md.hall_id === "" ? NaN : Number(md.hall_id);
  const hallId = Number.isFinite(hallNum) ? hallNum : null;
  const { rows } = await pool.query(
    `SELECT provision_student($1::uuid, $2, $3, $4, $5::bigint, $6) AS id`,
    [user.id, user.email, fullName, department, hallId, session],
  );
  const appUserId = Number(rows[0].id);

  // Admin bootstrap: ONLY emails on the ADMIN_EMAILS allowlist are granted admin.
  // Everyone else is a student unless an existing admin promotes them in-app.
  if (adminEmails().includes(user.email.toLowerCase())) {
    await pool.query(`SELECT ensure_admin($1)`, [appUserId]);
  }

  const { rows: g } = await pool.query(
    `SELECT capability, scope_kind AS "scopeKind", scope_ref AS "scopeRef" FROM role_grant WHERE user_id = $1`,
    [appUserId],
  );
  const { rows: u } = await pool.query(`SELECT full_name FROM app_user WHERE user_id = $1`, [appUserId]);

  const grants = g as Grant[];
  const isAdmin = grants.some((x) => x.capability === "admin");
  return {
    appUserId,
    email: user.email,
    fullName: u[0]?.full_name ?? fullName,
    grants,
    isAdmin,
    has: (cap: Capability) => isAdmin || grants.some((x) => x.capability === cap),
  };
});

/** RSC/page guard: redirects to /login if unauthenticated, or to / if lacking the capability. */
export async function requireViewer(capability?: Capability): Promise<Viewer> {
  const v = await getViewer();
  if (!v) redirect("/login");
  if (capability && !v.has(capability)) redirect("/");
  return v;
}
