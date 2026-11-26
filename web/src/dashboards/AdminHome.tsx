import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { pollWhileVisible } from "../lib/polling";
import { useAuth } from "../auth";
import { ActivityFeed } from "../components/ActivityFeed";
import { DeptCards } from "../components/DeptCards";
import type { DeptStat } from "../components/DeptCards";
import { Figure, Figures } from "../components/Figure";
import { PendingLeave } from "../components/PendingLeave";
import type { PendingLeaveItem } from "../components/PendingLeave";
import { ReviewQueue } from "../components/ReviewQueue";
import { TaskDrawer } from "../components/TaskDrawer";
import type { AuditItem } from "../lib/audit";
import { moneyShort } from "../lib/registers";
import { fmtDay } from "../lib/tasks";
import type { Task } from "../lib/tasks";
import { greeting, longDate, useTitle } from "../lib/useTitle";

interface Dash {
  figures: { openTasks: number; late: number; waiting: number; openEnquiries: number; quoted: number; receivedThisMonth: number; tripsLive: number; tripsTotal: number };
  attention: { kind: string; id: string; title: string; why: string; owner: string | null; dept: string | null; link: string }[];
  next7: { kind: string; id: string; title: string; label: string; due: string; link: string }[];
  departments: DeptStat[];
  latest: AuditItem[];
  reviewQueue: Task[];
  workload: { userId: string; name: string; open: number; late: number; submitted: number }[];
  pendingLeave: PendingLeaveItem[];
  registers: { id: string; name: string; open: number }[];
  needsOwner: { tasks: number; records: { id: string; name: string; count: number }[] };
}

function NeedsOwner({ d }: { d: Dash["needsOwner"] }) {
  const recs = d.records.filter((r) => r.count > 0);
  const nothing = d.tasks === 0 && recs.length === 0;
  return (
    <section className="section">
      <div className="section-head"><h2>Needs an owner</h2></div>
      <div className="card card-pad">
        {nothing ? (
          <p className="muted small" style={{ margin: 0 }}>Every open task and record has an owner.</p>
        ) : (
          <ul className="upcoming">
            {d.tasks > 0 && (
              <li>
                <Link className="rowbtn" to="/tasks?tab=all&owner=none">Open tasks</Link>
                <span className="small muted">{d.tasks} with no one assigned</span>
              </li>
            )}
            {recs.map((r) => (
              <li key={r.id}>
                <Link className="rowbtn" to={`/registers/${r.id}?owner=none`}>{r.name}</Link>
                <span className="small muted">{r.count} with no owner</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export function AdminHome() {
  const { user } = useAuth();
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  useTitle("Home");
  const closeDrawer = useCallback(() => { setOpenId(null); setCreating(false); }, []);
  const dash = useQuery({ queryKey: ["dashboard"], queryFn: () => api<Dash>("GET", "/dashboard"), refetchInterval: pollWhileVisible });
  const d = dash.data;
  const f = d?.figures;
  const empty = !!d && !!f && d.departments.every((x) => x.total === 0) && d.registers.every((r) => r.open === 0) && f.tripsTotal === 0;

  return (
    <>
      {empty && (
        <div className="welcome">
          <div>
            <h2>Welcome to the Luxpackers desk</h2>
            <p>The CRM is empty. Load the starting records: the open tasks, the trips, the team roles, the access register and the partner hotels.</p>
          </div>
          <Link className="btn" to="/import">Load starting records</Link>
        </div>
      )}
      <div className="page-head">
        <div>
          <div className="eyebrow">{longDate()}</div>
          <h1>{greeting()}, {user?.name.split(" ")[0]}</h1>
          {f && <p>{f.openTasks} open tasks across the company{f.late ? `, ${f.late} overdue` : ", none overdue"}. {f.tripsLive} of {f.tripsTotal} trips are live on the website.</p>}
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={() => setCreating(true)}>New task</button>
          <Link className="btn quiet" to="/registers/leads">Enquiries</Link>
        </div>
      </div>

      {dash.isPending ? (
        <div className="empty">Getting the company's day ready…</div>
      ) : dash.isError || !d || !f ? (
        <div className="empty"><h3>Could not load the overview</h3><p>Refresh the page to try again.</p></div>
      ) : (
        <>
          <Figures>
            <Figure num={f.openTasks} label="Open tasks" to="/tasks?tab=all" />
            <Figure num={f.late} label="Overdue" sub="tasks and follow-ups" tone={f.late ? "alert" : undefined} to="/tasks?tab=all" />
            <Figure num={f.waiting} label="Waiting" sub="on someone else" tone={f.waiting ? "wait" : undefined} to="/tasks?tab=all" />
            <Figure num={f.openEnquiries} label="Open enquiries" sub={f.quoted ? `${moneyShort(f.quoted)} quoted` : undefined} to="/registers/leads" />
            <Figure num={moneyShort(f.receivedThisMonth)} label="Received this month" to="/registers/finance" />
            <Figure num={`${f.tripsLive} / ${f.tripsTotal}`} label="Trips live" to="/registers/trips" />
          </Figures>

          <div className="grid-2 section">
            <section className="card card-pad">
              <div className="section-head"><h2>Needs attention</h2><Link to="/tasks?tab=all">All tasks</Link></div>
              {d.attention.length === 0 ? (
                <p className="muted small" style={{ margin: 0 }}>Nothing needs attention right now.</p>
              ) : (
                <ul className="attention">
                  {d.attention.map((x) => (
                    <li key={`${x.kind}${x.id}`}>
                      <div>
                        <Link className="rowbtn" to={x.link}>{x.title}</Link>
                        <div className="small muted">{x.why} · {x.owner ?? "No owner"} · {x.dept ?? "No department"}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <div style={{ display: "grid", gap: 24, alignContent: "start" }}>
              <section className="card card-pad">
                <div className="section-head"><h2>Next seven days</h2></div>
                {d.next7.length === 0 ? (
                  <p className="muted small" style={{ margin: 0 }}>Nothing is due in the next seven days.</p>
                ) : (
                  <ul className="upcoming">
                    {d.next7.slice(0, 7).map((x) => (
                      <li key={`${x.kind}${x.id}`}>
                        <div><Link className="rowbtn" to={x.link}>{x.title}</Link><div className="small muted">{x.label}</div></div>
                        <span className="small nowrap">{fmtDay(x.due)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section className="card card-pad">
                <div className="section-head"><h2>Latest changes</h2><Link to="/audit">Audit log</Link></div>
                <ActivityFeed items={d.latest} />
              </section>
            </div>
          </div>

          <NeedsOwner d={d.needsOwner} />

          <section className="section">
            <div className="section-head"><h2>Waiting for review</h2></div>
            <div className="card card-pad"><ReviewQueue tasks={d.reviewQueue} onOpen={setOpenId} /></div>
          </section>

          <div className="grid-2 section">
            <section>
              <div className="section-head"><h2>Team workload</h2><Link to="/tasks?tab=all">All tasks</Link></div>
              <div className="card">
                {d.workload.length === 0 ? (
                  <div className="empty">No one else is on the team yet.</div>
                ) : (
                  <div className="table-wrap">
                    <table className="stack">
                      <thead><tr><th>Person</th><th className="num">Open</th><th className="num">Late</th><th className="num">Submitted</th></tr></thead>
                      <tbody>
                        {d.workload.map((w) => (
                          <tr key={w.userId} style={{ cursor: "default" }}>
                            <td data-l="Person">{w.name}</td>
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
            </section>
            <aside>
              <div className="section-head"><h2>Leave to decide</h2><Link to="/leave">Leave</Link></div>
              <div className="card card-pad"><PendingLeave items={d.pendingLeave} /></div>
              <div className="section-head" style={{ marginTop: 28 }}><h2>Registers</h2></div>
              <div className="card card-pad">
                <ul className="upcoming">
                  {d.registers.map((r) => (
                    <li key={r.id}>
                      <Link className="rowbtn" to={`/registers/${r.id}`}>{r.name}</Link>
                      <span className="small muted">{r.open} open</span>
                    </li>
                  ))}
                </ul>
              </div>
            </aside>
          </div>

          <section className="section">
            <div className="section-head"><h2>Departments</h2></div>
            <DeptCards departments={d.departments} />
          </section>
        </>
      )}
      {openId && <TaskDrawer key={openId} taskId={openId} onClose={closeDrawer} />}
      {creating && <TaskDrawer key="new" onClose={closeDrawer} />}
    </>
  );
}
