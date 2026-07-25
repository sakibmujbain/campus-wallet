"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DU_SESSIONS } from "@/lib/du";
import { SessionSelect } from "@/components/combo";

/** A student may be CR for exactly ONE session. `hasCr` is passed separately from `crScope`
 *  because a legacy grant can carry a null scope — presence, not the label, is what closes
 *  the option off. The UI is the courtesy; request_role() enforces the rule for real. */
export function RoleRequestForm({ hasCr = false, crScope = null }: { hasCr?: boolean; crScope?: string | null }) {
  const router = useRouter();
  const [role, setRole] = useState(hasCr ? "institution" : "cr");
  const [scopeRef, setScopeRef] = useState("");
  const [justification, setJustification] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Club Executive is retired — clubs were dropped in migration 0017, so the role could
  // only ever produce a grant with nothing to scope to.
  const scopeKind = role === "cr" ? "batch" : "institution";
  const scopeLabel = role === "cr" ? "Session" : "Institution";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (role === "cr" && !scopeRef) { setMsg({ ok: false, text: "Choose the session you represent." }); return; }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/role/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role, scopeKind, scopeRef: scopeRef || null, justification: justification || null }),
      });
      const d = await res.json();
      if (res.ok && d.ok) {
        setMsg({ ok: true, text: "Request submitted — an admin will review it." });
        setScopeRef("");
        setJustification("");
        router.refresh();
      } else {
        setMsg({ ok: false, text: d.error ?? "Request failed." });
      }
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {hasCr && (
        <div className="msg info" role="status">
          You are already a class representative{crScope ? <> for session <strong>{crScope}</strong></> : null}.
          {" "}A student can represent one session only — ask an admin if it needs changing.
        </div>
      )}
      <div className="row">
        <label>
          Role
          <select value={role} onChange={(e) => { setRole(e.target.value); setScopeRef(""); }}>
            <option value="cr" disabled={hasCr}>Class Representative{hasCr ? " — already assigned" : ""}</option>
            <option value="institution">Institution staff</option>
          </select>
        </label>
        <label>
          {scopeLabel}
          {role === "cr" ? (
            <SessionSelect value={scopeRef} onChange={setScopeRef}
              sessions={DU_SESSIONS} anyLabel="Select a session…" />
          ) : (
            <input value={scopeRef} onChange={(e) => setScopeRef(e.target.value)} placeholder="Exam office" />
          )}
        </label>
      </div>
      <label>
        Justification
        <input value={justification} onChange={(e) => setJustification(e.target.value)} placeholder="Why should you have this role?" />
      </label>
      <button type="submit" disabled={busy}>{busy ? "Submitting…" : "Request role"}</button>
      {msg && <div className={`msg ${msg.ok ? "ok" : "err"}`}>{msg.text}</div>}
    </form>
  );
}
