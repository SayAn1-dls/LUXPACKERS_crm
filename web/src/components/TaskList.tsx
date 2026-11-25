import type { ReactNode } from "react";
import { Pill, taskTone } from "./Pill";
import { fmtDay } from "../lib/tasks";
import type { Task } from "../lib/tasks";

interface Props {
  tasks: Task[];
  onOpen: (id: string) => void;
  empty?: ReactNode;
}

export function TaskList({ tasks, onOpen, empty }: Props) {
  if (tasks.length === 0) return <div className="empty">{empty ?? "No tasks here."}</div>;
  return (
    <div className="table-wrap">
      <table className="stack">
        <thead>
          <tr><th>Task</th><th>Assigned to</th><th>Due</th><th>Priority</th><th>Status</th></tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id} onClick={() => onOpen(t.id)}>
              <td>
                <button type="button" className="rowbtn" onClick={(e) => { e.stopPropagation(); onOpen(t.id); }}>{t.title}</button>
                {t.notes && <div className="t-meta">{t.notes}</div>}
              </td>
              <td data-l="Assigned to">{t.assigneeName ?? "Nobody yet"}</td>
              <td data-l="Due" className="nowrap">
                {t.due ? <span className={t.late ? "late" : ""}>{fmtDay(t.due)}{t.late ? " · late" : ""}</span> : <span className="muted">No date</span>}
              </td>
              <td data-l="Priority">{t.priority ?? ""}</td>
              <td data-l="Status"><Pill tone={taskTone[t.status]}>{t.status}</Pill></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
