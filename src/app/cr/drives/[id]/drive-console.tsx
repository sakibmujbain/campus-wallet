"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { money } from "@/lib/format";
import { newIdem } from "@/lib/idem";
import { Progress } from "@/components/progress";
import { DU_DEPARTMENT_GROUPS, DU_SESSIONS } from "@/lib/du";

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
interface HallOption { hallId: number; name: string }
interface Filters { department: string; hallId: string; session: string }

const STATUS_BADGE: Record<string, string> = { open: "badge-ok", closed: "badge-warn", settled: "kind", cancelled: "badge-warn" };

export function DriveConsole({ drive, roster, destinations, halls }: { drive: DriveDetail; roster: RosterRow[]; destinations: Target[]; halls: HallOption[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [destination, setDestination] = useState(String(destinations[0]?.accountId ?? ""));
  const [confirming, setConfirming] = useState<null | "cancel" | "settle">(null);

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
    } catch {
      setMsg({ ok: false, text: "Couldn't reach the server — please try again." });
    } finally {
      setBusy(null);
      setConfirming(null);
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
        <Progress value={pct} large label={`${drive.name} collection progress`} />

        {!finalized && (
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", flexWrap: "wrap", alignItems: "center" }}>
            {confirming === "cancel" ? (
              <>
                <span style={{ fontSize: "0.88rem" }}>Cancel this drive? Collections stop — this is final.</span>
                <button className="btn-ghost" disabled={busy !== null} style={{ color: "var(--bad)" }}
                  onClick={() => post({ action: "status", status: "cancelled" }, "status")}>Yes, cancel</button>
                <button className="btn-ghost" disabled={busy !== null} onClick={() => setConfirming(null)}>Keep open</button>
              </>
            ) : (
              <>
                {drive.status === "open" && <button className="btn-ghost" disabled={busy !== null} onClick={() => post({ action: "status", status: "closed" }, "status")}>Close collections</button>}
                {drive.status === "closed" && <button className="btn-ghost" disabled={busy !== null} onClick={() => post({ action: "status", status: "open" }, "status")}>Reopen</button>}
                <button className="btn-ghost" disabled={busy !== null} style={{ color: "var(--bad)" }}
                  onClick={() => { setMsg(null); setConfirming("cancel"); }}>Cancel drive</button>
              </>
            )}
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
            <thead><tr><th>Student</th><th className="num">Expected</th><th className="num">Paid</th><th className="num">Outstanding</th><th><span className="sr-only">Actions</span></th></tr></thead>
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
        {!finalized && (
          <RosterAdd
            eventId={drive.eventId}
            halls={halls}
            busy={busy !== null}
            onAdd={(studentId, expected) => post({ action: "roster_add", studentId, expected }, "add")}
            onAddFiltered={(perHead, f) =>
              post(
                { action: "roster_add_filtered", perHead, department: f.department || undefined, hallId: f.hallId || undefined, session: f.session || undefined },
                "add-filtered",
                (d) => {
                  const n = Number(d.added);
                  return n === 0 ? "No new students matched — they may already be on the roster." : `Added ${n} student${n === 1 ? "" : "s"}.`;
                },
              )
            }
          />
        )}
      </div>

      {/* Settle */}
      {!finalized && (
        <div className="card">
          <h2>Settle</h2>
          {destinations.length === 0 ? (
            <p className="sub" style={{ marginTop: 0 }}>
              No institutional treasury wallet is set up yet — ask an admin to add one (Admin → Payees) before settling.
            </p>
          ) : (
            <>
              <p className="sub" style={{ marginTop: 0 }}>
                Sweep the full collected balance ({money(drive.collected)}) into an institutional treasury and close the drive.
                The destination must be a campus wallet — never a personal account.
              </p>
              {confirming === "settle" ? (
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "0.88rem" }}>
                    Settle {money(drive.collected)} to “{destinations.find((t) => String(t.accountId) === destination)?.label}”? This is final.
                  </span>
                  <button disabled={busy !== null} onClick={() => post({ action: "settle", destination: Number(destination) }, "settle", () => "Drive settled.")}>
                    {busy === "settle" ? "Settling…" : "Yes, settle"}
                  </button>
                  <button className="btn-ghost" disabled={busy !== null} onClick={() => setConfirming(null)}>Cancel</button>
                </div>
              ) : (
                <div className="row">
                  <label>
                    Destination treasury
                    <select value={destination} onChange={(e) => setDestination(e.target.value)}>
                      {destinations.map((t) => <option key={t.accountId} value={t.accountId}>{t.label} ({t.instKind})</option>)}
                    </select>
                  </label>
                  <div style={{ display: "flex", alignItems: "flex-end" }}>
                    <button disabled={busy !== null || !destination} onClick={() => { setMsg(null); setConfirming("settle"); }}>Settle drive</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {msg && <div className={`msg ${msg.ok ? "ok" : "err"}`} role="status" aria-live="polite">{msg.text}</div>}
    </>
  );
}

function RefundCell({ max, busy, onRefund }: { max: string; busy: boolean; onRefund: (amount: string, idem: string) => void }) {
  const [amt, setAmt] = useState(max);
  const [open, setOpen] = useState(false);
  // One idempotency key per refund intent; a changed amount is a new intent -> new key.
  // A retried submit of the SAME amount reuses the key, so refund_event replays the one txn.
  const [idem, setIdem] = useState<string>(() => newIdem());
  if (!open) return <button className="btn-ghost" disabled={busy} onClick={() => setOpen(true)}>Refund</button>;
  return (
    <span style={{ display: "inline-flex", gap: "0.3rem", alignItems: "center" }}>
      <input value={amt} onChange={(e) => { setAmt(e.target.value); setIdem(newIdem()); }} inputMode="decimal" style={{ width: "5rem" }} aria-label="Refund amount" />
      <button className="icon-btn" disabled={busy} onClick={() => onRefund(amt, idem)} aria-label="Confirm refund">OK</button>
      <button className="btn-ghost icon-btn" disabled={busy} onClick={() => setOpen(false)} aria-label="Cancel refund">✕</button>
    </span>
  );
}

interface Candidate { studentId: number; studentName: string; studentNo: string | null }

function RosterAdd({
  eventId, halls, busy, onAdd, onAddFiltered,
}: {
  eventId: number; halls: HallOption[]; busy: boolean;
  onAdd: (studentId: number, expected: string) => void;
  onAddFiltered: (perHead: string, f: Filters) => void;
}) {
  const [department, setDepartment] = useState("");
  const [hallId, setHallId] = useState("");
  const [session, setSession] = useState("");
  const [perHead, setPerHead] = useState("");
  const filters: Filters = { department, hallId, session };
  const anyFilter = Boolean(department || hallId || session);

  return (
    <div style={{ marginTop: "1.25rem", display: "grid", gap: "1.1rem" }}>
      <div>
        <p className="sub" style={{ margin: "0 0 0.6rem", fontSize: "0.82rem" }}>
          Filter by department, hall, or session — then add everyone matching at once, or search a name below.
        </p>
        <div className="roster-filters">
          <label>Department
            <select value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">Any department</option>
              {DU_DEPARTMENT_GROUPS.map((g) => (
                <optgroup key={g.faculty} label={g.faculty}>
                  {g.departments.map((d) => <option key={d} value={d}>{d}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <label>Hall
            <select value={hallId} onChange={(e) => setHallId(e.target.value)}>
              <option value="">Any hall</option>
              {halls.map((h) => <option key={h.hallId} value={h.hallId}>{h.name}</option>)}
            </select>
          </label>
          <label>Session
            <select value={session} onChange={(e) => setSession(e.target.value)}>
              <option value="">Any session</option>
              {DU_SESSIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end", flexWrap: "wrap", marginTop: "0.75rem" }}>
          <label style={{ flex: "0 0 8rem" }}>Per head (৳)
            <input value={perHead} onChange={(e) => setPerHead(e.target.value)} inputMode="decimal" placeholder="500" />
          </label>
          <button disabled={busy || !perHead || !anyFilter} title={!anyFilter ? "Pick at least one filter first" : undefined}
            onClick={() => onAddFiltered(perHead, filters)}>Add all matching</button>
        </div>
      </div>
      <StudentSearchAdd eventId={eventId} busy={busy} filters={filters} onAdd={onAdd} />
    </div>
  );
}

function StudentSearchAdd({ eventId, busy, filters, onAdd }: {
  eventId: number; busy: boolean; filters: Filters; onAdd: (studentId: number, expected: string) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [sel, setSel] = useState<Candidate | null>(null);
  const [expected, setExpected] = useState("");
  const [open, setOpen] = useState(false);
  const { department, hallId, session } = filters;

  // Debounced search (name/ID + shared filters); a settled pick stops re-searching.
  useEffect(() => {
    if (sel) return;
    const query = q.trim();
    if (query.length < 2) { setResults([]); setOpen(false); return; }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: query });
        if (department) params.set("department", department);
        if (hallId) params.set("hallId", hallId);
        if (session) params.set("session", session);
        const res = await fetch(`/api/cr/drives/${eventId}?${params.toString()}`, { signal: ctl.signal });
        const d = await res.json();
        if (d.ok) { setResults(d.candidates as Candidate[]); setOpen(true); }
      } catch { /* aborted or offline */ }
    }, 250);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q, sel, eventId, department, hallId, session]);

  function pick(c: Candidate) { setSel(c); setQ(`${c.studentName}${c.studentNo ? ` · ${c.studentNo}` : ""}`); setResults([]); setOpen(false); }
  function reset() { setQ(""); setSel(null); setExpected(""); setResults([]); setOpen(false); }

  return (
    <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end", flexWrap: "wrap" }}>
      <label style={{ flex: "1 1 15rem", position: "relative" }}>Add a student (search name or ID)
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setSel(null); }}
          onFocus={() => { if (results.length) setOpen(true); }}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          placeholder="Type a name or student no…"
          autoComplete="off"
        />
        {open && results.length > 0 && (
          <ul className="typeahead">
            {results.map((c) => (
              <li key={c.studentId}>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(c)}>
                  <span>{c.studentName}</span><span className="kind">{c.studentNo ?? "—"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {open && results.length === 0 && !sel && q.trim().length >= 2 && (
          <ul className="typeahead">
            <li><span className="typeahead-empty">No match — or already on the roster.</span></li>
          </ul>
        )}
      </label>
      <label style={{ flex: "0 0 8rem" }}>Expected (৳)
        <input value={expected} onChange={(e) => setExpected(e.target.value)} inputMode="decimal" placeholder="500" />
      </label>
      <button className="btn-ghost" disabled={busy || !sel || !expected}
        onClick={() => { if (sel && expected) { onAdd(sel.studentId, expected); reset(); } }}>Add</button>
    </div>
  );
}
