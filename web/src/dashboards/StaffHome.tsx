import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useAuth } from "../auth";
import { AddPersonDrawer } from "../components/AddPersonDrawer";
import { Empty, Icon } from "../components/Icon";
import { OnboardingList } from "../components/OnboardingList";
import type { Joiner } from "../components/OnboardingList";
import { PendingLeave } from "../components/PendingLeave";
import type { PendingLeaveItem } from "../components/PendingLeave";
import { ReviewQueue } from "../components/ReviewQueue";
import { SectionHead } from "../components/SectionHead";
import { TaskDrawer } from "../components/TaskDrawer";
import { Workload, type WorkloadRow } from "../components/Workload";
import { canAddPeople, taskLevel } from "../lib/perms";
import { pollWhileVisible } from "../lib/polling";
import type { Task } from "../lib/tasks";
import { fmtDay } from "../lib/tasks";
import { greeting, longDate, useTitle } from "../lib/useTitle";
import { MyDay, type MyDayData } from "./MyDay";

/** Optional sections arrive only when the person's position allows them. */
interface Dash extends MyDayData {
  reviewQueue?: Task[];
  workload?: WorkloadRow[];
  pendingLeave?: PendingLeaveItem[];
  registers?: { id: string; name: string; open: number }[];
  onboarding?: Joiner[];
  joiningSoon?: { userId: string; name: string; joinedOn: string }[];
}

/** Home for everyone except the administrator. Sections follow the position, not a role name. */
export function StaffHome() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [adding, setAdding] = useState(false);
  useTitle("Home");
  const closeDrawer = useCallback(() => { setOpenId(null); setCreating(false); }, []);
  const dash = useQuery({ queryKey: ["dashboard"], queryFn: () => api<Dash>("GET", "/dashboard"), refetchInterval: pollWhileVisible });
  const d = dash.data;
  const tab = user && taskLevel(user) === "all" ? "all" : "team";

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{longDate()}</div>
          <h1>{greeting()}, {user?.name.split(" ")[0]}</h1>
          {user?.positionName && <p>Signed in as {user.positionName}.</p>}
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={() => setCreating(true)}><Icon name="plus" size={16} />New task</button>
          {user && canAddPeople(user) && <button type="button" className="btn quiet" onClick={() => setAdding(true)}><Icon name="userPlus" size={16} />Add an employee</button>}
        </div>
      </div>

      {dash.isPending ? (
        <div className="card"><Empty icon="sparkle">Getting your day ready…</Empty></div>
      ) : dash.isError || !d ? (
        <div className="card"><Empty icon="inbox" title="Could not load your day"><p>Refresh the page to try again.</p></Empty></div>
      ) : (
        <>
          {d.reviewQueue && (
            <section className="section first">
              <SectionHead icon="check" title="Waiting for your review" />
              <div className="card card-pad"><ReviewQueue tasks={d.reviewQueue} onOpen={setOpenId} /></div>
            </section>
          )}
          {d.pendingLeave && (
            <section className="section first">
              <SectionHead icon="leave" title="Leave to decide"><Link to="/leave">Leave</Link></SectionHead>
              <div className="card card-pad"><PendingLeave items={d.pendingLeave} /></div>
            </section>
          )}

          <div className="section"><MyDay d={d} onOpen={setOpenId} /></div>

          {d.workload && (
            <section className="section">
              <SectionHead icon="people" title="Team workload"><Link to={`/tasks?tab=${tab}`}>All team tasks</Link></SectionHead>
              <div className="card"><Workload rows={d.workload} tab={tab} /></div>
            </section>
          )}

          {d.onboarding && (
            <div className="grid-2 section">
              <section>
                <SectionHead icon="userPlus" title="Onboarding" />
                <div className="card card-pad">
                  <OnboardingList joiners={d.onboarding} onChanged={() => void qc.invalidateQueries({ queryKey: ["dashboard"] })} />
                </div>
              </section>
              <aside>
                <SectionHead icon="leave" title="Joining soon" />
                <div className="card card-pad">
                  {(d.joiningSoon ?? []).length === 0 ? (
                    <p className="muted small" style={{ margin: 0 }}>No one is due to join in the next 30 days.</p>
                  ) : (
                    <ul className="upcoming">
                      {d.joiningSoon!.map((j) => <li key={j.userId}><span>{j.name}</span><span className="small muted nowrap">{fmtDay(j.joinedOn)}</span></li>)}
                    </ul>
                  )}
                </div>
              </aside>
            </div>
          )}

          {d.registers && d.registers.length > 0 && (
            <section className="section">
              <SectionHead icon="folder" title="Your registers" />
              <ul className="reg-tiles">
                {d.registers.map((r) => (
                  <li key={r.id}><Link to={`/registers/${r.id}`}><Icon name="folder" /><b>{r.name}</b><span>{r.open} open</span></Link></li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      {openId && <TaskDrawer key={openId} taskId={openId} onClose={closeDrawer} />}
      {creating && <TaskDrawer key="new" onClose={closeDrawer} />}
      {adding && <AddPersonDrawer onClose={() => setAdding(false)} />}
    </>
  );
}
