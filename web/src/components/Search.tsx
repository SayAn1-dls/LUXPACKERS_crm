import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { safeInternal } from "../lib/safeInternal";

interface Hit { kind: "task" | "record" | "person"; id: string; title: string; sub: string; link: string }

const GROUPS: { kind: Hit["kind"]; label: string }[] = [
  { kind: "task", label: "Tasks" },
  { kind: "record", label: "Registers" },
  { kind: "person", label: "People" },
];

export function Search() {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setQ(text.trim()), 200);
    return () => window.clearTimeout(t);
  }, [text]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const active = q.length >= 2 && text.trim().length >= 2;
  const res = useQuery({
    queryKey: ["search", q],
    queryFn: () => api<{ results: Hit[] }>("GET", `/search?q=${encodeURIComponent(q)}`),
    enabled: active,
    staleTime: 15_000,
  });

  const go = (h: Hit) => {
    setText("");
    setQ("");
    setOpen(false);
    const to = safeInternal(h.link);
    if (to) navigate(to);
  };
  const results = res.data?.results ?? [];

  return (
    <div className="find" ref={box}>
      <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input
        className="input"
        type="search"
        placeholder="Find a task, guest, trip or person"
        aria-label="Find anything"
        autoComplete="off"
        value={text}
        onChange={(e) => { setText(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setText(""); setQ(""); setOpen(false); }
        }}
      />
      {open && active && q === text.trim() && !res.isFetching && (
        <div className="find-results">
          {res.isError ? (
            <div className="empty small">Search is not working right now. Try again in a moment.</div>
          ) : results.length === 0 ? (
            <div className="empty small">Nothing found for “{q}”.</div>
          ) : (
            GROUPS.map((g) => {
              const hits = results.filter((h) => h.kind === g.kind);
              if (!hits.length) return null;
              return (
                <div key={g.kind}>
                  <div className="find-group">{g.label}</div>
                  {hits.map((h) => (
                    <button type="button" key={`${h.kind}-${h.id}`} onClick={() => go(h)}>
                      <span>{h.title}</span>
                      <span className="small">{h.sub}</span>
                    </button>
                  ))}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
