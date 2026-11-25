import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import { useToast } from "./Toast";
import { fmtDay } from "../lib/tasks";

export interface PendingLeaveItem {
  id: string; userId: string; userName: string; kind: string; start: string; end: string; days: number; halfDay: boolean; reason: string | null;
}

/** Leave requests waiting for a decision, with Approve and Reject. */
export function PendingLeave({ items }: { items: PendingLeaveItem[] }) {
  const notify = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  async function decide(l: PendingLeaveItem, verb: "approve" | "reject") {
    setBusy(l.id);
    try {
      await api("POST", `/leave/${l.id}/${verb}`);
      notify(verb === "approve" ? "Leave approved." : "Leave rejected.");
    } catch (e) {
      notify(e instanceof ApiError && e.code === "not_pending" ? "That request was already decided." : e instanceof ApiError && e.status === 403 ? "You can't decide this request." : "Something went wrong. Please try again.", true);
    } finally {
      await Promise.all(["leave", "dashboard", "notifications"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      setBusy(null);
    }
  }

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
            <button type="button" className="btn" disabled={busy === l.id} onClick={() => void decide(l, "approve")}>Approve</button>
            <button type="button" className="btn quiet" disabled={busy === l.id} onClick={() => void decide(l, "reject")}>Reject</button>
          </div>
        </li>
      ))}
    </ul>
  );
}
