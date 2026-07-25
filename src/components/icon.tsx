// Single-colour line icons for the dashboard cards — 24×24 grid, 1.5px stroke, round joins.
// Every glyph draws with `currentColor`, so `.feature-icon { color: … }` recolours the whole
// set from one CSS rule and the dark theme follows the tokens for free. They are decorative
// (the card title carries the meaning), hence aria-hidden — unlike the emoji they replace,
// which screen readers announced as "pig face" / "gem stone".

const PATHS = {
  card: (
    <>
      <rect x="2.75" y="5.25" width="18.5" height="13.5" rx="2.5" />
      <path d="M2.75 9.75h18.5" />
      <path d="M6.5 15h3.5" />
    </>
  ),
  plus: (
    <>
      <circle cx="12" cy="12" r="8.75" />
      <path d="M12 8.25v7.5" />
      <path d="M8.25 12h7.5" />
    </>
  ),
  bank: (
    <>
      <path d="M3 9.75 12 4.5l9 5.25" />
      <path d="M2.75 20.25h18.5" />
      <path d="M6.5 12.25v5.5" />
      <path d="M12 12.25v5.5" />
      <path d="M17.5 12.25v5.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.25" y="5" width="17.5" height="15.5" rx="2.25" />
      <path d="M3.25 10h17.5" />
      <path d="M8.25 2.9v4.2" />
      <path d="M15.75 2.9v4.2" />
    </>
  ),
  receipt: (
    <>
      <path d="M5.25 2.75h13.5v18.5l-3.375-1.6-3.375 1.6-3.375-1.6L5.25 21.25z" />
      <path d="M8.5 8h7" />
      <path d="M8.5 12h7" />
    </>
  ),
  shield: (
    <>
      <path d="M12 2.75 19.25 5.6v5.9c0 4.2-2.9 7.5-7.25 9.75C7.65 19 4.75 15.7 4.75 11.5V5.6z" />
      <circle cx="12" cy="10.9" r="2.5" />
    </>
  ),
  gem: (
    <>
      <path d="M5.75 3.25h12.5L21.75 9 12 20.75 2.25 9z" />
      <path d="M2.25 9h19.5" />
      <path d="M9.25 3.25 7.25 9 12 20.75 16.75 9l-2-5.75" />
    </>
  ),
  sliders: (
    <>
      <path d="M3.75 7.5h9.5" />
      <path d="M18.25 7.5h2" />
      <path d="M3.75 16.5h3.5" />
      <path d="M12.25 16.5h8" />
      <circle cx="15.75" cy="7.5" r="2.4" />
      <circle cx="9.75" cy="16.5" r="2.4" />
    </>
  ),
  megaphone: (
    <>
      <path d="M4.25 9.5h3L18 5.25v13.5L7.25 14.5h-3A1.75 1.75 0 0 1 2.5 12.75v-1.5A1.75 1.75 0 0 1 4.25 9.5z" />
      <path d="M7.4 14.6 8.7 19.3a1 1 0 0 0 .96.72h1.2a.6.6 0 0 0 .58-.78l-1.35-4.4" />
      <path d="M20.75 10v3.75" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8.9a6 6 0 1 0-12 0c0 5.1-2.2 6.6-2.2 6.6h16.4S18 14 18 8.9z" />
      <path d="M13.6 19.35a1.85 1.85 0 0 1-3.2 0" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4.15" />
      <path d="M12 2.6v2.1" />
      <path d="M12 19.3v2.1" />
      <path d="M4.35 4.35 5.85 5.85" />
      <path d="M18.15 18.15l1.5 1.5" />
      <path d="M2.6 12h2.1" />
      <path d="M19.3 12h2.1" />
      <path d="M4.35 19.65l1.5-1.5" />
      <path d="M18.15 5.85l1.5-1.5" />
    </>
  ),
  moon: <path d="M20.4 14.35A8.75 8.75 0 0 1 9.65 3.6 8.75 8.75 0 1 0 20.4 14.35z" />,
  lock: (
    <>
      <rect x="3.9" y="10.4" width="16.2" height="10.35" rx="2.25" />
      <path d="M7.85 10.4V7.6a4.15 4.15 0 0 1 8.3 0v2.8" />
    </>
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="9.05" />
      <path d="M8.15 12.35 10.8 15l5.05-5.5" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "feature-icon" }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name]}
    </svg>
  );
}
