import Link from "next/link";
import { pool } from "@/db/pool";
import { requireViewer } from "@/lib/viewer";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminOverview() {
  await requireViewer("admin"); // re-assert per page (a shared layout guard doesn't re-run on soft nav)
  const { rows } = await pool.query(`
    SELECT (SELECT count(*) FROM app_user)                                        AS users,
           (SELECT count(*) FROM role_request WHERE status='pending')             AS pending_requests,
           (SELECT count(*) FROM kyc_verification WHERE status='pending')         AS pending_kyc,
           (SELECT count(*) FROM reconcile_balances())                            AS drift,
           COALESCE((SELECT b.balance::text FROM account_balance b
                       JOIN system_account s ON s.account_id = b.account_id
                      WHERE s.system_role='treasury' LIMIT 1), '0')               AS treasury
  `);
  const k = rows[0];
  return (
    <main>
      <div className="eyebrow">Admin</div>
      <h1>System overview</h1>
      <p className="sub">The control plane. Manage <Link href="/admin/users">users &amp; roles</Link>, the <Link href="/admin/fees">fee catalog</Link>, and monitor ledger health.</p>
      <div className="tiles">
        <div className="tile"><span className="tile-label">Users</span><span className="tile-value">{k.users}</span></div>
        <div className="tile"><span className="tile-label">Pending role requests</span><span className="tile-value">{k.pending_requests}</span></div>
        <div className="tile"><span className="tile-label">Pending KYC</span><span className="tile-value">{k.pending_kyc}</span></div>
        <div className="tile">
          <span className="tile-label">Ledger drift</span>
          <span className="tile-value" style={{ color: String(k.drift) === "0" ? "var(--good)" : "var(--bad)" }}>{k.drift}</span>
        </div>
        <div className="tile"><span className="tile-label">Treasury</span><span className="tile-value">{money(k.treasury)}</span></div>
      </div>
    </main>
  );
}
