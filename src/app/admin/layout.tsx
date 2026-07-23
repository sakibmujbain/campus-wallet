import Link from "next/link";
import { requireViewer } from "@/lib/viewer";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireViewer("admin"); // gate: non-admins are redirected to /
  return (
    <>
      <div className="console-bar console-admin">
        <span className="console-title">⚙ Admin console</span>
        <nav className="console-nav">
          <Link href="/admin">Overview</Link>
          <Link href="/admin/users">Users &amp; roles</Link>
          <Link href="/admin/fees">Fees</Link>
          <Link href="/admin/wallets">Payees</Link>
          <Link href="/admin/kyc">KYC</Link>
          <Link href="/admin/audit">Audit</Link>
          <Link href="/admin/reconcile">Reconcile</Link>
          <Link href="/">← App</Link>
        </nav>
      </div>
      {children}
    </>
  );
}
