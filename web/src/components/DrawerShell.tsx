import { useEffect, useRef, type ReactNode } from "react";

interface Props {
  eyebrow: string;
  title: string;
  titleId: string;
  onClose: () => void;
  foot?: ReactNode;
  children: ReactNode;
}

/** Side drawer frame: focus on open, Escape and a click on the dim area close it. */
export function DrawerShell({ eyebrow, title, titleId, onClose, foot, children }: Props) {
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
      <section className="drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={box}>
        <div className="drawer-head">
          <div className="eyebrow">{eyebrow}</div>
          <h2 id={titleId}>{title}</h2>
        </div>
        <div className="drawer-body">{children}</div>
        {foot && <div className="drawer-foot">{foot}</div>}
      </section>
    </div>
  );
}
