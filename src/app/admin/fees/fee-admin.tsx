"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { money } from "@/lib/format";

interface Fee {
  feeItemId: number; name: string; category: string; amount: string;
  scopeKind: string; scopeRef: string | null; active: boolean; collectorLabel: string; assessed: number;
}
interface Payee { accountId: number; label: string; instKind: string }

export function FeeAdmin({ fees, payees }: { fees: Fee[]; payees: Payee[] }) {
  const router = useRouter();
  const [period, setPeriod] = useState("Spring-2026");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("exam");
  const [collector, setCollector] = useState<number | "">(payees[0]?.accountId ?? "");
  const [amount, setAmount] = useState("");
  const [scopeKind, setScopeKind] = useState("all");
  const [scopeRef, setScopeRef] = useState("");

  async function post(url: string, body: unknown, tag: string, ok: (d: any) => string) {
    setBusy(tag);
    setMsg(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json();
      if (res.ok && d.ok) { setMsg({ ok: true, text: ok(d) }); router.refresh(); }
      else setMsg({ ok: false, text: d.error ?? "Request failed." });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(null); }
  }

  const assess = (feeItemId: number) =>
    post("/api/admin/fees/assess", { feeItemId, period }, `assess-${feeItemId}`, (d) => `Assessed to ${d.assessed} student(s) for ${period}.`);

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    return post("/api/admin/fees", { name, category, collector, amount, scopeKind, scopeRef: scopeRef || null }, "create", (d) => {
      setName(""); setAmount(""); setScopeRef("");
      return `Created fee #${d.feeItemId}. Assess it to create student dues.`;
    });
  };

  return (
    <>
      <div className="card">
        <h2>Fees ({fees.length})</h2>
        <label style={{ display: "inline-flex", gap: "0.4rem", alignItems: "center", fontSize: "0.82rem", marginBottom: "0.6rem" }}>
          Assess for period
          <input value={period} onChange={(e) => setPeriod(e.target.value)} style={{ width: "10rem" }} />
        </label>
        <div className="scroll-x">
          <table style={{ minWidth: "640px" }}>
            <thead><tr><th>Fee</th><th>Payee</th><th>Scope</th><th className="num">Amount</th><th className="num">Assessed</th><th><span className="sr-only">Assess</span></th></tr></thead>
            <tbody>
              {fees.length === 0 ? (
                <tr><td colSpan={6} style={{ color: "var(--muted)" }}>No fees yet — create one below.</td></tr>
              ) : fees.map((f) => (
                <tr key={f.feeItemId} style={{ opacity: f.active ? 1 : 0.5 }}>
                  <td>{f.name} <span className="kind">{f.category}</span></td>
                  <td>{f.collectorLabel}</td>
                  <td>{f.scopeKind}{f.scopeRef ? ` · ${f.scopeRef}` : ""}</td>
                  <td className="num">{money(f.amount)}</td>
                  <td className="num">{f.assessed}</td>
                  <td style={{ textAlign: "right" }}>
                    <button onClick={() => assess(f.feeItemId)} disabled={busy !== null}>
                      {busy === `assess-${f.feeItemId}` ? "Assessing…" : "Assess"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>New fee</h2>
        {payees.length === 0 ? (
          <p style={{ color: "var(--muted)", margin: 0 }}>
            Provision a payee first (<a href="/admin/wallets">Admin → Payees</a>) — a fee needs a collector wallet.
          </p>
        ) : (
        <form onSubmit={create}>
          <label>Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Semester Exam Fee" required /></label>
          <div className="row">
            <label>Category
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                {["exam", "hall_rent", "cafeteria", "library", "misc"].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label>Amount (BDT)<input value={amount} onChange={(e) => setAmount(e.target.value)} pattern="^\d+(\.\d{1,2})?$" placeholder="1500" required /></label>
          </div>
          <label>Payee (institutional wallet)
            <select value={collector} onChange={(e) => setCollector(Number(e.target.value))} required>
              {payees.map((p) => <option key={p.accountId} value={p.accountId}>{p.label}</option>)}
            </select>
          </label>
          <div className="row">
            <label>Scope
              <select value={scopeKind} onChange={(e) => setScopeKind(e.target.value)}>
                {["all", "batch", "department", "hall"].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label>Scope value{scopeKind === "all" ? " (all students)" : ""}
              <input value={scopeRef} onChange={(e) => setScopeRef(e.target.value)} disabled={scopeKind === "all"}
                placeholder={scopeKind === "batch" ? "2021" : scopeKind === "department" ? "CSE" : scopeKind === "hall" ? "Shaheed Smriti Hall" : ""} />
            </label>
          </div>
          <button type="submit" disabled={busy !== null}>{busy === "create" ? "Creating…" : "Create fee"}</button>
        </form>
        )}
      </div>

      {msg && <div className={`msg ${msg.ok ? "ok" : "err"}`} role="status" aria-live="polite">{msg.text}</div>}
    </>
  );
}
