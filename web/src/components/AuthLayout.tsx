import type { ReactNode } from "react";

/** The split sign-in screen: a flat travel poster on the left (pure SVG shapes), the form on the right. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="login">
      <aside className="login-art" aria-hidden="true">
        <svg className="poster" viewBox="0 0 600 800" preserveAspectRatio="xMidYMax slice">
          <g stroke="#111111" strokeWidth="6" strokeLinejoin="round">
            {/* setting sun with a ring */}
            <circle cx="440" cy="540" r="150" fill="none" stroke="#FFF4E0" strokeWidth="5" strokeDasharray="18 14" />
            <circle cx="440" cy="540" r="112" fill="#FFC72C" />
            {/* far range */}
            <path d="M-10 640 L110 470 L200 570 L320 410 L450 600 L530 500 L610 580 L610 810 L-10 810 Z" fill="#2BB57A" />
            <path d="M110 470 L140 513 L118 505 L96 520 Z M320 410 L360 468 L330 455 L300 470 L290 453 Z" fill="#FFF4E0" strokeWidth="4" />
            {/* near range */}
            <path d="M-10 700 L90 600 L190 690 L300 580 L430 710 L520 640 L610 700 L610 810 L-10 810 Z" fill="#D62718" />
            {/* ground strip */}
            <rect x="-10" y="742" width="620" height="70" fill="#FF7A1A" />
            <path d="M40 776 H140 M220 776 H300 M380 776 H480" stroke="#111111" strokeWidth="6" strokeLinecap="round" />
          </g>
          {/* plane and its dashed trail */}
          <path d="M40 440 C140 380 200 470 300 400 S430 330 470 300" fill="none" stroke="#FFF4E0" strokeWidth="5" strokeDasharray="14 12" strokeLinecap="round" />
          <g transform="translate(470 300) rotate(-28)" stroke="#111111" strokeWidth="5" strokeLinejoin="round">
            <path d="M-46 0 C-46 -9 -36 -12 -20 -12 L34 -12 C48 -12 58 -6 58 0 C58 6 48 12 34 12 L-20 12 C-36 12 -46 9 -46 0 Z" fill="#FFF4E0" />
            <path d="M2 -10 L-14 -50 L4 -50 L26 -10 Z M2 10 L-14 50 L4 50 L26 10 Z M-40 -6 L-52 -30 L-40 -30 L-28 -8 Z" fill="#1F45C9" />
          </g>
          {/* sparkles */}
          <g fill="#FFC72C" stroke="#111111" strokeWidth="4" strokeLinejoin="round">
            <path d="M565 368 l7 17 17 7 -17 7 -7 17 -7 -17 -17 -7 17 -7 z" />
            <path d="M540 180 l6 14 14 6 -14 6 -6 14 -6 -14 -14 -6 14 -6 z" />
          </g>
        </svg>
        <div>
          <div className="wordmark">Luxpackers<small>Operations desk</small></div>
          <p className="poster-type"><span>Lux</span><span>packers</span></p>
        </div>
        <div className="poster-foot">
          <div className="quote">Not just a trip. An experience.</div>
          <div className="foot">For the Luxpackers team only</div>
        </div>
      </aside>
      <main className="login-form">{children}</main>
    </div>
  );
}
