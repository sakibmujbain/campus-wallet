"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { money } from "@/lib/format";

interface DriveDetail {
  eventId: number; name: string; batch: string | null; clubName: string | null; status: string;
  description: string | null; deadline: string | null;
  collected: string; target: string; pct: string; rosterSize: number; defaulterCount: number;
}
interface RosterRow {
  studentId: number; studentName: string; studentNo: string | null; spendingAccountId: number | null;
  expected: string; paid: string; outstanding: string;
}
interface Target { accountId: number; currency: string; instKind: string; label: string }

const STATUS_BADGE: Record<string, string> = { open: "badge-ok", closed: "badge-warn", settled: "kind", cancelled: "badge-warn" };

export function DriveConsole({ drive, roster, destinations }: { drive: DriveDetail; roster: RosterRow[]; destinations: Target[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [destination, setDestination] = useState(String(destinations[0]?.accountId ?? ""));

  const finalized = drive.status === "settled" || drive.status === "cancelled";
  const settled = drive.status === "settled"; // pool swept to a treasury — refunds are closed
  const defaulters = roster.filter((r) => Number(r.outstanding) > 0);
  const pct = Math.min(100, Number(drive.pct));

  async function post(body: Record<string, unknown>, tag: string, ok?: (d: Record<string, unknown>) => string) {
    setBusy(tag);
    setMsg(null);
    try {
      const res = await fetch(`/api/cr/drives/${drive.eventId}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await res.json();
      if (res.ok && d.ok) {
        if (ok) setMsg({ ok: true, text: ok(d) });
        router.refresh();
      } else {
        setMsg({ ok: false, text: d.error ?? "Action failed." });
      }
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1 style={{ fontSize: "1.5rem", margin: 0 }}>{drive.name}</h1>
          <p className="sub" style={{ margin: "0.3rem 0 0" }}>
            {drive.batch && <span className="kind">batch {drive.batch}</span>}{" "}
            {drive.clubName && <span className="kind">{drive.clubName}</span>}{" "}
            {drive.deadline && <span style={{ fontSize: "0.82rem", color: "var(--muted)" }}>· due {drive.deadline.slice(0, 10)}</span>}
          </p>
        </div>
        <span className={`badge ${STATUS_BADGE[drive.status] ?? "kind"}`}>{drive.status}</span>
      </div>
      {drive.description && <p className="sub">{drive.description}</p>}

      {/* Progress */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.9rem", color: "var(--muted)", marginBottom: "0.4rem" }}>
          <span>{money(drive.collected)} of {money(drive.target)} collected · {drive.rosterSize} on roster · {defaulters.length} unpaid</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{drive.pct}%</span>
        </div>
        <div style={{ height: 10, borderRadius: 999, background: "var(--surface-2)", overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)" }} />
        </div>

        {!finalized && (
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", flexWrap: "wrap" }}>
            {drive.status === "open" && <button className="btn-ghost" disabled={busy !== null} onClick={() => post({ action: "status", status: "closed" }, "status")}>Close collections</button>}
            {drive.status === "closed" && <button className="btn-ghost" disabled={busy !== null} onClick={() => post({ action: "status", status: "open" }, "status")}>Reopen</button>}
            <button className="btn-ghost" disabled={busy !== null}
              onClick={() => { if (confirm("Cancel this drive? Collections stop; this is final.")) post({ action: "status", status: "cancelled" }, "status"); }}
              style={{ color: "var(--bad)" }}>Cancel drive</button>
          </div>
        )}
      </div>

      {/* Defaulters + reminders */}
      <div className="card">
        <h2>Defaulters ({defaulters.length})</h2>
        {defaulters.length === 0 ? (
          <p style={{ color: "var(--good)", margin: 0 }}>Everyone has paid in full. 🎉</p>
        ) : (
          <>
            <p className="sub" style={{ marginTop: 0 }}>Send each unpaid student an in-app reminder with their outstanding balance.</p>
            <button disabled={busy !== null} onClick={() => post({ action: "remind" }, "remind", (d) => `Reminded ${d.reminded} student(s).`)}>
              {busy === "remind" ? "Sending…" : `Remind ${defaulters.length} defaulter(s)`}
            </button>
          </>
        )}
      </div>

      {/* Roster + refunds */}
      <div className="card">
        <h2>Roster</h2>
        {settled && <p className="sub" style={{ marginTop: 0 }}>This drive is settled — its funds were transferred to the treasury, so refunds are closed.</p>}
        <div className="scroll-x">
          <table style={{ minWidth: "620px" }}>
            <thead><tr><th>Student</th><th className="num">Expected</th><th className="num">Paid</th><th className="num">Outstanding</th><th></th></tr></thead>
            <tbody>
              {roster.map((r) => (
                <tr key={r.studentId}>
                  <td>{r.studentName}<br /><span className="kind">{r.studentNo ?? "—"}</span></td>
                  <td className="num">{money(r.expected)}</td>
                  <td className="num">{money(r.paid)}</td>
                  <td className="num" style={{ color: Number(r.outstanding) > 0 ? "var(--bad)" : "var(--good)" }}>{money(r.outstanding)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {settled
                      ? <span className="kind">settled</span>
                      : Number(r.paid) > 0 && r.spendingAccountId
                        ? <RefundCell max={r.paid} busy={busy !== null}
                            onRefund={(amt, idem) => post({ action: "refund", studentAccountId: r.spendingAccountId, amount: amt, idempotencyKey: idem }, `refund-${r.studentId}`, () => `Refunded ${money(amt)}.`)} />
                        : !finalized
                          ? <button className="btn-ghost" disabled={busy !== null}
                              onClick={() => post({ action: "roster_remove", studentId: r.studentId }, `rm-${r.studentId}`)} title="Remove from roster">Remove</button>
                          : <span className="kind">—</span>}
                  </td>
                </tr>
              ))}
              {roster.length === 0 && <tr><td colSpan={5} style={{ color: "var(--muted)" }}>No one on the roster yet.</td></tr>}
            </tbody>
          </table>
        </div>
        {!finalized && <AddToRoster busy={busy !== null} onAdd={(studentId, expected) => post({ action: "roster_add", studentId, expected }, "add")} />}
      </div>

      {/* Settle */}
      {!finalized && (
        <div className="card">
          <h2>Settle</h2>
          <p className="sub" style={{ marginTop: 0 }}>
            Sweep the full collected balance ({money(drive.collected)}) into an institutional treasury and close the drive.
            The destination must be a campus wallet — never a personal account.
          </p>
          <div className="row">
            <label>
              Destination treasury
              <select value={destination} onChange={(e) => setDestination(e.target.value)}>
                {destinations.map((t) => <option key={t.accountId} value={t.accountId}>{t.label} ({t.instKind})</option>)}
              </select>
            </label>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button disabled={busy !== null || !destination}
                onClick={() => { if (confirm(`Settle ${money(drive.collected)} to this treasury? This is final.`)) post({ action: "settle", destination: Number(destination) }, "settle", () => "Drive settled."); }}>
                {busy === "settle" ? "Settling…" : "Settle drive"}
              </button>
            </div>
          </div>
        </div>
      )}

      {msg && <div className={`msg ${msg.ok ? "ok" : "err"}`}>{msg.text}</div>}
    </>
  );
}

function RefundCell({ max, busy, onRefund }: { max: string; busy: boolean; onRefund: (amount: string, idem: string) => void }) {
  const [amt, setAmt] = useState(max);
  const [open, setOpen] = useState(false);
  // One idempotency key per refund intent; a changed amount is a new intent -> new key.
  // A retried submit of the SAME amount reuses the key, so refund_event replays the one txn.
  const [idem, setIdem] = useState<string>(() => crypto.randomUUID());
  if (!open) return <button className="btn-ghost" disabled={busy} onClick={() => setOpen(true)}>Refund</button>;
  return (
    <span style={{ display: "inline-flex", gap: "0.3rem", alignItems: "center" }}>
      <input value={amt} onChange={(e) => { setAmt(e.target.value); setIdem(crypto.randomUUID()); }} inputMode="decimal" style={{ width: "5rem" }} aria-label="refund amount" />
      <button disabled={busy} onClick={() => onRefund(amt, idem)} style={{ padding: "0.35rem 0.6rem" }}>OK</button>
      <button className="btn-ghost" disabled={busy} onClick={() => setOpen(false)} style={{ padding: "0.35rem 0.5rem" }}>✕</button>
    </span>
  );
}

function AddToRoster({ busy, onAdd }: { busy: boolean; onAdd: (studentId: number, expected: string) => void }) {
  const [studentId, setStudentId] = useState("");
  const [expected, setExpected] = useState("");
  return (
    <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end", marginTop: "1rem", flexWrap: "wrap" }}>
      <label style={{ flex: "0 0 8rem" }}>Add student (user ID)
        <input value={studentId} onChange={(e) => setStudentId(e.target.value)} inputMode="numeric" placeholder="e.g. 4" />
      </label>
      <label style={{ flex: "0 0 8rem" }}>Expected (৳)
        <input value={expected} onChange={(e) => setExpected(e.target.value)} inputMode="decimal" placeholder="500" />
      </label>
      <button className="btn-ghost" disabled={busy || !studentId || !expected}
        onClick={() => onAdd(Number(studentId), expected)}>Add / update</button>
    </div>
  );
}
