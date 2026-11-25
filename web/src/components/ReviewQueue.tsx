import { useState } from "react";
import { api } from "../api";
import { Pill } from "./Pill";
import { useToast } from "./Toast";
import { fmtDay, taskErrorMessage, useRefreshTasks } from "../lib/tasks";
import type { Task } from "../lib/tasks";

/** Submitted tasks waiting for a decision. Approve or send back without opening the task. */
export function ReviewQueue({ tasks, onOpen }: { tasks: Task[]; onOpen: (id: string) => void }) {
  const notify = useToast();
  const refresh = useRefreshTasks();
  const [busy, setBusy] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [comment, setComment] = useState("");

  async function decide(t: Task, path: "approve" | "send-back", extra: object, done: string) {
    setBusy(t.id);
    try {
      await api("POST", `/tasks/${t.id}/${path}`, { version: t.version, ...extra });
      await refresh();
      notify(done);
      setSending(null);
      setComment("");
    } catch (e) {
      notify(taskErrorMessage(e), true);
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  if (tasks.length === 0) return <p className="muted small" style={{ margin: 0 }}>Nothing is waiting for your review.</p>;
  return (
    <ul className="attention">
      {tasks.map((t) => (
        <li key={t.id}>
          <div>
            <button type="button" className="rowbtn" onClick={() => onOpen(t.id)}>{t.title}</button>
            <div className="small muted">
              {t.assigneeName ?? "Nobody"}{t.due ? <> · <span className={t.late ? "late" : ""}>{t.late ? "late, was due " : "due "}{fmtDay(t.due)}</span></> : ""}
            </div>
            {sending === t.id && (
              <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                <label className="flabel" htmlFor={`sb_${t.id}`}>Tell them what to change</label>
                <textarea id={`sb_${t.id}`} className="input" value={comment} onChange={(e) => setComment(e.target.value)} autoFocus />
                <div className="actions">
                  <button type="button" className="btn danger" disabled={busy === t.id || !comment.trim()} onClick={() => void decide(t, "send-back", { comment: comment.trim() }, "Sent back.")}>Send back</button>
                  <button type="button" className="btn quiet" onClick={() => { setSending(null); setComment(""); }}>Cancel</button>
                </div>
              </div>
            )}
          </div>
          <div style={{ display: "grid", gap: 8, justifyItems: "end" }}>
            <Pill tone="doing">Submitted</Pill>
            {sending !== t.id && (
              <div className="actions">
                <button type="button" className="btn" disabled={busy === t.id} onClick={() => void decide(t, "approve", {}, "Approved.")}>Approve</button>
                <button type="button" className="btn quiet" disabled={busy === t.id} onClick={() => { setSending(t.id); setComment(""); }}>Send back</button>
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
