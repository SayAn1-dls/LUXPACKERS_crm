import { Link } from "react-router-dom";
import { Empty } from "./Icon";

export interface WorkloadRow { userId: string; name: string; open: number; late: number; submitted: number }

/** Open, late and submitted tasks per person. `tab` is the Tasks tab the names link to. */
export function Workload({ rows, tab }: { rows: WorkloadRow[]; tab: "team" | "all" }) {
  if (rows.length === 0) return <Empty icon="people">No one else is on the team yet.</Empty>;
  return (
    <div className="table-wrap">
      <table className="stack">
        <thead><tr><th>Person</th><th className="num">Open</th><th className="num">Late</th><th className="num">Submitted</th></tr></thead>
        <tbody>
          {rows.map((w) => (
            <tr key={w.userId} style={{ cursor: "default" }}>
              <td data-l="Person">
                {tab === "team" ? <Link className="rowbtn" to={`/tasks?tab=team&assignee=${encodeURIComponent(w.userId)}`}>{w.name}</Link> : w.name}
              </td>
              <td data-l="Open" className="num">{w.open}</td>
              <td data-l="Late" className={`num${w.late ? " late" : " muted"}`}>{w.late}</td>
              <td data-l="Submitted" className={`num${w.submitted ? "" : " muted"}`}>{w.submitted}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
