import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { safeInternal } from "../lib/safeInternal";

interface Item { id: string; kind: string; title: string; link: string | null; readAt: string | null; createdAt: string }
interface Feed { items: Item[]; unread: number }

export function timeAgo(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function NotificationBell() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const feed = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<Feed>("GET", "/notifications"),
    refetchInterval: () => (document.visibilityState === "visible" ? 60_000 : false),
  });
  const markRead = useMutation({
    mutationFn: (ids?: string[]) => api("POST", "/notifications/read", ids ? { ids } : {}),
    onSettled: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const unread = feed.data?.unread ?? 0;
  const items = feed.data?.items ?? [];

  const openItem = (it: Item) => {
    if (!it.readAt) markRead.mutate([it.id]);
    setOpen(false);
    const to = safeInternal(it.link);
    if (to) navigate(to);
  };

  return (
    <div className="bell" ref={box}>
      <button
        type="button"
        className="bell-btn"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
      >
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 7H4c0-1 2-2 2-7Z" />
          <path d="M10 20a2 2 0 0 0 4 0" />
        </svg>
        {unread > 0 && <span className="badge" aria-hidden="true">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div className="bell-menu" role="region" aria-label="Notifications">
          <div className="bell-head">
            <b>Notifications</b>
            {unread > 0 && (
              <button type="button" className="btn link" onClick={() => markRead.mutate(undefined)}>Mark all as read</button>
            )}
          </div>
          {items.length === 0 ? (
            <div className="empty small">Nothing new. You are all caught up.</div>
          ) : (
            <ul>
              {items.map((it) => (
                <li key={it.id}>
                  <button type="button" className={it.readAt ? "" : "unread"} onClick={() => openItem(it)}>
                    <span className="n-title">{it.title}</span>
                    <span className="small muted">{timeAgo(it.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
