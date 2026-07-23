import { SkeletonTiles, SkeletonCard, SkeletonTable } from "@/components/skeleton";

export default function Loading() {
  return (
    <main>
      <div className="eyebrow">Campus Wallet · Rewards</div>
      <div className="skeleton skeleton-line" style={{ width: "40%", height: "1.6rem", margin: "0.5rem 0 1.25rem" }} />
      <SkeletonTiles n={2} />
      <div style={{ marginTop: "1.5rem" }}><SkeletonCard lines={2} /></div>
      <SkeletonTable rows={4} />
    </main>
  );
}
