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

  const fullName = (user.user_metadata?.full_name as string | undefined) ?? "";
  const { rows } = await pool.query(`SELECT provision_student($1::uuid, $2, $3) AS id`, [user.id, user.email, fullName]);
  const appUserId = Number(rows[0].id);

  // Admin bootstrap: force if the email is allowlisted; otherwise ensure_admin()
  // grants admin only when NO admin exists yet (first-run), so a deploy always has one.
  await pool.query(`SELECT ensure_admin($1, $2)`, [appUserId, adminEmails().includes(user.email.toLowerCase())]);

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
