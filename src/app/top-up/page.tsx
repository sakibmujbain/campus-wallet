import { redirect } from "next/navigation";
import { getStudent } from "@/lib/session";
import { money } from "@/lib/format";
import { TopUpForm } from "./top-up-form";

export const dynamic = "force-dynamic";

export default async function TopUp() {
  const student = await getStudent();
  if (!student) redirect("/login");

  return (
    <main style={{ maxWidth: "34rem" }}>
      <div className="eyebrow">Campus Wallet · Top up</div>
      <h1>Add balance</h1>
      <p className="sub">
        Add money to your spending wallet — current balance <strong>{money(student.spending)}</strong>. This is an instant
        demo cash-in; mobile-money and bank transfer are coming soon.
      </p>
      <div className="card">
        <TopUpForm />
      </div>
    </main>
  );
}
