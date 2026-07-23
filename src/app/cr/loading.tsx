import { SkeletonText, SkeletonCard } from "@/components/skeleton";

export default function Loading() {
  return (
    <main>
      <div className="eyebrow">Organizer</div>
      <div className="skeleton skeleton-line" style={{ width: "45%", height: "1.6rem", margin: "0.5rem 0 1rem" }} />
      <SkeletonText lines={1} />
      <SkeletonCard lines={3} />
      <SkeletonCard lines={3} />
    </main>
  );
}
