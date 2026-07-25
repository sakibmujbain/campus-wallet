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

const toGrants = (rows: Array<Record<string, unknown>>): Grant[] =>
  rows
    .filter((r) => r.capability != null)
    .map((r) => ({
      capability: r.capability as Capability,
      scopeKind: r.scopeKind as string,
      scopeRef: (r.scopeRef as string | null) ?? null,
    }));

// Resolves the authenticated user to {appUserId, role grants}, provisioning on
// first visit. Works for ANY app_user (not only students). Cached per request.
//
// Hot path (already-registered user) is ONE query: we resolve appUserId, name and
// all role grants in a single round-trip keyed on the Supabase auth UUID, and skip
// provision_student() — provisioning only matters on the very first login, and its
// advisory-lock + upsert is pure overhead once the user exists. Only when the auth
// UUID isn't linked yet do we fall to the slower first-visit provisioning path.
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) return null;

  let appUserId: number;
  let fullName: string;
  let grants: Grant[];

  const { rows: hot } = await pool.query(
    `SELECT au.user_id, au.full_name,
            g.capability, g.scope_kind AS "scopeKind", g.scope_ref AS "scopeRef"
       FROM app_user au
       LEFT JOIN role_grant g ON g.user_id = au.user_id
      WHERE au.auth_uid = $1::uuid`,
    [user.id],
  );

  if (hot.length > 0) {
    appUserId = Number(hot[0].user_id);
    fullName = (hot[0].full_name as string | null) ?? "";
    grants = toGrants(hot);
  } else {
    // First visit: link/provision the app_user. Academic info entered at signup rides
    // along in the auth user's metadata and is applied on first provision (ignored for
    // an already-provisioned/seeded student).
    const md = (user.user_metadata ?? {}) as Record<string, unknown>;
    fullName = (md.full_name as string | undefined) ?? "";
    const department = (md.department as string | undefined) ?? null;
    const session = (md.session as string | undefined) ?? null;
    const hallNum = md.hall_id == null || md.hall_id === "" ? NaN : Number(md.hall_id);
    const hallId = Number.isFinite(hallNum) ? hallNum : null;
    const { rows } = await pool.query(
      `SELECT provision_student($1::uuid, $2, $3, $4, $5::bigint, $6) AS id`,
      [user.id, user.email, fullName, department, hallId, session],
    );
    appUserId = Number(rows[0].id);
    const { rows: g } = await pool.query(
      `SELECT au.full_name,
              rg.capability, rg.scope_kind AS "scopeKind", rg.scope_ref AS "scopeRef"
         FROM app_user au
         LEFT JOIN role_grant rg ON rg.user_id = au.user_id
        WHERE au.user_id = $1`,
      [appUserId],
    );
    fullName = (g[0]?.full_name as string | null) ?? fullName;
    grants = toGrants(g);
  }

  // Admin bootstrap: ONLY emails on the ADMIN_EMAILS allowlist are granted admin.
  // Everyone else is a student unless an existing admin promotes them in-app. Idempotent,
  // and skipped once the grant exists so the hot path stays a single query for admins too.
  if (adminEmails().includes(user.email.toLowerCase()) && !grants.some((x) => x.capability === "admin")) {
    await pool.query(`SELECT ensure_admin($1)`, [appUserId]);
    const { rows: g } = await pool.query(
      `SELECT capability, scope_kind AS "scopeKind", scope_ref AS "scopeRef" FROM role_grant WHERE user_id = $1`,
      [appUserId],
    );
    grants = toGrants(g);
  }

  const isAdmin = grants.some((x) => x.capability === "admin");
  return {
    appUserId,
    email: user.email,
    fullName,
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
