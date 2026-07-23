import { pool } from "@/db/pool";
import { getViewer } from "@/lib/viewer";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function OrganizerHome() {
  const v = await getViewer();
  const { rows } = await pool.query(
    `SELECT p.event_id, p.name, p.batch,
            p.collected::text AS collected, p.target::text AS target,
            COALESCE(p.pct_collected, 0)::text AS pct
       FROM v_event_progress p
       JOIN event e ON e.event_id = p.event_id
      WHERE e.organizer_user_id = $1
      ORDER BY p.event_id DESC`,
    [v!.appUserId],
  );

  return (
    <main>
      <div className="eyebrow">Organizer</div>
      <h1>My collection drives</h1>
      <p className="sub">Batch &amp; club collections you run. Creating drives, roster management, and reminders arrive in the next phase.</p>
      {rows.length === 0 ? (
        <div className="card">
          <p style={{ color: "var(--muted)" }}>You don&apos;t run any drives yet.</p>
        </div>
      ) : (
        rows.map((e) => (
          <div className="card" key={e.event_id}>
            <h2>{e.name} {e.batch && <span className="kind">batch {e.batch}</span>}</h2>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.88rem", color: "var(--muted)", marginBottom: "0.4rem" }}>
              <span>{money(e.collected)} of {money(e.target)}</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{e.pct}%</span>
            </div>
            <div style={{ height: 8, borderRadius: 999, background: "var(--surface-2)", overflow: "hidden" }}>
              <div style={{ width: `${Math.min(100, Number(e.pct))}%`, height: "100%", background: "var(--accent)" }} />
            </div>
          </div>
        ))
      )}
    </main>
  );
}
