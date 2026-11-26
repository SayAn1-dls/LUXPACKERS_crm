import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { longDate } from "../lib/useTitle";
import { Icon } from "./Icon";
import { NotificationBell } from "./NotificationBell";
import { Search } from "./Search";
import { Sidebar } from "./Sidebar";

export function Shell() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    setOpen(false);
    window.scrollTo(0, 0);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="shell">
      <Sidebar open={open} onNavigate={() => setOpen(false)} />
      {open && <div className="side-scrim" onClick={() => setOpen(false)} aria-hidden="true" />}
      <div className="main">
        <header className="topbar">
          <button type="button" className="btn quiet menu-btn" aria-expanded={open} aria-controls="side" onClick={() => setOpen((o) => !o)}>
            <Icon name="menu" size={18} />Menu
          </button>
          <Search />
          <span className="spacer" />
          <span className="today">{longDate()}</span>
          <NotificationBell />
        </header>
        <main className="page" id="page">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
