import Link from "next/link";
import { Icon } from "@/components/icon";

// Notification bell with a pinging unread badge. Badge + ping styling live in
// globals.css (.bell / .bell-badge), animation gated by prefers-reduced-motion.
export function Bell({ count }: { count: number }) {
  return (
    <Link href="/notifications" className="bell" title="Notifications"
      aria-label={count > 0 ? `Notifications, ${count} unread` : "Notifications"}>
      <Icon name="bell" className="ico-btn" />
      {count > 0 && <span className="bell-badge">{count > 9 ? "9+" : count}</span>}
    </Link>
  );
}
