import Link from "next/link";
import { redirect } from "next/navigation";
import { getStudent } from "@/lib/session";
import { listOpenDues, listPaidDues } from "@/db/dues";
import { money } from "@/lib/format";
import { DuesList } from "./dues-list";

export const dynamic = "force-dynamic";

export default async function Dues() {
  const student = await getStudent();
  if (!student) redirect("/login");

  const [open, paid] = await Promise.all([listOpenDues(student.appUserId), listPaidDues(student.appUserId)]);
  const total = open.reduce((s, d) => s + Number(d.amount), 0);
  const short = Number(student.spending) < total && open.length > 0;

  return (
    <main>
      <div className="eyebrow">Campus Wallet · Dues</div>
      <h1>Your dues</h1>
      <p className="sub">
        Fees assessed to you — each paid at its exact amount from your spending wallet (balance {money(student.spending)}).
      </p>

      {short && (
        <div className="msg info" role="status" style={{ marginBottom: "1rem" }}>
          Your balance ({money(student.spending)}) is below your total dues ({money(String(total))}).{" "}
          <Link href="/top-up">Top up →</Link>
        </div>
      )}

      <div className="card">
        <h2>Outstanding ({open.length})</h2>
        <DuesList dues={open} />
      </div>

      {paid.length > 0 && (
        <div className="card">
          <h2>Recently paid</h2>
          <div className="scroll-x">
            <table>
              <thead><tr><th>Fee</th><th>Period</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {paid.map((d) => (
                  <tr key={d.assessmentId}>
                    <td>{d.name}</td>
                    <td><span className="kind">{d.period}</span></td>
                    <td className="num">{money(d.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="foot"><Link href="/">← Dashboard</Link> · <Link href="/top-up">Top up</Link></p>
    </main>
  );
}
