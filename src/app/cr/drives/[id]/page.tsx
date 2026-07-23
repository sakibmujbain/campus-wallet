import Link from "next/link";
import { notFound } from "next/navigation";
import { requireViewer } from "@/lib/viewer";
import { getDrive, listRoster } from "@/db/organizer";
import { listPayableTargets } from "@/db/accounts";
import { DriveConsole } from "./drive-console";

export const dynamic = "force-dynamic";

export default async function DrivePage({ params }: { params: Promise<{ id: string }> }) {
  const eventId = Number((await params).id);
  if (!Number.isInteger(eventId) || eventId <= 0) notFound();

  const v = await requireViewer("cr"); // re-assert per page (a shared layout guard doesn't re-run on soft nav)
  const drive = await getDrive(v.appUserId, v.isAdmin, eventId);
  if (!drive) notFound(); // not found OR not your drive — same 404, no info leak

  const [roster, destinations] = await Promise.all([listRoster(eventId), listPayableTargets()]);

  return (
    <main>
      <div className="eyebrow"><Link href="/cr" style={{ color: "var(--accent)", textDecoration: "none" }}>Organizer</Link> · Drive</div>
      <DriveConsole drive={drive} roster={roster} destinations={destinations} />
    </main>
  );
}
