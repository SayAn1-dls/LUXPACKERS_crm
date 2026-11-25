import { useLeaveActions } from "../lib/leave";
import { fmtDay } from "../lib/tasks";

export interface PendingLeaveItem {
  id: string; userId: string; userName: string; kind: string; start: string; end: string; days: number; halfDay: boolean; reason: string | null;
}

/** Leave requests waiting for a decision, with Approve and Reject. */
export function PendingLeave({ items }: { items: PendingLeaveItem[] }) {
  const { busy, run } = useLeaveActions();

  if (items.length === 0) return <p className="muted small" style={{ margin: 0 }}>No leave is waiting for a decision.</p>;
  return (
    <ul className="attention">
      {items.map((l) => (
        <li key={l.id}>
          <div>
            <b>{l.userName}</b>
            <div className="small muted">
              {l.kind} · {fmtDay(l.start)}{l.end !== l.start ? ` to ${fmtDay(l.end)}` : ""} · {l.halfDay ? "half day" : `${l.days} ${l.days === 1 ? "day" : "days"}`}
            </div>
            {l.reason && <div className="small">{l.reason}</div>}
          </div>
          <div className="actions">
            <button type="button" className="btn" disabled={busy === l.id} onClick={() => void run(l.id, "approve")}>Approve</button>
            <button type="button" className="btn quiet" disabled={busy === l.id} onClick={() => void run(l.id, "reject")}>Reject</button>
          </div>
        </li>
      ))}
    </ul>
  );
}
