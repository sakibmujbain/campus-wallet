import Link from "next/link";
import { requireViewer } from "@/lib/viewer";
import { NewDriveForm } from "./new-drive-form";

export const dynamic = "force-dynamic";

export default async function NewDrive() {
  const v = await requireViewer("cr"); // re-assert per page (a shared layout guard doesn't re-run on soft nav)
  // The scopes this organizer may create drives for = their cr/club_exec grants.
  const scopes = v.grants
    .filter((g) => g.capability === "cr" || g.capability === "club_exec")
    .map((g) => ({ scopeKind: g.scopeKind, scopeRef: g.scopeRef ?? "" }))
    .filter((s) => (s.scopeKind === "batch" || s.scopeKind === "club") && s.scopeRef !== "");

  return (
    <main style={{ maxWidth: "40rem" }}>
      <div className="eyebrow">Organizer</div>
      <h1>New collection drive</h1>
      <p className="sub">
        Pick a scope you were granted; the roster is auto-populated from that cohort at a flat per-head amount
        (you can fine-tune it afterward). Batch drives include everyone in the batch; club drives include all members.
      </p>
      <div className="card">
        <NewDriveForm scopes={scopes} isAdmin={v!.isAdmin} />
      </div>
      <p className="foot"><Link href="/cr">← My drives</Link></p>
    </main>
  );
}
