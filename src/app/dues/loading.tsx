import { SkeletonText, SkeletonTable } from "@/components/skeleton";

export default function Loading() {
  return (
    <main>
      <div className="eyebrow">Campus Wallet · Dues</div>
      <div className="skeleton skeleton-line" style={{ width: "40%", height: "1.6rem", margin: "0.5rem 0 1rem" }} />
      <SkeletonText lines={2} />
      <SkeletonTable rows={3} />
    </main>
  );
}
