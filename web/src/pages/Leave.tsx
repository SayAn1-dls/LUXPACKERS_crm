import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useAuth } from "../auth";
import { LeaveForm } from "../components/LeaveForm";
import { Pill } from "../components/Pill";
import { daysText, useLeaveActions } from "../lib/leave";
import type { Balance, LeaveRequest } from "../lib/leave";
import { fmtDay } from "../lib/tasks";
import { useTitle } from "../lib/useTitle";
import type { Tone } from "../../../shared/schema";

type Scope = "mine" | "team" | "all";
const TONE: Record<LeaveRequest["status"], Tone> = { Pending: "wait", Approved: "done", Rejected: "alert", Cancelled: "muted" };
const range = (l: LeaveRequest) => `${fmtDay(l.start)}${l.end !== l.start ? ` to ${fmtDay(l.end)}` : ""}`;

export function Leave() {
  const { user } = useAuth();
  useTitle("Leave");
  const approverTab: { scope: Scope; label: string } | null =
    user?.role === "manager" ? { scope: "team", label: "My team" } : user?.role === "hr" || user?.role === "admin" ? { scope: "all", label: "Everyone" } : null;
  const [scope, setScope] = useState<Scope>("mine");
  const current = approverTab && scope === approverTab.scope ? scope : "mine";
  const { busy, run } = useLeaveActions();

  const q = useQuery({
    queryKey: ["leave", current],
    queryFn: () => api<{ requests: LeaveRequest[]; balance?: Balance }>("GET", `/leave?scope=${current}`),
  });
  // The balance only comes with "mine"; keep the form informed on the other tab too.
  const mineQ = useQuery({
    queryKey: ["leave", "mine"],
    queryFn: () => api<{ requests: LeaveRequest[]; balance?: Balance }>("GET", "/leave?scope=mine"),
  });
  const balance = mineQ.data?.balance;
  const rows = (q.data?.requests ?? []).filter((l) => current === "mine" || l.userId !== user?.id);
  const others = current !== "mine";

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Time off</div>
          <h1>Leave</h1>
        </div>
      </div>

      {balance && (
        <div className="figures four" style={{ marginBottom: 24 }}>
          {Object.entries(balance).map(([kind, b]) => (
            <div className="fig" key={kind}>
              <span className="num">{b.left}</span>
              <span className="lbl">{kind} left</span>
              <span className="sub">{b.used} of {b.allowed} days used or pending</span>
            </div>
          ))}
        </div>
      )}

      <section>
        <div className="card">
          {approverTab && (
            <div className="chips" role="tablist" aria-label="Whose leave">
              {[{ scope: "mine" as Scope, label: "My leave" }, approverTab].map((t) => (
                <button key={t.scope} type="button" role="tab" className="chip" aria-selected={t.scope === current} aria-pressed={t.scope === current} onClick={() => setScope(t.scope)}>{t.label}</button>
              ))}
            </div>
          )}
          {q.isPending ? (
            <div className="empty">Loading leave…</div>
          ) : q.isError ? (
            <div className="empty"><h3>Could not load leave</h3><p>Refresh the page to try again.</p></div>
          ) : rows.length === 0 ? (
            <div className="empty">{others ? "No leave requests to show." : "You haven't asked for any leave yet."}</div>
          ) : (
            <div className="table-wrap">
              <table className="stack">
                <thead><tr>{others && <th>Person</th>}<th>Kind</th><th>Dates</th><th className="num">Days</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {rows.map((l) => (
                    <tr key={l.id} style={{ cursor: "default" }}>
                      {others && <td data-l="Person"><div className="t-title">{l.userName}</div></td>}
                      <td data-l="Kind">{l.kind}{l.reason && <div className="t-meta">{l.reason}</div>}</td>
                      <td data-l="Dates" className="nowrap">{range(l)}</td>
                      <td data-l="Days" className="num">{daysText(l.days, l.halfDay)}</td>
                      <td data-l="Status"><Pill tone={TONE[l.status]}>{l.status}</Pill></td>
                      <td>
                        {l.status === "Pending" && (
                          <div className="actions">
                            {others ? (
                              <>
                                <button type="button" className="btn" disabled={busy === l.id} onClick={() => void run(l.id, "approve")}>Approve</button>
                                <button type="button" className="btn quiet" disabled={busy === l.id} onClick={() => void run(l.id, "reject")}>Reject</button>
                              </>
                            ) : (
                              <button type="button" className="btn quiet" disabled={busy === l.id} onClick={() => void run(l.id, "cancel")}>Cancel request</button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
      <section className="section"><LeaveForm balance={balance} /></section>
    </>
  );
}
