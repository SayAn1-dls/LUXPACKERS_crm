import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { Figure, Figures } from "../components/Figure";
import { timeAgo } from "../components/NotificationBell";
import { Pill, taskTone } from "../components/Pill";
import { SectionHead } from "../components/SectionHead";
import { safeInternal } from "../lib/safeInternal";
import { fmtDay } from "../lib/tasks";
import type { Task, TaskComment } from "../lib/tasks";

export interface MyDayData {
  overdue: Task[]; today: Task[]; week: Task[]; sentBack: Task[]; waitingOnMe: Task[]; submitted: Task[];
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

/** The person's own day: figures, sent back, due now, this week, leave left and notifications. */
export function MyDay({ d, onOpen }: { d: MyDayData; onOpen: (id: string) => void }) {
  const navigate = useNavigate();
  const feed = useQuery({ queryKey: ["notifications"], queryFn: () => api<{ items: Note[] }>("GET", "/notifications") });
  const dueNow = [...d.overdue, ...d.today];
  const openNote = (n: Note) => {
    const to = safeInternal(n.link);
    if (to) navigate(to);
  };

  return (
    <>
      <Figures four>
        <Figure num={d.overdue.length} label="Overdue" tone={d.overdue.length ? "alert" : undefined} to="/tasks" />
        <Figure num={d.today.length} label="Due today" to="/tasks" />
        <Figure num={d.sentBack.length} label="Sent back" tone={d.sentBack.length ? "alert" : undefined} />
        <Figure num={d.waitingOnMe.length} label="Waiting on me" tone={d.waitingOnMe.length ? "wait" : undefined} />
      </Figures>

      {d.sentBack.length > 0 && (
        <section className="section">
          <SectionHead icon="tasks" title="Sent back to you" />
          <div className="card card-pad"><ul className="attention">{d.sentBack.map((t) => <SentBackItem key={t.id} task={t} onOpen={onOpen} />)}</ul></div>
        </section>
      )}

      <div className="grid-2 section">
        <section>
          <SectionHead icon="tasks" title="Due today and overdue" />
          <div className="card card-pad"><TaskRows tasks={dueNow} onOpen={onOpen} empty="Nothing is due. Enjoy the quiet." /></div>
          <div style={{ marginTop: 28 }}><SectionHead icon="leave" title="This week" /></div>
          <div className="card card-pad"><TaskRows tasks={d.week} onOpen={onOpen} empty="Nothing else is due in the next seven days." /></div>
        </section>
        <aside>
          <SectionHead icon="leave" title="Leave left this year"><Link to="/leave">Leave</Link></SectionHead>
          <div className="card card-pad">
            <ul className="upcoming">
              {Object.entries(d.leaveBalance).map(([kind, b]) => (
                <li key={kind}><span>{kind}</span><span className="num" style={{ fontVariantNumeric: "tabular-nums" }}><b>{b.left}</b> of {b.allowed} days</span></li>
              ))}
            </ul>
          </div>
          <div style={{ marginTop: 28 }}><SectionHead icon="inbox" title="Notifications" /></div>
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
  );
}
