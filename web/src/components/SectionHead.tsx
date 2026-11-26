import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

/** A section title with a small icon and an optional link on the right. */
export function SectionHead({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="section-head">
      <h2><span className="sh-icon"><Icon name={icon} size={16} /></span>{title}</h2>
      {children}
    </div>
  );
}
