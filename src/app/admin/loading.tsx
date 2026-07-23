import { SkeletonTiles, SkeletonTable } from "@/components/skeleton";

// One boundary for the whole /admin subtree (overview, users, fees, wallets, kyc, audit, reconcile).
export default function Loading() {
  return (
    <main>
      <div className="eyebrow">Admin</div>
      <div className="skeleton skeleton-line" style={{ width: "35%", height: "1.6rem", margin: "0.5rem 0 1.25rem" }} />
      <SkeletonTiles n={4} />
      <div style={{ marginTop: "1.5rem" }}>
        <SkeletonTable rows={5} />
      </div>
    </main>
  );
}
