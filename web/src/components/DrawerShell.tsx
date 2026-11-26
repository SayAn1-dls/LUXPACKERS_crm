import { useEffect, useRef, type ReactNode } from "react";

interface Props {
  eyebrow: string;
  title: string;
  titleId: string;
  onClose: () => void;
  foot?: ReactNode;
  /** A roomier drawer for editors with grids. */
  wide?: boolean;
  children: ReactNode;
}

/** Side drawer frame: focus on open, Escape and a click on the dim area close it. */
export function DrawerShell({ eyebrow, title, titleId, onClose, foot, wide, children }: Props) {
  const box = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className={`drawer${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={box}>
        <div className="drawer-head">
          <div className="eyebrow">{eyebrow}</div>
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="drawer-x" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div className="drawer-body">{children}</div>
        {foot && <div className="drawer-foot">{foot}</div>}
      </section>
    </div>
  );
}
