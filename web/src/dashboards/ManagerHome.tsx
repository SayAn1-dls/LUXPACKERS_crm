import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { pollWhileVisible } from "../lib/polling";
import { useAuth } from "../auth";
import { Figure, Figures } from "../components/Figure";
import { PendingLeave } from "../components/PendingLeave";
import type { PendingLeaveItem } from "../components/PendingLeave";
import { ReviewQueue } from "../components/ReviewQueue";
import { TaskDrawer } from "../components/TaskDrawer";
import type { Task } from "../lib/tasks";
import { greeting, longDate, useTitle } from "../lib/useTitle";

interface Dash {
  reviewQueue: Task[];
  workload: { userId: string; name: string; open: number; late: number; submitted: number }[];
  pendingLeave: PendingLeaveItem[];
  registers: { id: string; name: string; open: number }[];
}

export function ManagerHome() {
  const { user } = useAuth();
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  useTitle("Home");
  const closeDrawer = useCallback(() => { setOpenId(null); setCreating(false); }, []);

  const dash = useQuery({ queryKey: ["dashboard"], queryFn: () => api<Dash>("GET", "/dashboard"), refetchInterval: pollWhileVisible });
  const d = dash.data;
  const late = d?.workload.reduce((s, w) => s + w.late, 0) ?? 0;
  const open = d?.workload.reduce((s, w) => s + w.open, 0) ?? 0;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{longDate()}</div>
          <h1>{greeting()}, {user?.name.split(" ")[0]}</h1>
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={() => setCreating(true)}>New task</button>
          <Link className="btn quiet" to="/tasks">My tasks</Link>
        </div>
      </div>

      {dash.isPending ? (
        <div className="empty">Getting your team's day ready…</div>
      ) : dash.isError || !d ? (
        <div className="empty"><h3>Could not load your team's day</h3><p>Refresh the page to try again.</p></div>
      ) : (
        <>
          <Figures four>
            <Figure num={d.reviewQueue.length} label="Waiting for your review" tone={d.reviewQueue.length ? "wait" : undefined} />
            <Figure num={late} label="Late tasks" tone={late ? "alert" : undefined} to="/tasks?tab=team" />
            <Figure num={open} label="Open team tasks" to="/tasks?tab=team" />
            <Figure num={d.pendingLeave.length} label="Leave to decide" tone={d.pendingLeave.length ? "wait" : undefined} />
          </Figures>

          <section className="section">
            <div className="section-head"><h2>Waiting for your review</h2></div>
            <div className="card card-pad"><ReviewQueue tasks={d.reviewQueue} onOpen={setOpenId} /></div>
          </section>

          <div className="grid-2 section">
            <section>
              <div className="section-head"><h2>Team workload</h2><Link to="/tasks?tab=team">All team tasks</Link></div>
              <div className="card">
                {d.workload.length === 0 ? (
                  <div className="empty">No one is on your team yet.</div>
                ) : (
                  <div className="table-wrap">
                    <table className="stack">
                      <thead><tr><th>Person</th><th className="num">Open</th><th className="num">Late</th><th className="num">Submitted</th></tr></thead>
                      <tbody>
                        {d.workload.map((w) => (
                          <tr key={w.userId} style={{ cursor: "default" }}>
                            <td data-l="Person"><Link className="rowbtn" to={`/tasks?tab=team&assignee=${encodeURIComponent(w.userId)}`}>{w.name}</Link></td>
                            <td data-l="Open" className="num">{w.open}</td>
                            <td data-l="Late" className={`num${w.late ? " late" : " muted"}`}>{w.late}</td>
                            <td data-l="Submitted" className={`num${w.submitted ? "" : " muted"}`}>{w.submitted}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="section-head" style={{ marginTop: 28 }}><h2>Leave to decide</h2><Link to="/leave">Leave</Link></div>
              <div className="card card-pad"><PendingLeave items={d.pendingLeave} /></div>
            </section>

            <aside>
              <div className="section-head"><h2>Registers</h2></div>
              <div className="card card-pad">
                {d.registers.length === 0 ? (
                  <p className="muted small" style={{ margin: 0 }}>Your department has no registers.</p>
                ) : (
                  <ul className="upcoming">
                    {d.registers.map((r) => (
                      <li key={r.id}>
                        <Link className="rowbtn" to={`/registers/${r.id}`}>{r.name}</Link>
                        <span className="small muted">{r.open} open</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </aside>
          </div>
        </>
      )}
      {openId && <TaskDrawer key={openId} taskId={openId} onClose={closeDrawer} />}
      {creating && <TaskDrawer key="new" onClose={closeDrawer} />}
    </>
  );
}
