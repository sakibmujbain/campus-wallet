import { SkeletonCard, SkeletonTable } from "@/components/skeleton";

export default function Loading() {
  return (
    <main>
      <div className="eyebrow">Organizer · Drive</div>
      <div className="skeleton skeleton-line" style={{ width: "50%", height: "1.6rem", margin: "0.5rem 0 1.25rem" }} />
      <SkeletonCard title={false} lines={2} />
      <SkeletonTable rows={4} />
    </main>
  );
}
