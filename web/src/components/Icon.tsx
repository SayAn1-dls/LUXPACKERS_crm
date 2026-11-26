/* A handful of simple line icons, drawn inline (no icon library). 24×24 grid, stroke = currentColor. */

const PATHS = {
  home: "M3 10.5 12 3l9 7.5M5.5 9v11h13V9M10 20v-6h4v6",
  tasks: "M9 6h11M9 12h11M9 18h11M4 5.5l1 1 2-2M4 11.5l1 1 2-2M4 17.5l1 1 2-2",
  leave: "M4 6.5h16V20H4zM4 10.5h16M8 3.5v4M16 3.5v4M8.5 15h3",
  folder: "M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z",
  people: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.8c1.9.7 3.1 2.5 3.5 5.2",
  badge: "M12 3 4.5 6v5.5c0 4.5 3.2 8 7.5 9.5 4.3-1.5 7.5-5 7.5-9.5V6zM9 12l2 2 4-4",
  key: "M14.5 9.5a4.5 4.5 0 1 1-1.3-3.2M14.5 9.5 21 16v3h-3v-2h-2v-2h-2l-1.2-1.2M8.5 9.5h.01",
  upload: "M12 15V4M7.5 8.5 12 4l4.5 4.5M4 15v4.5h16V15",
  download: "M12 4v11M7.5 10.5 12 15l4.5-4.5M4 15v4.5h16V15",
  log: "M6 3.5h9l4 4V20.5H6zM14.5 3.5V8H19M9 12h7M9 15.5h7",
  trash: "M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7.5 7.5 0 0 1-2 1.2L14.8 21h-4l-.3-2.4a7.5 7.5 0 0 1-2-1.2l-1.9.7-2-3.4 1.6-1.2a7.5 7.5 0 0 1 0-3l-1.6-1.2 2-3.4 1.9.7a7.5 7.5 0 0 1 2-1.2L10.8 3h4l.3 2.4a7.5 7.5 0 0 1 2 1.2l1.9-.7 2 3.4-1.6 1.2a7.5 7.5 0 0 1 0 3z",
  help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01",
  plus: "M12 5v14M5 12h14",
  userPlus: "M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 20c.6-3.4 3.2-5.5 6.5-5.5 1.6 0 3 .5 4.1 1.3M18.5 14v6M15.5 17h6",
  lock: "M6 10.5h12V20H6zM8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3",
  check: "M5 12.5l4.5 4.5L19 7.5",
  signOut: "M14 4.5H5.5v15H14M10 12h10.5M17 8.5l3.5 3.5-3.5 3.5",
  sparkle: "M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8zM18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z",
  inbox: "M3.5 13.5 6 5h12l2.5 8.5V19h-17zM3.5 13.5H8l1.5 2.5h5l1.5-2.5h4.5",
  menu: "M4 7h16M4 12h16M4 17h16",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={`icon${className ? ` ${className}` : ""}`} width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** A little hand-drawn flight path: decoration for empty states. */
export function Doodle() {
  return (
    <svg className="doodle" viewBox="0 0 132 72" aria-hidden="true" focusable="false">
      <circle cx="108" cy="22" r="13" fill="#FFC72C" stroke="#111111" strokeWidth="3" />
      <path d="M8 60 C30 30 52 70 74 44 S100 20 112 40" fill="none" stroke="#111111" strokeWidth="3" strokeDasharray="6 6" strokeLinecap="round" />
      <path d="M10 18 l4 9 9 4 -9 4 -4 9 -4 -9 -9 -4 9 -4 z" fill="#D62718" stroke="#111111" strokeWidth="2.5" strokeLinejoin="round" />
    </svg>
  );
}

/** Friendly empty state: a doodle, an icon sticker, a short title and one line. */
export function Empty({ icon = "inbox", title, children }: { icon?: IconName; title?: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <Doodle />
      <span className="empty-icon"><Icon name={icon} size={22} /></span>
      {title && <h3>{title}</h3>}
      {children}
    </div>
  );
}
