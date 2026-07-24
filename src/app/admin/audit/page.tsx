import Link from "next/link";
import { getUserNames, listAudit, listAuditTables, type AuditRow } from "@/db/adminops";
import { requireViewer } from "@/lib/viewer";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";

const OP_COLOR: Record<string, string> = { INSERT: "var(--good)", UPDATE: "var(--accent)", DELETE: "var(--bad)" };

type Row = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
const amt = (v: unknown) => (v === null || v === undefined ? "—" : money(typeof v === "number" ? v : String(v)));

/** Turn one audit row into a plain-English "what happened", resolving user ids to names. */
function summarize(row: AuditRow, names: Record<number, string>): string {
  const b: Row = row.before ?? {};
  const a: Row = row.after ?? {};
  const op = row.op;
  const who = (id: unknown): string => {
    const n = Number(id);
    return names[n] ?? (Number.isFinite(n) && n > 0 ? `user #${n}` : "someone");
  };

  switch (row.table) {
    case "role_grant":
      if (op === "INSERT") return `Granted the ${a.capability} role${a.scope_ref ? ` (${a.scope_kind}: ${a.scope_ref})` : ""} to ${who(a.user_id)}`;
      if (op === "DELETE") return `Revoked the ${b.capability} role from ${who(b.user_id)}`;
      break;
    case "role_request":
      if (op === "INSERT") return `${who(a.user_id)} requested the ${a.requested_role} role`;
      if (op === "UPDATE" && b.status !== a.status)
        return `${a.status === "approved" ? "Approved" : a.status === "rejected" ? "Denied" : `Marked ${s(a.status)}`} ${who(a.user_id)}'s ${a.requested_role} request`;
      break;
    case "kyc_verification":
      if (op === "INSERT") return `${who(a.student_id)} submitted e-KYC via ${a.method}`;
      if (op === "UPDATE" && a.status === "verified") return `Verified ${who(a.student_id)}'s e-KYC`;
      if (op === "UPDATE" && b.status !== a.status) return `${who(a.student_id)}'s e-KYC → ${s(a.status)}`;
      break;
    case "student_assessment":
      if (op === "INSERT") return `Assessed a ${amt(a.amount_due)} due to ${who(a.student_id)} (${s(a.period)})`;
      if (op === "UPDATE" && a.status === "paid") return `${who(a.student_id)} paid a ${amt(a.amount_due)} due`;
      if (op === "UPDATE" && b.status !== a.status) return `${who(a.student_id)}'s due → ${s(a.status)}`;
      break;
    case "fee_item":
      if (op === "INSERT") return `Created the fee "${s(a.name)}" — ${amt(a.amount)} (${s(a.category)})`;
      if (op === "UPDATE" && b.amount !== a.amount) return `Changed "${s(a.name)}" from ${amt(b.amount)} to ${amt(a.amount)}`;
      break;
    case "student":
      if (op === "INSERT") return `Registered ${who(a.student_id)} as a student`;
      if (op === "UPDATE" && b.department !== a.department) return `Set ${who(a.student_id)}'s department to ${s(a.department)}`;
      break;
    case "student_wallet":
      if (op === "INSERT") return `Opened a ${a.wallet_purpose} wallet for ${who(a.student_id)}`;
      break;
    case "institutional_wallet":
      if (op === "INSERT") return `Provisioned a ${a.inst_kind} payee wallet`;
      break;
    case "account":
      if (op === "INSERT") return `Opened a ${a.account_kind} account (#${s(a.account_id)}, ${s(a.currency)})`;
      break;
    case "app_user":
      if (op === "INSERT") return `New account: ${s(a.full_name)}${a.email ? ` (${a.email})` : ""}`;
      break;
    case "savings_config":
      return `${who(a.student_id ?? b.student_id)} ${a.enabled === false ? "turned off round-ups" : `set round-ups to the nearest ৳${s(a.step)}`}`;
  }

  // Generic fallback — still readable, no column-dump.
  if (op === "UPDATE") {
    const k = Object.keys({ ...b, ...a }).find(
      (key) => JSON.stringify(b[key]) !== JSON.stringify(a[key]) && !["created_at", "updated_at"].includes(key),
    );
    return k ? `Updated ${row.table}: ${k} ${s(b[k])} → ${s(a[k])}` : `Updated ${row.table}`;
  }
  if (op === "INSERT") return `Added a ${row.table} record`;
  if (op === "DELETE") return `Removed a ${row.table} record`;
  return `${op} on ${row.table}`;
}

export default async function Audit({ searchParams }: { searchParams: Promise<{ table?: string }> }) {
  await requireViewer("admin");
  const table = (await searchParams).table ?? null;
  const [tables, rows, names] = await Promise.all([listAuditTables(), listAudit(table), getUserNames()]);

  return (
    <main>
      <div className="eyebrow">Admin · Monitoring</div>
      <h1>Audit trail</h1>
      <p className="sub">
        A single generic <code>to_jsonb()</code> trigger records every write to the sensitive tables as an
        append-only before/after snapshot with the actor. The immutable ledger is excluded — its own history is the audit.
      </p>

      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", margin: "0 0 1rem", fontSize: "0.82rem" }}>
        <Link href="/admin/audit" aria-current={!table ? "page" : undefined} className="kind" style={{ textDecoration: "none", color: !table ? "var(--accent)" : "var(--muted)" }}>all</Link>
        {tables.map((t) => (
          <Link key={t} href={`/admin/audit?table=${t}`} aria-current={table === t ? "page" : undefined} className="kind" style={{ textDecoration: "none", color: table === t ? "var(--accent)" : "var(--muted)" }}>{t}</Link>
        ))}
      </div>

      <div className="card">
        <h2>{table ? `${table} — ` : ""}latest {rows.length} change{rows.length === 1 ? "" : "s"}</h2>
        <div className="scroll-x">
          <table style={{ minWidth: "640px" }}>
            <thead><tr><th>When</th><th>Activity</th><th>By</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: "nowrap", fontSize: "0.78rem", color: "var(--muted)" }}>{r.at.slice(0, 16).replace("T", " ")}</td>
                  <td>
                    <div>{summarize(r, names)}</div>
                    <span style={{ fontFamily: "var(--mono)", fontSize: "0.7rem", color: OP_COLOR[r.op] ?? "var(--muted)" }}>
                      {r.op.toLowerCase()}
                    </span>
                    <span style={{ fontSize: "0.7rem", color: "var(--muted)" }}> · {r.table}</span>
                  </td>
                  <td style={{ whiteSpace: "nowrap", fontSize: "0.85rem" }}>{r.changedByName ?? <span style={{ color: "var(--muted)" }}>{r.actorRole}</span>}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={3} style={{ color: "var(--muted)" }}>No audit rows{table ? ` for ${table}` : ""} yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
