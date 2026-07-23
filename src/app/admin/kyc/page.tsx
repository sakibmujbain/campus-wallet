import { listKyc } from "@/db/adminops";
import { requireViewer } from "@/lib/viewer";
import { KycAdmin } from "./kyc-admin";

export const dynamic = "force-dynamic";

export default async function Kyc() {
  await requireViewer("admin"); // re-assert per page (a shared layout guard doesn't re-run on soft nav)
  const rows = await listKyc();
  return (
    <main>
      <div className="eyebrow">Admin · e-KYC</div>
      <h1>Identity verification</h1>
      <p className="sub">
        The verification state machine (<code>pending → verified → expired → alumni</code>) is enforced by a shared
        transition trigger. Most students auto-verify via their <code>.edu.bd</code> email at signup; anything
        pending (e.g. a future ID-card upload) waits here for approval. The <strong>effective</strong> status is
        derived live from enrollment date + expiry, independent of the nightly cron sweep.
      </p>
      <KycAdmin rows={rows} />
    </main>
  );
}
