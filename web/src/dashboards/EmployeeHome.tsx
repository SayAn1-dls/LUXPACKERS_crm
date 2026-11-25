import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useAuth } from "../auth";
import { Figure, Figures } from "../components/Figure";
import { timeAgo } from "../components/NotificationBell";
import { Pill, taskTone } from "../components/Pill";
import { TaskDrawer } from "../components/TaskDrawer";
import { fmtDay } from "../lib/tasks";
import type { Task, TaskComment } from "../lib/tasks";
import { safeInternal } from "../lib/safeInternal";
import { greeting, longDate, useTitle } from "../lib/useTitle";

interface Dash {
  overdue: Task[];
  today: Task[];
  week: Task[];
  sentBack: Task[];
  waitingOnMe: Task[];
  submitted: Task[];
  leaveBalance: Record<string, { allowed: number; used: number; left: number }>;
}
interface Note { id: string; title: string; link: string | null; readAt: string | null; createdAt: string }

/** One row of the "Sent back" list: the task and what the reviewer asked for. */
function SentBackItem({ task, onOpen }: { task: Task; onOpen: (id: string) => void }) {
  const q = useQuery({
    queryKey: ["tasks", task.id, "comments"],
    queryFn: () => api<{ comments: TaskComment[] }>("GET", `/tasks/${task.id}/comments`),
  });
  const note = [...(q.data?.comments ?? [])].reverse().find((c) => c.kind === "sent_back");
  return (
    <li>
      <div>
        <button type="button" className="rowbtn" onClick={() => onOpen(task.id)}>{task.title}</button>
        {note && <div className="small" style={{ marginTop: 2 }}><span className="muted">{note.userName} said:</span> {note.body}</div>}
      </div>
      <Pill tone="alert">Sent back</Pill>
    </li>
  );
}

function TaskRows({ tasks, onOpen, empty }: { tasks: Task[]; onOpen: (id: string) => void; empty: string }) {
  if (tasks.length === 0) return <p className="muted small" style={{ margin: 0 }}>{empty}</p>;
  return (
    <ul className="attention">
      {tasks.map((t) => (
        <li key={t.id}>
          <div>
            <button type="button" className="rowbtn" onClick={() => onOpen(t.id)}>{t.title}</button>
            <div className="small muted">{t.due ? <span className={t.late ? "late" : ""}>{t.late ? "Late, was due " : "Due "}{fmtDay(t.due)}</span> : "No date"}</div>
          </div>
          <Pill tone={taskTone[t.status]}>{t.status}</Pill>
        </li>
      ))}
    </ul>
  );
}

export function EmployeeHome() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [openId, setOpenId] = useState<string | null>(null);
  useTitle("Home");

  const dash = useQuery({ queryKey: ["dashboard"], queryFn: () => api<Dash>("GET", "/dashboard") });
  const feed = useQuery({ queryKey: ["notifications"], queryFn: () => api<{ items: Note[] }>("GET", "/notifications") });
  const d = dash.data;
  const dueNow = d ? [...d.overdue, ...d.today] : [];

  const openNote = (n: Note) => {
    const to = safeInternal(n.link);
    if (to) navigate(to);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{longDate()}</div>
          <h1>{greeting()}, {user?.name.split(" ")[0]}</h1>
        </div>
        <div className="actions"><Link className="btn" to="/tasks">All my tasks</Link></div>
      </div>

      {dash.isPending ? (
        <div className="empty">Getting your day ready…</div>
      ) : dash.isError || !d ? (
        <div className="empty"><h3>Could not load your day</h3><p>Refresh the page to try again.</p></div>
      ) : (
        <>
          <Figures four>
            <Figure num={d.overdue.length} label="Overdue" tone={d.overdue.length ? "alert" : undefined} />
            <Figure num={d.today.length} label="Due today" />
            <Figure num={d.sentBack.length} label="Sent back" tone={d.sentBack.length ? "alert" : undefined} />
            <Figure num={d.waitingOnMe.length} label="Waiting on me" tone={d.waitingOnMe.length ? "wait" : undefined} />
          </Figures>

          {d.sentBack.length > 0 && (
            <section className="section">
              <div className="section-head"><h2>Sent back to you</h2></div>
              <div className="card card-pad"><ul className="attention">{d.sentBack.map((t) => <SentBackItem key={t.id} task={t} onOpen={setOpenId} />)}</ul></div>
            </section>
          )}

          <div className="grid-2 section">
            <section>
              <div className="section-head"><h2>Due today and overdue</h2></div>
              <div className="card card-pad"><TaskRows tasks={dueNow} onOpen={setOpenId} empty="Nothing is due. Enjoy the quiet." /></div>
              <div className="section-head" style={{ marginTop: 28 }}><h2>This week</h2></div>
              <div className="card card-pad"><TaskRows tasks={d.week} onOpen={setOpenId} empty="Nothing else is due in the next seven days." /></div>
            </section>
            <aside>
              <div className="section-head"><h2>Leave left this year</h2><Link to="/leave">Leave</Link></div>
              <div className="card card-pad">
                <ul className="upcoming">
                  {Object.entries(d.leaveBalance).map(([kind, b]) => (
                    <li key={kind}><span>{kind}</span><span className="num" style={{ fontVariantNumeric: "tabular-nums" }}><b>{b.left}</b> of {b.allowed} days</span></li>
                  ))}
                </ul>
              </div>
              <div className="section-head" style={{ marginTop: 28 }}><h2>Notifications</h2></div>
              <div className="card card-pad">
                {(feed.data?.items.length ?? 0) === 0 ? (
                  <p className="muted small" style={{ margin: 0 }}>Nothing new. You are all caught up.</p>
                ) : (
                  <ul className="feed">
                    {feed.data!.items.slice(0, 5).map((n) => (
                      <li key={n.id}>
                        <button type="button" className="rowbtn" style={n.readAt ? { fontWeight: 400 } : undefined} onClick={() => openNote(n)}>{n.title}</button>
                        <time>{timeAgo(n.createdAt)}</time>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </aside>
          </div>
        </>
      )}
      {openId && <TaskDrawer key={openId} taskId={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}
