import { useCallback, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { pollWhileVisible } from "../lib/polling";
import { useAuth } from "../auth";
import { ActivityFeed } from "../components/ActivityFeed";
import { AddPersonDrawer } from "../components/AddPersonDrawer";
import { Empty, Icon } from "../components/Icon";
import { SectionHead } from "../components/SectionHead";
import { Workload, type WorkloadRow } from "../components/Workload";
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
  workload: WorkloadRow[];
  pendingLeave: PendingLeaveItem[];
  registers: { id: string; name: string; open: number }[];
  needsOwner: { tasks: number; records: { id: string; name: string; count: number }[] };
}

function NeedsOwner({ d }: { d: Dash["needsOwner"] }) {
  const recs = d.records.filter((r) => r.count > 0);
  const nothing = d.tasks === 0 && recs.length === 0;
  return (
    <section className="section">
      <SectionHead icon="people" title="Needs an owner" />
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
  const [adding, setAdding] = useState(false);
  const navigate = useNavigate();
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
      </div>

      <div className="big-actions">
        <button type="button" className="big-action" onClick={() => setAdding(true)}>
          <span className="ba-icon"><Icon name="userPlus" size={22} /></span>
          <span><b>Add a person</b><span>Give someone a sign-in and a position.</span></span>
        </button>
        <button type="button" className="big-action" onClick={() => navigate("/positions?new=1")}>
          <span className="ba-icon"><Icon name="badge" size={22} /></span>
          <span><b>Create a position</b><span>Choose what a post can open.</span></span>
        </button>
        <button type="button" className="big-action" onClick={() => setCreating(true)}>
          <span className="ba-icon"><Icon name="tasks" size={22} /></span>
          <span><b>Assign a task</b><span>Give work to anyone, with a date.</span></span>
        </button>
      </div>

      {dash.isPending ? (
        <div className="card"><Empty icon="sparkle">Getting the company's day ready…</Empty></div>
      ) : dash.isError || !d || !f ? (
        <div className="card"><Empty icon="inbox" title="Could not load the overview"><p>Refresh the page to try again.</p></Empty></div>
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
              <SectionHead icon="tasks" title="Needs attention"><Link to="/tasks?tab=all">All tasks</Link></SectionHead>
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
                <SectionHead icon="leave" title="Next seven days" />
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
                <SectionHead icon="log" title="Latest changes"><Link to="/audit">Audit log</Link></SectionHead>
                <ActivityFeed items={d.latest} />
              </section>
            </div>
          </div>

          <NeedsOwner d={d.needsOwner} />

          <section className="section">
            <SectionHead icon="check" title="Waiting for review" />
            <div className="card card-pad"><ReviewQueue tasks={d.reviewQueue} onOpen={setOpenId} /></div>
          </section>

          <div className="grid-2 section">
            <section>
              <SectionHead icon="people" title="Team workload"><Link to="/tasks?tab=all">All tasks</Link></SectionHead>
              <div className="card">
                <Workload rows={d.workload} tab="all" />
              </div>
            </section>
            <aside>
              <SectionHead icon="leave" title="Leave to decide"><Link to="/leave">Leave</Link></SectionHead>
              <div className="card card-pad"><PendingLeave items={d.pendingLeave} /></div>
              <div style={{ marginTop: 28 }}><SectionHead icon="folder" title="Registers" /></div>
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
            <SectionHead icon="folder" title="Departments" />
            <DeptCards departments={d.departments} />
          </section>
        </>
      )}
      {openId && <TaskDrawer key={openId} taskId={openId} onClose={closeDrawer} />}
      {creating && <TaskDrawer key="new" onClose={closeDrawer} />}
      {adding && <AddPersonDrawer onClose={() => setAdding(false)} />}
    </>
  );
}
