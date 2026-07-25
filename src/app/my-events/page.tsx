import { redirect } from "next/navigation";
import { getStudent } from "@/lib/session";
import { listMyEvents, listMyEventParticipants } from "@/db/myevents";
import { money } from "@/lib/format";
import { MyEventsList } from "./my-events-list";

export const dynamic = "force-dynamic";

export default async function MyEvents() {
  const student = await getStudent();
  if (!student) redirect("/login");

  const [events, participants] = await Promise.all([
    listMyEvents(student.appUserId),
    listMyEventParticipants(student.appUserId),
  ]);
  const owed = events
    .filter((e) => e.status === "open" && Number(e.outstanding) > 0)
    .reduce((s, e) => s + Number(e.outstanding), 0);

  return (
    <main>
      <div className="eyebrow">Campus Wallet · My collections</div>
      <h1>My events &amp; collections</h1>
      <p className="sub">
        Batch drives you&apos;re on. Pay your share from your spending wallet
        (balance {money(student.spending)}) — partial payments are fine.
      </p>

      {owed > 0 && (
        <div className="msg info" role="status" style={{ marginBottom: "1rem" }}>
          You owe <strong>{money(String(owed))}</strong> across your open drives.
        </div>
      )}

      <MyEventsList events={events} participants={participants} />
    </main>
  );
}
