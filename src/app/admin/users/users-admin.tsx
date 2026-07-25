"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DU_SESSIONS } from "@/lib/du";
import { SessionSelect } from "@/components/combo";

interface Grant { capability: string; scopeKind: string; scopeRef: string | null }
interface User { userId: number; fullName: string; email: string; studentNo: string | null; department: string | null; batch: string | null; kycStatus: string | null; grants: Grant[] }
interface Req { requestId: number; fullName: string; email: string; requestedRole: string; scopeKind: string | null; scopeRef: string | null; justification: string | null }

export function UsersAdmin({ users, requests }: { users: User[]; requests: Req[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function post(url: string, body: unknown, tag: string) {
    setBusy(tag);
    setMsg(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json();
      if (res.ok && d.ok) router.refresh();
      else setMsg({ ok: false, text: d.error ?? "Action failed." });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(null); }
  }

  const decide = (requestId: number, approve: boolean) => post("/api/admin/role-requests", { requestId, approve }, `req-${requestId}`);
  // A cr grant is scoped to one session (migration 0020's promote_user rejects it otherwise);
  // every other capability is unscoped.
  const promote = (targetId: number, capability: string, scopeRef?: string) =>
    post("/api/admin/users", capability === "cr"
      ? { action: "promote", targetId, capability, scopeKind: "batch", scopeRef }
      : { action: "promote", targetId, capability, scopeKind: "all" }, `u-${targetId}`);
  const demote = (targetId: number, g: Grant) => post("/api/admin/users", { action: "demote", targetId, capability: g.capability, scopeKind: g.scopeKind, scopeRef: g.scopeRef }, `u-${targetId}`);
  const setDept = (targetId: number, department: string) => post("/api/admin/users", { action: "department", targetId, department }, `u-${targetId}`);

  return (
    <>
      <div className="card">
        <h2>Pending role requests ({requests.length})</h2>
        {requests.length === 0 ? (
          <p style={{ color: "var(--muted)", margin: 0 }}>No pending role requests — all caught up.</p>
        ) : (
          <div className="scroll-x">
            <table>
              <thead><tr><th>User</th><th>Wants</th><th>Scope</th><th>Reason</th><th><span className="sr-only">Decision</span></th></tr></thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.requestId}>
                    <td>{r.fullName}<br /><span className="kind trunc" title={r.email}>{r.email}</span></td>
                    <td><span className="kind">{r.requestedRole}</span></td>
                    <td>{r.scopeKind}{r.scopeRef ? ` · ${r.scopeRef}` : ""}</td>
                    <td style={{ maxWidth: "12rem", fontSize: "0.82rem", color: "var(--muted)" }}>{r.justification ?? "—"}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button onClick={() => decide(r.requestId, true)} disabled={busy !== null}>Approve</button>{" "}
                      <button className="btn-ghost" onClick={() => decide(r.requestId, false)} disabled={busy !== null}>Deny</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Users ({users.length})</h2>
        <div className="scroll-x">
          <table style={{ minWidth: "720px", width: "100%", tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "33%" }} />{/* User + email */}
              <col style={{ width: "12%" }} />{/* Student */}
              <col style={{ width: "18%" }} />{/* Dept */}
              <col style={{ width: "17%" }} />{/* Roles */}
              <col style={{ width: "20%" }} />{/* Grant */}
            </colgroup>
            <thead><tr><th>User</th><th>Student</th><th>Dept</th><th>Roles</th><th>Grant</th></tr></thead>
            <tbody>
              {users.map((u) => <UserRow key={u.userId} u={u} busy={busy} onPromote={promote} onDemote={demote} onDept={setDept} />)}
            </tbody>
          </table>
        </div>
      </div>

      {msg && <div className={`msg ${msg.ok ? "ok" : "err"}`} role="status" aria-live="polite">{msg.text}</div>}
    </>
  );
}

function UserRow({ u, busy, onPromote, onDemote, onDept }: {
  u: User; busy: string | null;
  onPromote: (id: number, cap: string, scopeRef?: string) => void;
  onDemote: (id: number, g: Grant) => void;
  onDept: (id: number, dept: string) => void;
}) {
  const [dept, setDept] = useState(u.department ?? "");
  const [cap, setCap] = useState("cr");
  const [session, setSession] = useState("");
  const isStudent = u.studentNo != null;

  return (
    <tr>
      <td>{u.fullName}<br /><span className="kind trunc" title={u.email}>{u.email}</span></td>
      <td>{u.studentNo ?? "—"}{u.kycStatus && <><br /><span className="kind">{u.kycStatus}</span></>}</td>
      <td style={{ whiteSpace: "nowrap" }}>
        {isStudent ? (
          <>
            <input value={dept} onChange={(e) => setDept(e.target.value)} placeholder="—" style={{ width: "9rem" }} aria-label={`Department for ${u.fullName}`} />
            <button className="btn-ghost icon-btn" onClick={() => onDept(u.userId, dept)} disabled={busy !== null || dept === (u.department ?? "")} title="Save department" aria-label="Save department">✓</button>
          </>
        ) : "—"}
      </td>
      <td>
        {u.grants.length === 0 ? <span className="kind">student</span> : u.grants.map((g, i) => (
          <span key={i} className="kind" style={{ marginRight: "0.25rem", whiteSpace: "nowrap" }}>
            {g.capability}{g.scopeRef ? `·${g.scopeRef}` : ""}{" "}
            <button onClick={() => onDemote(u.userId, g)} disabled={busy !== null} aria-label={`Revoke ${g.capability}`}
              style={{ border: "none", background: "none", color: "var(--bad)", cursor: "pointer", padding: "0 0.25rem", fontWeight: 700 }} title="Revoke">×</button>
          </span>
        ))}
      </td>
      <td style={{ whiteSpace: "nowrap" }}>
        <select value={cap} onChange={(e) => setCap(e.target.value)}>
          {/* club_exec omitted: retired with clubs (0017). Existing grants stay revocable. */}
          {["cr", "institution", "admin"].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>{" "}
        {cap === "cr" && (
          <span style={{ display: "inline-block", minWidth: "8.5rem", verticalAlign: "middle" }}>
            <SessionSelect value={session} onChange={setSession} sessions={DU_SESSIONS} anyLabel="Session…" />
          </span>
        )}{" "}
        <button onClick={() => onPromote(u.userId, cap, session)}
          disabled={busy !== null || (cap === "cr" && !session)}
          title={cap === "cr" && !session ? "Pick the session this student represents" : undefined}>Grant</button>
      </td>
    </tr>
  );
}
