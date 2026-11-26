import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { pollWhileVisible } from "../lib/polling";
import { useAuth } from "../auth";
import { AddPersonDrawer } from "../components/AddPersonDrawer";
import { Figure, Figures } from "../components/Figure";
import { OnboardingList } from "../components/OnboardingList";
import type { Joiner } from "../components/OnboardingList";
import { PendingLeave } from "../components/PendingLeave";
import type { PendingLeaveItem } from "../components/PendingLeave";
import { fmtDay } from "../lib/tasks";
import { greeting, longDate, useTitle } from "../lib/useTitle";

interface Dash {
  overdue: unknown[];
  onboarding: Joiner[];
  joiningSoon: { userId: string; name: string; joinedOn: string }[];
  pendingLeave: PendingLeaveItem[];
}

export function HrHome() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  useTitle("Home");
  const dash = useQuery({ queryKey: ["dashboard"], queryFn: () => api<Dash>("GET", "/dashboard"), refetchInterval: pollWhileVisible });
  const d = dash.data;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{longDate()}</div>
          <h1>{greeting()}, {user?.name.split(" ")[0]}</h1>
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={() => setAdding(true)}>Add a person</button>
          <Link className="btn quiet" to="/people">People directory</Link>
          <Link className="btn quiet" to="/tasks">My tasks</Link>
        </div>
      </div>

      {dash.isPending ? (
        <div className="empty">Getting your day ready…</div>
      ) : dash.isError || !d ? (
        <div className="empty"><h3>Could not load your day</h3><p>Refresh the page to try again.</p></div>
      ) : (
        <>
          <Figures four>
            <Figure num={d.onboarding.length} label="New joiners" tone={d.onboarding.length ? "wait" : undefined} />
            <Figure num={d.pendingLeave.length} label="Leave to decide" tone={d.pendingLeave.length ? "wait" : undefined} to="/leave" />
            <Figure num={d.joiningSoon.length} label="Joining in 30 days" />
            <Figure num={d.overdue.length} label="My overdue tasks" tone={d.overdue.length ? "alert" : undefined} to="/tasks" />
          </Figures>

          <div className="grid-2 section">
            <section>
              <div className="section-head"><h2>Onboarding</h2></div>
              <div className="card card-pad">
                <OnboardingList joiners={d.onboarding} onChanged={() => void qc.invalidateQueries({ queryKey: ["dashboard"] })} />
              </div>
            </section>
            <aside>
              <div className="section-head"><h2>Joining soon</h2><Link to="/people">People</Link></div>
              <div className="card card-pad">
                {d.joiningSoon.length === 0 ? (
                  <p className="muted small" style={{ margin: 0 }}>No one is due to join in the next 30 days.</p>
                ) : (
                  <ul className="upcoming">
                    {d.joiningSoon.map((j) => (
                      <li key={j.userId}><span>{j.name}</span><span className="small muted nowrap">{fmtDay(j.joinedOn)}</span></li>
                    ))}
                  </ul>
                )}
              </div>
            </aside>
          </div>

          <section className="section">
            <div className="section-head"><h2>Leave to decide</h2><Link to="/leave">Leave</Link></div>
            <div className="card card-pad"><PendingLeave items={d.pendingLeave} /></div>
          </section>
        </>
      )}
      {adding && <AddPersonDrawer onClose={() => setAdding(false)} />}
    </>
  );
}
