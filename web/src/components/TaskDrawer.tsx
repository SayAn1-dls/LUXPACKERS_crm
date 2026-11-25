import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { Pill, taskTone } from "./Pill";
import { TaskActions } from "./TaskActions";
import { TaskFields } from "./TaskFields";
import type { Draft } from "./TaskFields";
import { TaskThread } from "./TaskThread";
import { useToast } from "./Toast";
import { CONFLICT_MESSAGE, assignablePeople, safeHttp, taskErrorMessage, taskPerms, useRefreshTasks } from "../lib/tasks";
import type { Person, Task, TaskStatus } from "../lib/tasks";

interface Props {
  /** Open an existing task, or leave empty to start a new one. */
  taskId?: string | null;
  /** Starting values for a new task. */
  preset?: Partial<Pick<Draft, "title" | "notes" | "dept" | "assigneeId" | "priority" | "due">>;
  onClose: () => void;
}

const blank = (userId: string, dept: string, preset: Props["preset"]): Draft => ({
  title: "", notes: "", dept, assigneeId: userId, priority: "Medium", due: "", waitingOn: "", links: [], ...preset,
});
const fromTask = (t: Task): Draft => ({
  title: t.title, notes: t.notes ?? "", dept: t.dept ?? "", assigneeId: t.assigneeId ?? "", priority: t.priority ?? "Medium",
  due: t.due ?? "", waitingOn: t.waitingOn ?? "", links: t.links,
});

export function TaskDrawer({ taskId, preset, onClose }: Props) {
  const { user } = useAuth();
  const notify = useToast();
  const refresh = useRefreshTasks();
  const box = useRef<HTMLElement>(null);
  const isNew = !taskId;

  const peopleQ = useQuery({ queryKey: ["people"], queryFn: () => api<{ people: Person[] }>("GET", "/people"), staleTime: 5 * 60_000 });
  const taskQ = useQuery({
    queryKey: ["tasks", taskId],
    queryFn: () => api<{ task: Task }>("GET", `/tasks/${taskId}`),
    enabled: !!taskId,
  });
  const task = taskQ.data?.task ?? null;
  const people = peopleQ.data?.people ?? [];

  const [draft, setDraft] = useState<Draft>(() => blank(user!.id, user!.dept, preset));
  const [base, setBase] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [linksError, setLinksError] = useState(false);

  // Load the saved values into the form whenever the task changes underneath us (open, save, reload).
  useEffect(() => {
    if (!task) return;
    const d = fromTask(task);
    setDraft(d);
    setBase(d);
    setLinksError(false);
  }, [task?.id, task?.version]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus the dialog once on open. The Escape listener reads the latest onClose from a ref so parent re-renders never re-run this.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const perms = useMemo(() => (task && user ? taskPerms(user, task, people) : null), [task, user, people]);
  const dirty = !isNew && !!base && JSON.stringify(draft) !== JSON.stringify(base);
  const assignees = useMemo(() => (user ? assignablePeople(user, people) : []), [user, people]);
  if (!user) return null;

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const cleanLinks = draft.links.map((l) => l.trim()).filter(Boolean);
  const badLinks = cleanLinks.some((l) => !safeHttp(l));

  /** Runs one server call; turns failures into the right toast. Returns true on success. */
  async function run(call: () => Promise<unknown>, done?: string, whileAssigning = false): Promise<boolean> {
    setBusy(true);
    try {
      await call();
      await refresh();
      if (done) notify(done);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict(true);
      notify(taskErrorMessage(e, whileAssigning), true);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const reload = async () => {
    setConflict(false);
    await refresh();
  };

  const save = async () => {
    if (!draft.title.trim()) return notify("Give the task a title.", true);
    if (badLinks) {
      setLinksError(true);
      return;
    }
    setLinksError(false);
    if (isNew) {
      const body = {
        title: draft.title.trim(),
        notes: draft.notes.trim() || undefined,
        dept: draft.dept || undefined,
        assigneeId: draft.assigneeId,
        priority: draft.priority,
        due: draft.due || undefined,
        links: cleanLinks,
      };
      if (await run(() => api("POST", "/tasks", body), "Task added.", draft.assigneeId !== user.id)) onClose();
      return;
    }
    if (!task || !base) return;
    const body: Record<string, unknown> = { version: task.version };
    if (draft.title.trim() !== base.title) body.title = draft.title.trim();
    if (draft.notes.trim() !== base.notes.trim()) body.notes = draft.notes.trim() || null;
    if (draft.dept !== base.dept && draft.dept) body.dept = draft.dept;
    if (draft.assigneeId !== base.assigneeId) body.assigneeId = draft.assigneeId;
    if (draft.priority !== base.priority) body.priority = draft.priority;
    if (draft.due !== base.due) body.due = draft.due || null;
    if (draft.waitingOn.trim() !== base.waitingOn.trim()) body.waitingOn = draft.waitingOn.trim() || null;
    if (JSON.stringify(cleanLinks) !== JSON.stringify(base.links)) body.links = cleanLinks;
    await run(() => api("PATCH", `/tasks/${task.id}`, body), "Saved.", "assigneeId" in body);
  };

  const act = (path: string, extra: object, done: string) =>
    task && run(() => api("POST", `/tasks/${task.id}/${path}`, { version: task.version, ...extra }), done);
  const setStatus = (status: TaskStatus) =>
    task && run(() => api("PATCH", `/tasks/${task.id}`, { version: task.version, status }), status === "Done" ? "Marked done." : "Status updated.");

  const missing = !isNew && taskQ.error instanceof ApiError && taskQ.error.status === 404;
  const waitingShown = !!draft.waitingOn || task?.status === "Waiting";

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="drawer" role="dialog" aria-modal="true" aria-labelledby="taskTitle" tabIndex={-1} ref={box}>
        <div className="drawer-head">
          <div className="eyebrow">Task{isNew ? " · new" : ""}</div>
          <h2 id="taskTitle">{isNew ? "New task" : task?.title ?? (missing ? "Task not found" : "Loading…")}</h2>
          {task && (
            <div className="small muted" style={{ marginTop: 6, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <Pill tone={taskTone[task.status]}>{task.status}</Pill>
              {task.assignedByName && task.assignedById !== task.assigneeId && <span>Assigned by {task.assignedByName}</span>}
            </div>
          )}
        </div>
        <div className="drawer-body">
          {missing && <div className="empty"><h3>That task is no longer here</h3><p>It may have been removed, or it is not one you can open.</p></div>}
          {conflict && (
            <div className="notice red" role="alert" style={{ position: "sticky", top: 0, zIndex: 2 }}>
              {CONFLICT_MESSAGE}{" "}
              <button type="button" className="btn quiet" style={{ marginLeft: 8, minHeight: 36 }} onClick={reload}>Reload</button>
            </div>
          )}
          {isNew && (
            <TaskFields
              draft={draft} set={set} editable waitingEditable={false} showWaiting={false} assignees={assignees}
              assigneeName={user.name} linksError={linksError} autoFocusTitle
            />
          )}
          {task && perms && (
            <>
              <TaskFields
                draft={draft} set={set} editable={perms.canEditFields} waitingEditable={perms.canEditWaiting} showWaiting={waitingShown}
                assignees={assignees} assigneeName={task.assigneeName ?? "Nobody yet"} linksError={linksError} autoFocusTitle={false}
              />
              <div className="form" style={{ marginTop: 12 }}>
                <TaskActions
                  status={task.status} perms={perms} busy={busy} dirty={dirty}
                  onStatus={(s) => void setStatus(s)}
                  onSubmit={() => void act("submit", {}, "Sent for review.")}
                  onWithdraw={() => void setStatus("In progress")}
                  onApprove={() => void act("approve", {}, "Approved.")}
                  onSendBack={(comment) => void act("send-back", { comment }, "Sent back.")}
                />
              </div>
              <TaskThread task={task} />
            </>
          )}
          {!isNew && !task && !missing && <p className="muted">Loading…</p>}
        </div>
        <div className="drawer-foot">
          <div />
          <div className="actions">
            <button type="button" className="btn quiet" onClick={onClose}>{isNew || dirty ? "Cancel" : "Close"}</button>
            {(isNew || (dirty && perms)) && (
              <button type="button" className="btn" disabled={busy} onClick={() => void save()}>{isNew ? "Add task" : "Save changes"}</button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
