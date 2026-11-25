import { useState } from "react";
import { Pill, taskTone } from "./Pill";
import type { TaskPerms, TaskStatus } from "../lib/tasks";

interface Props {
  status: TaskStatus;
  perms: TaskPerms;
  busy: boolean;
  /** Unsaved field edits: the action buttons wait until they are saved. */
  dirty: boolean;
  onStatus: (s: TaskStatus) => void;
  onSubmit: () => void;
  onWithdraw: () => void;
  onApprove: () => void;
  onSendBack: (comment: string) => void;
}

/** Everything that moves a task between states. Which buttons show depends on the person and the task. */
export function TaskActions({ status, perms, busy, dirty, onStatus, onSubmit, onWithdraw, onApprove, onSendBack }: Props) {
  const [sending, setSending] = useState(false);
  const [comment, setComment] = useState("");
  const off = busy || dirty;
  const nothing = !perms.canSubmit && !perms.canWithdraw && !perms.canReview && !perms.showMarkDone && perms.statusOptions.length === 0;

  return (
    <div className="field wide">
      <span className="flabel">Status</span>
      {perms.statusOptions.length > 0 ? (
        <div className="statuses" role="group" aria-label="Status">
          {perms.statusOptions.map((s) => (
            <label key={s}>
              <input type="radio" name="status" checked={s === status} disabled={off} onChange={() => onStatus(s)} />
              <Pill tone={taskTone[s]}>{s}</Pill>
            </label>
          ))}
        </div>
      ) : (
        <div><Pill tone={taskTone[status]}>{status}</Pill></div>
      )}

      {(perms.canSubmit || perms.showMarkDone || perms.canWithdraw || perms.canReview) && (
        <div className="actions" style={{ marginTop: 10 }}>
          {perms.canSubmit && <button type="button" className="btn" disabled={off} onClick={onSubmit}>Submit for review</button>}
          {perms.showMarkDone && <button type="button" className="btn" disabled={off} onClick={() => onStatus("Done")}>Mark done</button>}
          {perms.canWithdraw && <button type="button" className="btn quiet" disabled={off} onClick={onWithdraw}>Withdraw</button>}
          {perms.canReview && !sending && (
            <>
              <button type="button" className="btn" disabled={off} onClick={onApprove}>Approve</button>
              <button type="button" className="btn quiet" disabled={off} onClick={() => setSending(true)}>Send back</button>
            </>
          )}
        </div>
      )}

      {perms.canReview && sending && (
        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          <label className="flabel" htmlFor="sendback">Tell them what to change</label>
          <textarea id="sendback" className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Tell them what to change" autoFocus />
          <div className="actions">
            <button type="button" className="btn danger" disabled={off || !comment.trim()} onClick={() => onSendBack(comment.trim())}>Send back</button>
            <button type="button" className="btn quiet" onClick={() => { setSending(false); setComment(""); }}>Cancel</button>
          </div>
        </div>
      )}
      {dirty && !nothing && <span className="help">Save your changes first.</span>}
      {status === "Submitted" && perms.isAssignee && <span className="help">Waiting for review. Withdraw it if you need to keep working.</span>}
    </div>
  );
}
