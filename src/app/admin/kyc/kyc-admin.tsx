"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface KycRow {
  verificationId: number; studentId: number; studentName: string; studentNo: string | null;
  method: string; storedStatus: string; effectiveStatus: string; verifiedAt: string | null; expiresAt: string | null;
}

const STATUS_STYLE: Record<string, string> = {
  verified: "badge-ok", pending: "badge-warn", expired: "kind", alumni: "kind",
};

function Status({ s }: { s: string }) {
  return <span className={`badge ${STATUS_STYLE[s] ?? "kind"}`}>{s}</span>;
}

export function KycAdmin({ rows }: { rows: KycRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const pending = rows.filter((r) => r.storedStatus === "pending");

  async function approve(verificationId: number) {
    setBusy(verificationId);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/kyc", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ verificationId }),
      });
      const d = await res.json();
      if (res.ok && d.ok) router.refresh();
      else setMsg({ ok: false, text: d.error ?? "Approval failed." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {pending.length > 0 && (
        <div className="card">
          <h2>Pending approval ({pending.length})</h2>
          <div className="scroll-x">
            <table>
              <thead><tr><th>Student</th><th>Method</th><th></th></tr></thead>
              <tbody>
                {pending.map((r) => (
                  <tr key={r.verificationId}>
                    <td>{r.studentName}<br /><span className="kind">{r.studentNo ?? "—"}</span></td>
                    <td><span className="kind">{r.method}</span></td>
                    <td style={{ textAlign: "right" }}>
                      <button onClick={() => approve(r.verificationId)} disabled={busy !== null}>
                        {busy === r.verificationId ? "Approving…" : "Approve"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <h2>All verifications ({rows.length})</h2>
        <div className="scroll-x">
          <table style={{ minWidth: "640px" }}>
            <thead><tr><th>Student</th><th>Method</th><th>Stored</th><th>Effective</th><th>Expires</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.verificationId}>
                  <td>{r.studentName}<br /><span className="kind">{r.studentNo ?? "—"}</span></td>
                  <td><span className="kind">{r.method}</span></td>
                  <td><Status s={r.storedStatus} /></td>
                  <td>
                    <Status s={r.effectiveStatus} />
                    {r.effectiveStatus !== r.storedStatus && <span style={{ color: "var(--muted)", fontSize: "0.72rem", marginLeft: "0.3rem" }}>(derived)</span>}
                  </td>
                  <td style={{ fontSize: "0.8rem", color: "var(--muted)", whiteSpace: "nowrap" }}>{r.expiresAt ? r.expiresAt.slice(0, 10) : "—"}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} style={{ color: "var(--muted)" }}>No verifications yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {msg && <div className={`msg ${msg.ok ? "ok" : "err"}`}>{msg.text}</div>}
    </>
  );
}
