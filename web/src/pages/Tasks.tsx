import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useAuth } from "../auth";
import { TaskDrawer } from "../components/TaskDrawer";
import { TaskList } from "../components/TaskList";
import { useTitle } from "../lib/useTitle";
import type { Task } from "../lib/tasks";

type Scope = "mine" | "assigned" | "team" | "all";
type Show = "open" | "done" | "everything";

const TABS: { scope: Scope; label: string; empty: string }[] = [
  { scope: "mine", label: "My tasks", empty: "Nothing on your list. Add a task to get started." },
  { scope: "assigned", label: "I assigned", empty: "You have not given anyone a task yet." },
  { scope: "team", label: "My team", empty: "No tasks in your team yet." },
  { scope: "all", label: "All", empty: "There are no tasks yet." },
];

export function Tasks() {
  const { user } = useAuth();
  useTitle("Tasks");
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [show, setShow] = useState<Show>("open");

  const tabs = TABS.filter((t) => (t.scope === "team" ? user?.role === "manager" || user?.role === "admin" : t.scope === "all" ? user?.role === "admin" : true));
  const asked = params.get("tab");
  const current = tabs.find((t) => t.scope === asked) ?? tabs[0];
  const openId = params.get("open");

  const q = useQuery({ queryKey: ["tasks", "list", current.scope], queryFn: () => api<{ tasks: Task[] }>("GET", `/tasks?scope=${current.scope}`) });

  // "My team" can be narrowed to one person (from the manager's workload table).
  const assignee = current.scope === "team" ? params.get("assignee") : null;
  const assigneeName = assignee ? (q.data?.tasks ?? []).find((t) => t.assigneeId === assignee)?.assigneeName ?? null : null;

  const rows = useMemo(() => {
    const all = (q.data?.tasks ?? []).filter((t) => !assignee || t.assigneeId === assignee);
    return show === "everything" ? all : all.filter((t) => (show === "done") === (t.status === "Done"));
  }, [q.data, show, assignee]);

  const closeDrawer = useCallback(() => {
    setCreating(false);
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.delete("open");
      return n;
    }, { replace: true });
  }, [setParams]);
  const openTask = (id: string) => setParams((p) => { const n = new URLSearchParams(p); n.set("open", id); return n; });

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Work</div>
          <h1>Tasks</h1>
        </div>
        <div className="actions"><button type="button" className="btn" onClick={() => setCreating(true)}>New task</button></div>
      </div>
      <div className="card">
        <div className="chips" role="tablist" aria-label="Which tasks">
          {tabs.map((t) => (
            <button
              key={t.scope} type="button" role="tab" className="chip" aria-selected={t.scope === current.scope} aria-pressed={t.scope === current.scope}
              onClick={() => setParams((p) => { const n = new URLSearchParams(p); n.set("tab", t.scope); n.delete("assignee"); return n; }, { replace: true })}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="toolbar">
          {assignee && (
            <>
              <span className="small">Showing {assigneeName ? `${assigneeName}'s` : "one person's"} tasks</span>
              <button type="button" className="btn quiet" style={{ minHeight: 36 }} onClick={() => setParams((p) => { const n = new URLSearchParams(p); n.delete("assignee"); return n; }, { replace: true })}>Show everyone</button>
            </>
          )}
          <label className="flabel" htmlFor="show">Show</label>
          <select id="show" className="input" value={show} onChange={(e) => setShow(e.target.value as Show)}>
            <option value="open">Open tasks</option>
            <option value="done">Finished tasks</option>
            <option value="everything">Everything</option>
          </select>
        </div>
        {q.isPending ? (
          <div className="empty">Loading tasks…</div>
        ) : q.isError ? (
          <div className="empty"><h3>Could not load tasks</h3><p>{q.error.message}</p></div>
        ) : (
          <TaskList tasks={rows} onOpen={openTask} empty={assignee ? "Nothing to show for this person." : show === "open" ? current.empty : "Nothing to show here."} />
        )}
        {!q.isPending && !q.isError && <div className="list-foot"><span>{rows.length} {rows.length === 1 ? "task" : "tasks"}</span></div>}
      </div>
      {(openId || creating) && <TaskDrawer key={openId ?? "new"} taskId={openId} onClose={closeDrawer} />}
    </>
  );
}
