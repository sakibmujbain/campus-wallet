import { requireViewer } from "@/lib/viewer";
import { ConsoleNav } from "@/components/console-nav";
import { Icon } from "@/components/icon";

const LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users & roles" },
  { href: "/admin/fees", label: "Fees" },
  { href: "/admin/wallets", label: "Payees" },
  { href: "/admin/kyc", label: "KYC" },
  { href: "/admin/audit", label: "Audit" },
  { href: "/admin/reconcile", label: "Reconcile" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireViewer("admin"); // gate: non-admins are redirected to /
  return (
    <>
      <div className="console-bar console-admin">
        <span className="console-title"><Icon name="sliders" className="ico-inline" />Admin console</span>
        <ConsoleNav links={LINKS} />
      </div>
      <div className="console-wide">{children}</div>
    </>
  );
}
