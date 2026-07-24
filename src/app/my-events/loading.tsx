import { SkeletonText, SkeletonCard } from "@/components/skeleton";

export default function Loading() {
  return (
    <main>
      <div className="eyebrow">Campus Wallet · My collections</div>
      <div className="skeleton skeleton-line" style={{ width: "50%", height: "1.6rem", margin: "0.5rem 0 1rem" }} />
      <SkeletonText lines={2} />
      <SkeletonCard lines={3} />
      <SkeletonCard lines={3} />
    </main>
  );
}
