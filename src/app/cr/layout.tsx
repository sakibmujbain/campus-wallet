import { requireViewer } from "@/lib/viewer";
import { ConsoleNav } from "@/components/console-nav";

const LINKS = [
  { href: "/cr", label: "My drives" },
  { href: "/cr/new", label: "+ New drive" },
];

export default async function OrganizerLayout({ children }: { children: React.ReactNode }) {
  await requireViewer("cr"); // gate: admins pass too (admin implies every capability)
  return (
    <>
      <div className="console-bar console-cr">
        <span className="console-title">📣 Organizer console</span>
        <ConsoleNav links={LINKS} />
      </div>
      {children}
    </>
  );
}
