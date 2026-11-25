import type { ReactNode } from "react";

/** The split sign-in screen: line art on the left, the form on the right. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="login">
      <aside className="login-art" aria-hidden="true">
        <svg viewBox="0 0 600 700" preserveAspectRatio="xMidYMid slice">
          <g fill="none" stroke="#3A464E" strokeWidth="1">
            {Array.from({ length: 11 }, (_, i) => <ellipse key={`e${i}`} cx="300" cy="350" rx={40 + i * 34} ry="260" />)}
            {Array.from({ length: 9 }, (_, i) => <path key={`p${i}`} d={`M0 ${110 + i * 60} Q300 ${80 + i * 60} 600 ${110 + i * 60}`} />)}
          </g>
        </svg>
        <div className="wordmark">Luxpackers<small>Operations desk</small></div>
        <div className="quote">Not just a trip. An experience.</div>
        <div className="foot">For the Luxpackers team only.</div>
      </aside>
      <main className="login-form">{children}</main>
    </div>
  );
}
