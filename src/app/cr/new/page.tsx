import { requireViewer } from "@/lib/viewer";
import { NewDriveForm } from "./new-drive-form";

export const dynamic = "force-dynamic";

export default async function NewDrive() {
  const v = await requireViewer("cr"); // re-assert per page (a shared layout guard doesn't re-run on soft nav)
  // The scopes this organizer may create drives for = their cr/club_exec grants.
  const scopes = v.grants
    .filter((g) => g.capability === "cr" || g.capability === "club_exec")
    .map((g) => ({ scopeKind: g.scopeKind, scopeRef: g.scopeRef ?? "" }))
    .filter((s) => s.scopeKind === "batch" && s.scopeRef !== "");

  return (
    <main style={{ maxWidth: "40rem" }}>
      <div className="eyebrow">Organizer</div>
      <h1>New collection drive</h1>
      <p className="sub">
        Name the drive, pick the session it&apos;s for, and choose who&apos;s on the roster — the whole session,
        one department, or a list you build yourself on the next screen.
      </p>
      <div className="card">
        <NewDriveForm scopes={scopes} isAdmin={v!.isAdmin} />
      </div>
    </main>
  );
}
