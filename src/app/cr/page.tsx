import Link from "next/link";
import { requireViewer } from "@/lib/viewer";
import { listMyDrives } from "@/db/organizer";
import { money } from "@/lib/format";
import { Progress } from "@/components/progress";

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, string> = {
  open: "badge-ok", closed: "badge-warn", settled: "kind", cancelled: "badge-warn",
};

export default async function OrganizerHome({ searchParams }: { searchParams: Promise<{ archived?: string }> }) {
  const v = await requireViewer("cr"); // re-assert per page (a shared layout guard doesn't re-run on soft nav)
  const showArchived = (await searchParams).archived === "1";
  // Archived drives are filed away, so the working list stays short however many drives
  // have come and gone; they remain one click away rather than deleted.
  const all = await listMyDrives(v.appUserId, v.isAdmin, true);
  const drives = all.filter((e) => (showArchived ? e.archivedAt !== null : e.archivedAt === null));
  const archivedCount = all.filter((e) => e.archivedAt !== null).length;

  return (
    <main>
      <div className="eyebrow">Organizer</div>
      <div className="topbar">
        <h1 style={{ fontSize: "1.5rem" }}>My collection drives</h1>
        <Link href="/cr/new" className="btn-primary">+ New drive</Link>
      </div>
      <p className="sub">Batch collections you run. Open a drive to manage its roster, chase defaulters, refund, and settle.</p>

      {(archivedCount > 0 || showArchived) && (
        <p style={{ margin: "-1rem 0 1.25rem" }}>
          <Link href={showArchived ? "/cr" : "/cr?archived=1"} className="btn-ghost">
            {showArchived ? "← Back to active drives" : `Archived (${archivedCount})`}
          </Link>
        </p>
      )}

      {drives.length === 0 ? (
        <div className="card">
          <p style={{ color: "var(--muted)", marginBottom: showArchived ? 0 : "0.8rem" }}>
            {showArchived ? "No archived drives." : "You don't run any drives yet."}
          </p>
          {!showArchived && <Link href="/cr/new" className="btn-primary">Create your first drive</Link>}
        </div>
      ) : (
        drives.map((e) => {
          return (
            <Link className="card card-link" key={e.eventId} href={`/cr/drives/${e.eventId}`}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.5rem" }}>
                <h2 style={{ margin: 0 }}>
                  {e.name}{" "}
                  {e.batch && <span className="kind">batch {e.batch}</span>}
                </h2>
                <span className={`badge ${STATUS_BADGE[e.status] ?? "kind"}`}>{e.status}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.88rem", color: "var(--muted)", margin: "0.5rem 0 0.4rem" }}>
                <span>{money(e.collected)} of {money(e.target)} · {e.rosterSize} on roster · {e.defaulterCount} unpaid</span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{e.pct}%</span>
              </div>
              <Progress value={Number(e.pct)} label={`${e.name} collection progress`} />
              </Link>
          );
        })
      )}
    </main>
  );
}
