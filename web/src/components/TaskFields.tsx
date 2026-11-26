import { DEPT_NAMES, TASK_PRIORITIES } from "../../../shared/schema";
import type { TaskPriority } from "../../../shared/schema";
import { fmtDay, safeHttp } from "../lib/tasks";
import type { Person } from "../lib/tasks";

export interface Draft {
  title: string;
  notes: string;
  dept: string;
  assigneeId: string;
  priority: TaskPriority;
  due: string;
  waitingOn: string;
  links: string[];
}

interface Props {
  draft: Draft;
  set: (patch: Partial<Draft>) => void;
  /** Title, notes, assignee, department, priority, due, links. */
  editable: boolean;
  /** Waiting on is the one field an assignee may change. */
  waitingEditable: boolean;
  showWaiting: boolean;
  assignees: Person[];
  /** Name shown when the assignee cannot be changed. */
  assigneeName: string;
  linksError: boolean;
  autoFocusTitle: boolean;
}

export function TaskFields({ draft, set, editable, waitingEditable, showWaiting, assignees, assigneeName, linksError, autoFocusTitle }: Props) {
  const ro = (v: string) => <div className="readonly">{v || <span className="muted">Not set</span>}</div>;
  const canPick = editable && assignees.length > 1;
  return (
    <div className="form">
      <div className="field wide">
        <label className="flabel" htmlFor="t_title">What needs doing *</label>
        {editable ? (
          <input id="t_title" className="input" value={draft.title} maxLength={300} autoFocus={autoFocusTitle} onChange={(e) => set({ title: e.target.value })} />
        ) : ro(draft.title)}
      </div>
      <div className="field wide">
        <label className="flabel" htmlFor="t_notes">Notes</label>
        {editable ? (
          <textarea id="t_notes" className="input" value={draft.notes} maxLength={5000} onChange={(e) => set({ notes: e.target.value })} />
        ) : <div className="readonly" style={{ whiteSpace: "pre-wrap" }}>{draft.notes || <span className="muted">No notes</span>}</div>}
      </div>
      <div className="field">
        <label className="flabel" htmlFor="t_assignee">Assigned to</label>
        {canPick ? (
          <select id="t_assignee" className="input" value={draft.assigneeId} onChange={(e) => set({ assigneeId: e.target.value })}>
            {!assignees.some((p) => p.id === draft.assigneeId) && <option value={draft.assigneeId}>{assigneeName}</option>}
            {assignees.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        ) : ro(assigneeName)}
      </div>
      <div className="field">
        <label className="flabel" htmlFor="t_dept">Department</label>
        {editable ? (
          <select id="t_dept" className="input" value={draft.dept} onChange={(e) => set({ dept: e.target.value })}>
            {!DEPT_NAMES.includes(draft.dept) && <option value={draft.dept}>{draft.dept || "Choose"}</option>}
            {DEPT_NAMES.map((d) => <option key={d}>{d}</option>)}
          </select>
        ) : ro(draft.dept)}
      </div>
      <div className="field">
        <label className="flabel" htmlFor="t_priority">Priority</label>
        {editable ? (
          <select id="t_priority" className="input" value={draft.priority} onChange={(e) => set({ priority: e.target.value as TaskPriority })}>
            {TASK_PRIORITIES.map((p) => <option key={p}>{p}</option>)}
          </select>
        ) : ro(draft.priority)}
      </div>
      <div className="field">
        <label className="flabel" htmlFor="t_due">Due date</label>
        {editable ? (
          <input id="t_due" type="date" className="input" value={draft.due} onChange={(e) => set({ due: e.target.value })} />
        ) : ro(fmtDay(draft.due || null))}
      </div>
      {showWaiting && (
        <div className="field wide">
          <label className="flabel" htmlFor="t_waiting">Waiting on</label>
          {waitingEditable ? (
            <input id="t_waiting" className="input" value={draft.waitingOn} maxLength={300} placeholder="Who or what are you waiting for?" onChange={(e) => set({ waitingOn: e.target.value })} />
          ) : ro(draft.waitingOn)}
        </div>
      )}
      <div className="field wide">
        <span className="flabel">Links</span>
        {editable ? (
          <div className="links-edit">
            {draft.links.map((l, i) => (
              <div className="link-row" key={i} style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
                <input className="input" aria-label={`Link ${i + 1}`} value={l} placeholder="https://" onChange={(e) => set({ links: draft.links.map((x, j) => (j === i ? e.target.value : x)) })} />
                <button type="button" className="x" aria-label={`Remove link ${i + 1}`} onClick={() => set({ links: draft.links.filter((_, j) => j !== i) })}>×</button>
              </div>
            ))}
            <div><button type="button" className="btn quiet" onClick={() => set({ links: [...draft.links, ""] })}>Add a link</button></div>
            {linksError && <span className="err">Each link must start with http:// or https://</span>}
            <span className="help">Add the page where the work happens: a Google Drive folder, a quote, a contract.</span>
          </div>
        ) : draft.links.length === 0 ? <div className="readonly muted">No links</div> : (
          <div className="readonly" style={{ display: "grid", gap: 4 }}>
            {draft.links.map((l, i) => {
              const ok = safeHttp(l);
              return ok ? (
                <a key={i} className="lnk" href={ok.href} target="_blank" rel="noopener noreferrer">{ok.host}</a>
              ) : <span key={i} className="muted">{l}</span>;
            })}
          </div>
        )}
      </div>
    </div>
  );
}
