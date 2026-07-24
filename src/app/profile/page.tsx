import { redirect } from "next/navigation";
import { getStudent } from "@/lib/session";
import { getViewer } from "@/lib/viewer";
import { kycLabel, kycGuidance, money } from "@/lib/format";
import { listTransactions } from "@/db/wallet";
import { listHalls, getStudentAcademics } from "@/db/reference";
import { RoleRequestForm } from "./role-request-form";
import { AcademicInfo } from "./academic-info";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = { cr: "Class Representative", club_exec: "Club Executive", institution: "Institution staff", admin: "Admin" };
const KIND_LABEL: Record<string, string> = { transfer: "Transfer", purchase: "Purchase", roundup_sweep: "Round-up" };
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export default async function Profile() {
  const student = await getStudent();
  const viewer = await getViewer();
  if (!student || !viewer) redirect("/login");

  const [txns, halls, academics] = await Promise.all([
    listTransactions(student.appUserId),
    listHalls(),
    getStudentAcademics(student.appUserId),
  ]);
  const verified = student.kycStatus === "verified";

  return (
    <main style={{ maxWidth: "40rem" }}>
      <div className="eyebrow">Campus Wallet · Profile</div>
      <h1>{student.fullName}</h1>
      <p className="sub">{student.studentNo} · {student.email}</p>

      <div className="card">
        <h2>Verification</h2>
        <p style={{ margin: 0 }}>
          e-KYC: <span className={`badge ${verified ? "badge-ok" : "badge-warn"}`}>{kycLabel(student.kycStatus)}</span>
          {verified && <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}> — via your .edu.bd email</span>}
        </p>
        {!verified && kycGuidance(student.kycStatus) && (
          <div className="msg info" role="status" style={{ marginTop: "0.75rem" }}>{kycGuidance(student.kycStatus)}</div>
        )}
      </div>

      <AcademicInfo halls={halls} current={academics} />

      <div className="card">
        <h2>Your roles</h2>
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
          {viewer.isAdmin && <span className="badge badge-ok">Admin</span>}
          {viewer.grants.filter((g) => g.capability !== "admin").map((g, i) => (
            <span key={i} className="kind">{ROLE_LABEL[g.capability] ?? g.capability}{g.scopeRef ? ` · ${g.scopeRef}` : ""}</span>
          ))}
          {!viewer.isAdmin && viewer.grants.filter((g) => g.capability !== "admin").length === 0 && (
            <span style={{ color: "var(--muted)" }}>You&apos;re a student. Request an organizer role below.</span>
          )}
        </div>
      </div>

      {!viewer.isAdmin && (
        <div className="card">
          <h2>Request a role</h2>
          <p className="sub" style={{ marginTop: 0 }}>An admin will review and approve.</p>
          <RoleRequestForm />
        </div>
      )}

      <div className="card">
        <h2>Transaction history</h2>
        {txns.length === 0 ? (
          <p style={{ color: "var(--muted)", margin: 0 }}>No transactions yet.</p>
        ) : (
          <>
            <div className="scroll-x">
              <table style={{ minWidth: "460px" }}>
                <thead><tr><th>When</th><th>Activity</th><th className="num">Amount</th></tr></thead>
                <tbody>
                  {txns.map((t) => {
                    const credit = t.direction === "credit";
                    return (
                      <tr key={t.entryId}>
                        <td style={{ whiteSpace: "nowrap", fontSize: "0.8rem", color: "var(--muted)" }}>{t.at.slice(0, 10)}</td>
                        <td>
                          {cap(t.description)}<br />
                          <span className="kind">{KIND_LABEL[t.kind] ?? t.kind} · {t.wallet}</span>
                        </td>
                        <td className="num" style={{ color: credit ? "var(--good)" : "var(--bad)", whiteSpace: "nowrap" }}>
                          {credit ? "+" : "−"}{money(t.amount.replace("-", ""))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="sub" style={{ margin: "0.75rem 0 0", fontSize: "0.8rem" }}>
              Your most recent {txns.length} entries across your spending &amp; savings wallets, from the immutable ledger.
            </p>
          </>
        )}
      </div>

      <div className="foot" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <form action="/auth/signout" method="post" style={{ display: "inline" }}>
          <button className="btn-ghost" type="submit">Sign out</button>
        </form>
      </div>
    </main>
  );
}
