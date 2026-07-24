"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Scope { scopeKind: string; scopeRef: string }

export function NewDriveForm({ scopes, isAdmin }: { scopes: Scope[]; isAdmin: boolean }) {
  const router = useRouter();
  // Options: the granted scopes, plus a "custom" entry for admins (who cover every scope).
  const CUSTOM = "__custom__";
  const options = scopes.map((s, i) => ({ value: String(i), label: `${s.scopeKind}: ${s.scopeRef}`, ...s }));
  const hasGrantedScopes = options.length > 0;
  const [sel, setSel] = useState(options[0]?.value ?? (isAdmin ? CUSTOM : ""));

  const [name, setName] = useState("");
  const [perHead, setPerHead] = useState("");
  const [deadline, setDeadline] = useState("");
  const [description, setDescription] = useState("");
  // custom-scope fields (admin only)
  const [customKind] = useState("batch");
  const [customRef, setCustomRef] = useState("");

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // With no granted scopes (e.g. an admin), skip the redundant one-item dropdown and
  // let them choose batch/club directly.
  const usingCustom = !hasGrantedScopes || sel === CUSTOM;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const chosen = options.find((o) => o.value === sel);
    const scopeKind = usingCustom ? customKind : chosen?.scopeKind;
    const scopeRef = usingCustom ? customRef.trim() : chosen?.scopeRef;
    if (!scopeKind || !scopeRef) { setMsg({ ok: false, text: "Pick or enter a scope." }); return; }

    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/cr/drives", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, scopeKind, scopeRef, perHead, deadline: deadline || null, description: description || null }),
      });
      const d = await res.json();
      if (res.ok && d.ok) {
        router.push(`/cr/drives/${d.eventId}`);
        router.refresh();
      } else {
        setMsg({ ok: false, text: d.error ?? "Could not create the drive." });
        setBusy(false);
      }
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
      setBusy(false);
    }
  }

  if (options.length === 0 && !isAdmin) {
    return <p style={{ color: "var(--muted)", margin: 0 }}>You don&apos;t have an organizer grant with a batch scope yet. Request one from your <a href="/profile">profile</a>.</p>;
  }

  return (
    <form onSubmit={submit}>
      <label>
        Drive name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="CSE Batch Picnic" required />
      </label>

      {hasGrantedScopes && (
        <label>
          Scope (who is on the roster)
          <select value={sel} onChange={(e) => setSel(e.target.value)}>
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            {isAdmin && <option value={CUSTOM}>Custom scope…</option>}
          </select>
        </label>
      )}

      {usingCustom && (
        <label>
          Batch / session (who is on the roster)
          <input value={customRef} onChange={(e) => setCustomRef(e.target.value)} placeholder="e.g. 2023-24" />
        </label>
      )}

      <div className="row">
        <label>
          Per-head amount (৳)
          <input value={perHead} onChange={(e) => setPerHead(e.target.value)} inputMode="decimal" placeholder="500" required />
        </label>
        <label>
          Deadline (optional)
          <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </label>
      </div>

      <label>
        Description (optional)
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Annual picnic at Cox's Bazar" />
      </label>

      <button type="submit" disabled={busy}>{busy ? "Creating…" : "Create drive"}</button>
      {msg && <div className={`msg ${msg.ok ? "ok" : "err"}`}>{msg.text}</div>}
    </form>
  );
}
