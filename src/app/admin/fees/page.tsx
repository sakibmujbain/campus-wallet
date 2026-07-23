import { listFeeItems, listPayees } from "@/db/fees";
import { FeeAdmin } from "./fee-admin";

export const dynamic = "force-dynamic";

export default async function AdminFees() {
  const [fees, payees] = await Promise.all([listFeeItems(), listPayees()]);
  return (
    <main>
      <div className="eyebrow">Admin</div>
      <h1>Fee catalog</h1>
      <p className="sub">
        Define campus fees and assess them to students. Editing an amount affects only <em>future</em> assessments —
        existing dues keep the amount they were assessed at.
      </p>
      <FeeAdmin fees={fees} payees={payees} />
    </main>
  );
}
