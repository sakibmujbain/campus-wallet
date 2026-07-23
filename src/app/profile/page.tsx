import Link from "next/link";
import { redirect } from "next/navigation";
import { getStudent } from "@/lib/session";
import { getViewer } from "@/lib/viewer";
import { kycLabel, kycGuidance } from "@/lib/format";
import { RoleRequestForm } from "./role-request-form";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = { cr: "Class Representative", club_exec: "Club Executive", institution: "Institution staff", admin: "Admin" };

export default async function Profile() {
  const student = await getStudent();
  const viewer = await getViewer();
  if (!student || !viewer) redirect("/login");

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

      <div className="foot" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <Link href="/">← Dashboard</Link>
        <span>·</span>
        <form action="/auth/signout" method="post" style={{ display: "inline" }}>
          <button className="btn-ghost" type="submit">Sign out</button>
        </form>
      </div>
    </main>
  );
}
