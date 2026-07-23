import Link from "next/link";
import { requireViewer } from "@/lib/viewer";

export default async function OrganizerLayout({ children }: { children: React.ReactNode }) {
  await requireViewer("cr"); // gate: admins pass too (admin implies every capability)
  return (
    <>
      <div className="console-bar console-cr">
        <span className="console-title">📣 Organizer console</span>
        <nav className="console-nav">
          <Link href="/cr">My drives</Link>
          <Link href="/cr/new">+ New drive</Link>
          <Link href="/">← App</Link>
        </nav>
      </div>
      {children}
    </>
  );
}
