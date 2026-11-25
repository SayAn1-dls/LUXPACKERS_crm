import { DEPARTMENTS } from "../../../shared/schema";

export interface DeptStat { name: string; open: number; late: number; done: number; total: number }

/** One card per department: open and late tasks and how much is done. */
export function DeptCards({ departments }: { departments: DeptStat[] }) {
  const lead = (name: string) => DEPARTMENTS.find((d) => d.name === name)?.lead;
  return (
    <div className="depts">
      {departments.map((s) => {
        const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
        return (
          <div className="dept" key={s.name}>
            <h3>{s.name}</h3>
            <div className="row"><span>Open tasks</span><b>{s.open}</b></div>
            <div className="row"><span>Overdue</span><b className={s.late ? "late" : ""}>{s.late}</b></div>
            <div className="bar" title={`${pct}% done`}><i style={{ width: `${pct}%` }} /></div>
            <div className="row"><span>{s.done} of {s.total} done</span><span>Lead · {lead(s.name)}</span></div>
          </div>
        );
      })}
    </div>
  );
}
