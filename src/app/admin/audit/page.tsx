import Link from "next/link";
import { listAudit, listAuditTables, type AuditRow } from "@/db/adminops";
import { requireViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

const OP_COLOR: Record<string, string> = { INSERT: "var(--good)", UPDATE: "var(--accent)", DELETE: "var(--bad)" };

function scalar(v: unknown): string {
  if (v === null || v === undefined) return "∅";
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  return s.length > 40 ? s.slice(0, 39) + "…" : s;
}

/** Compact human diff: changed fields for UPDATE, key fields for INSERT/DELETE. */
function renderDiff(row: AuditRow) {
  const before = row.before ?? {};
  const after = row.after ?? {};
  if (row.op === "UPDATE") {
    const keys = Object.keys({ ...before, ...after }).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    if (keys.length === 0) return <span style={{ color: "var(--muted)" }}>(no field change)</span>;
    return (
      <span style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
        {keys.slice(0, 6).map((k) => (
          <span key={k} style={{ fontFamily: "var(--mono)", fontSize: "0.78rem" }}>
            <span style={{ color: "var(--muted)" }}>{k}:</span> {scalar(before[k])} <span style={{ color: "var(--muted)" }}>→</span> {scalar(after[k])}
          </span>
        ))}
        {keys.length > 6 && <span style={{ color: "var(--muted)", fontSize: "0.75rem" }}>+{keys.length - 6} more</span>}
      </span>
    );
  }
  const obj = row.op === "DELETE" ? before : after;
  const keys = Object.keys(obj).slice(0, 6);
  return (
    <span style={{ fontFamily: "var(--mono)", fontSize: "0.78rem", color: "var(--muted)" }}>
      {keys.map((k) => `${k}=${scalar(obj[k])}`).join("  ")}
    </span>
  );
}

export default async function Audit({ searchParams }: { searchParams: Promise<{ table?: string }> }) {
  await requireViewer("admin"); // re-assert per page (a shared layout guard doesn't re-run on soft nav)
  const table = (await searchParams).table ?? null;
  const [tables, rows] = await Promise.all([listAuditTables(), listAudit(table)]);

  return (
    <main>
      <div className="eyebrow">Admin · Monitoring</div>
      <h1>Audit trail</h1>
      <p className="sub">
        A single generic <code>to_jsonb()</code> trigger records every write to the sensitive tables as an
        append-only before/after snapshot with the actor. The immutable ledger is excluded — its own history is the audit.
      </p>

      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", margin: "0 0 1rem", fontSize: "0.82rem" }}>
        <Link href="/admin/audit" className={`kind ${!table ? "" : ""}`} style={{ textDecoration: "none", color: !table ? "var(--accent)" : "var(--muted)" }}>all</Link>
        {tables.map((t) => (
          <Link key={t} href={`/admin/audit?table=${t}`} className="kind" style={{ textDecoration: "none", color: table === t ? "var(--accent)" : "var(--muted)" }}>{t}</Link>
        ))}
      </div>

      <div className="card">
        <h2>{table ? `${table} — ` : ""}latest {rows.length} change{rows.length === 1 ? "" : "s"}</h2>
        <div className="scroll-x">
          <table style={{ minWidth: "720px" }}>
            <thead><tr><th>When</th><th>Table</th><th>Op</th><th>Change</th><th>By</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: "nowrap", fontSize: "0.78rem", color: "var(--muted)" }}>{r.at.slice(0, 19).replace("T", " ")}</td>
                  <td><span className="kind">{r.table}</span></td>
                  <td><span style={{ fontFamily: "var(--mono)", fontSize: "0.75rem", fontWeight: 700, color: OP_COLOR[r.op] ?? "var(--ink)" }}>{r.op}</span></td>
                  <td>{renderDiff(r)}</td>
                  <td style={{ whiteSpace: "nowrap", fontSize: "0.8rem" }}>{r.changedByName ?? <span style={{ color: "var(--muted)" }}>{r.actorRole}</span>}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} style={{ color: "var(--muted)" }}>No audit rows{table ? ` for ${table}` : ""} yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
