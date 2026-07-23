import Link from "next/link";
import { getViewer } from "@/lib/viewer";
import { listMyDrives } from "@/db/organizer";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, string> = {
  open: "badge-ok", closed: "badge-warn", settled: "kind", cancelled: "badge-warn",
};

export default async function OrganizerHome() {
  const v = await getViewer();
  const drives = await listMyDrives(v!.appUserId, v!.isAdmin);

  return (
    <main>
      <div className="eyebrow">Organizer</div>
      <div className="topbar">
        <h1 style={{ fontSize: "1.5rem" }}>My collection drives</h1>
        <Link href="/cr/new" className="btn-primary">+ New drive</Link>
      </div>
      <p className="sub">Batch &amp; club collections you run. Open a drive to manage its roster, chase defaulters, refund, and settle.</p>

      {drives.length === 0 ? (
        <div className="card">
          <p style={{ color: "var(--muted)", marginBottom: "0.8rem" }}>You don&apos;t run any drives yet.</p>
          <Link href="/cr/new" className="btn-primary">Create your first drive</Link>
        </div>
      ) : (
        drives.map((e) => {
          const pct = Math.min(100, Number(e.pct));
          return (
            <Link className="card card-link" key={e.eventId} href={`/cr/drives/${e.eventId}`}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.5rem" }}>
                <h2 style={{ margin: 0 }}>
                  {e.name}{" "}
                  {e.batch && <span className="kind">batch {e.batch}</span>}
                  {e.clubName && <span className="kind">{e.clubName}</span>}
                </h2>
                <span className={`badge ${STATUS_BADGE[e.status] ?? "kind"}`}>{e.status}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.88rem", color: "var(--muted)", margin: "0.5rem 0 0.4rem" }}>
                <span>{money(e.collected)} of {money(e.target)} · {e.rosterSize} on roster · {e.defaulterCount} unpaid</span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{e.pct}%</span>
              </div>
              <div style={{ height: 8, borderRadius: 999, background: "var(--surface-2)", overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)" }} />
              </div>
            </Link>
          );
        })
      )}
    </main>
  );
}
