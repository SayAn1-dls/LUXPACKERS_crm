import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { leaveDays } from "../../../shared/leave";
import { api, ApiError } from "../api";
import { errorText } from "../lib/errors";
import { LEAVE_KINDS, useRefreshLeave } from "../lib/leave";
import type { Balance, LeaveKind } from "../lib/leave";
import { useToast } from "./Toast";

/** Day count and a plain-English problem (if any) for the dates picked. Mirrors the server's checks. */
function count(start: string, end: string, half: boolean, holidays: string[]): { days: number | null; problem: string | null } {
  if (!start || !end) return { days: null, problem: null };
  if (start > end) return { days: null, problem: "The end date can't be before the start date." };
  if (start.slice(0, 4) !== end.slice(0, 4)) return { days: null, problem: "Leave can't cross into a new year. Split it into two requests." };
  const days = leaveDays(start, end, half, holidays);
  return { days, problem: days === 0 ? "Those dates are all weekends or holidays." : null };
}

export function LeaveForm({ balance }: { balance: Balance | undefined }) {
  const notify = useToast();
  const refresh = useRefreshLeave();
  const [kind, setKind] = useState<LeaveKind>("Casual");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [half, setHalf] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: () => api<{ holidays: string[] }>("GET", "/settings"), staleTime: 5 * 60_000 });

  const effEnd = half ? start : end;
  const { days, problem } = count(start, effEnd, half, settingsQ.data?.holidays ?? []);
  const left = kind === "Unpaid" ? null : balance?.[kind]?.left;
  const over = days !== null && days > 0 && left != null && days > left;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!start || !effEnd) return setError("Choose the dates first.");
    if (problem) return setError(problem);
    setBusy(true);
    setError("");
    try {
      await api("POST", "/leave", { kind, start, end: effEnd, halfDay: half, reason: reason.trim() || null });
      notify("Leave requested.");
      setStart("");
      setEnd("");
      setHalf(false);
      setReason("");
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setError("You already have leave on those dates.");
      else if (err instanceof ApiError && err.status === 400) setError(err.message);
      else notify(errorText(err), true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card card-pad" style={{ maxWidth: 720 }} onSubmit={(e) => void submit(e)} noValidate>
      <div className="section-head"><h2>Ask for leave</h2></div>
      <div className="form">
        <div className="field">
          <label className="flabel" htmlFor="lv_kind">Kind of leave</label>
          <select id="lv_kind" className="input" value={kind} onChange={(e) => setKind(e.target.value as LeaveKind)}>
            {LEAVE_KINDS.map((k) => <option key={k}>{k}</option>)}
          </select>
        </div>
        <div className="field">
          <span className="flabel">Half day</span>
          <label className="check"><input type="checkbox" checked={half} onChange={(e) => setHalf(e.target.checked)} /> Just half a day</label>
        </div>
        <div className="field">
          <label className="flabel" htmlFor="lv_start">{half ? "Date" : "From"}</label>
          <input id="lv_start" type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        {!half && (
          <div className="field">
            <label className="flabel" htmlFor="lv_end">To</label>
            <input id="lv_end" type="date" className="input" min={start || undefined} value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        )}
        <div className="field wide">
          <label className="flabel" htmlFor="lv_reason">Reason (optional)</label>
          <textarea id="lv_reason" className="input" style={{ minHeight: 70 }} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </div>
      <p className="leave-count" aria-live="polite">
        {problem ? (
          <span className="late">{problem}</span>
        ) : days === null ? (
          <span className="muted">Pick the dates to see how many working days this is.</span>
        ) : (
          <>
            <b>{half ? "Half a day" : `${days} working ${days === 1 ? "day" : "days"}`}</b>
            <span className="muted"> · weekends and holidays are not counted</span>
            {left != null && <span className={over ? "late" : "muted"}> · {over ? `only ${Math.max(left, 0)} ${kind} left` : `${left} ${kind} left before this`}</span>}
          </>
        )}
      </p>
      {error && <div className="err" role="alert">{error}</div>}
      <button type="submit" className="btn" disabled={busy}>Send request</button>
    </form>
  );
}
