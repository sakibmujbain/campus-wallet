"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RoleRequestForm() {
  const router = useRouter();
  const [role, setRole] = useState("cr");
  const [scopeRef, setScopeRef] = useState("");
  const [justification, setJustification] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const scopeKind = role === "cr" ? "batch" : role === "club_exec" ? "club" : "institution";
  const scopeLabel = role === "cr" ? "Batch" : role === "club_exec" ? "Club" : "Institution";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
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
      <div className="row">
        <label>
          Role
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="cr">Class Representative</option>
            <option value="club_exec">Club Executive</option>
            <option value="institution">Institution staff</option>
          </select>
        </label>
        <label>
          {scopeLabel}
          <input value={scopeRef} onChange={(e) => setScopeRef(e.target.value)}
            placeholder={role === "cr" ? "2021" : role === "club_exec" ? "Robotics Club" : "Exam office"} />
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
