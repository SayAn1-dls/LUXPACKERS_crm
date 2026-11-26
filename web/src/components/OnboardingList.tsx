import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { errorText } from "../lib/errors";
import { fmtDay } from "../lib/tasks";
import { useToast } from "./Toast";

export interface Joiner { userId: string; name: string; done: number; total: number; joinedOn: string | null }
interface Step { step: string; done: boolean }

function Steps({ userId, onChanged }: { userId: string; onChanged: () => void }) {
  const notify = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ["onboarding", userId], queryFn: () => api<{ steps: Step[] }>("GET", `/onboarding/${userId}`) });

  async function toggle(s: Step) {
    setBusy(true);
    try {
      const next = await api<{ steps: Step[] }>("PATCH", `/onboarding/${userId}`, { step: s.step, done: !s.done });
      qc.setQueryData(["onboarding", userId], next);
      onChanged();
    } catch (e) {
      notify(errorText(e), true);
      await qc.invalidateQueries({ queryKey: ["onboarding", userId] });
    } finally {
      setBusy(false);
    }
  }

  if (q.isPending) return <p className="small muted" style={{ margin: "10px 0 0" }}>Loading steps…</p>;
  if (q.isError) return <p className="small late" style={{ margin: "10px 0 0" }}>Could not load the steps.</p>;
  return (
    <div className="checks" style={{ marginTop: 10 }}>
      {q.data.steps.map((s) => (
        <label className="check" key={s.step}>
          <input type="checkbox" checked={s.done} disabled={busy} onChange={() => void toggle(s)} />
          {s.step}
        </label>
      ))}
    </div>
  );
}

/** New joiners with their progress. Open one to tick off steps. */
export function OnboardingList({ joiners, onChanged }: { joiners: Joiner[]; onChanged: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  if (joiners.length === 0) return <p className="muted small" style={{ margin: 0 }}>No one is onboarding right now.</p>;
  return (
    <ul className="attention">
      {joiners.map((j) => {
        const pct = j.total ? Math.round((j.done / j.total) * 100) : 0;
        const isOpen = open === j.userId;
        return (
          <li key={j.userId}>
            <div>
              <b>{j.name}</b>
              <div className="small muted">{j.joinedOn ? `Joining ${fmtDay(j.joinedOn)} · ` : ""}{j.done} of {j.total} steps done</div>
              <div className="bar" style={{ marginTop: 8, maxWidth: 260 }} title={`${pct}% done`}><i style={{ width: `${pct}%` }} /></div>
              {isOpen && <Steps userId={j.userId} onChanged={onChanged} />}
            </div>
            <button type="button" className="btn quiet" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : j.userId)}>{isOpen ? "Hide steps" : "Show steps"}</button>
          </li>
        );
      })}
    </ul>
  );
}
