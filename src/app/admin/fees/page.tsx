import { listFeeItems, listPayees } from "@/db/fees";
import { requireViewer } from "@/lib/viewer";
import { FeeAdmin } from "./fee-admin";

export const dynamic = "force-dynamic";

export default async function AdminFees() {
  await requireViewer("admin"); // re-assert per page (a shared layout guard doesn't re-run on soft nav)
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
