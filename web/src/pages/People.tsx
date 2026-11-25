import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DEPT_NAMES } from "../../../shared/schema";
import { api } from "../api";
import { useAuth } from "../auth";
import { AddPersonDrawer } from "../components/AddPersonDrawer";
import { PersonDrawer } from "../components/PersonDrawer";
import { Pill } from "../components/Pill";
import { ROLE_LABEL, STATUS_LABEL, STATUS_TONE, canManageUser, isStaff } from "../lib/people";
import type { PersonRow } from "../lib/people";
import { useTitle } from "../lib/useTitle";

export function People() {
  const { user } = useAuth();
  useTitle("People");
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const peopleQ = useQuery({ queryKey: ["people"], queryFn: () => api<{ people: PersonRow[] }>("GET", "/people"), staleTime: 5 * 60_000 });
  const people = peopleQ.data?.people ?? [];
  const staff = !!user && isStaff(user);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return people.filter(
      (p) => (!dept || p.dept === dept) && (!needle || [p.name, p.title, p.email, p.dept].some((v) => (v ?? "").toLowerCase().includes(needle))),
    );
  }, [people, q, dept]);
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const open = openId ? byId.get(openId) ?? null : null;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Team</div>
          <h1>People</h1>
          <p>Who is on the team, what they do and how to reach them.</p>
        </div>
        {user && canManageUser(user, "employee") && (
          <div className="actions"><button type="button" className="btn" onClick={() => setAdding(true)}>Add a person</button></div>
        )}
      </div>
      <div className="card">
        <div className="toolbar">
          <input className="input q" type="search" placeholder="Search by name, title or email" aria-label="Search people" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input" aria-label="Department" value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">All departments</option>
            {DEPT_NAMES.map((n) => <option key={n}>{n}</option>)}
          </select>
        </div>
        {peopleQ.isPending ? (
          <div className="empty">Loading people…</div>
        ) : peopleQ.isError ? (
          <div className="empty"><h3>Could not load people</h3><p>Refresh the page to try again.</p></div>
        ) : rows.length === 0 ? (
          <div className="empty">No one matches that search.</div>
        ) : (
          <div className="table-wrap">
            <table className="stack">
              <thead>
                <tr><th>Name</th><th>Department</th><th>Role</th><th>Contact</th><th>Manager</th>{staff && <th>Status</th>}</tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} onClick={() => setOpenId(p.id)}>
                    <td>
                      <button type="button" className="rowbtn" onClick={(e) => { e.stopPropagation(); setOpenId(p.id); }}>{p.name}</button>
                      {p.title && <div className="t-meta">{p.title}</div>}
                    </td>
                    <td data-l="Department">{p.dept}</td>
                    <td data-l="Role">{ROLE_LABEL[p.role]}</td>
                    <td data-l="Contact"><div>{p.email}</div>{p.phone && <div className="small muted">{p.phone}</div>}</td>
                    <td data-l="Manager">{(p.managerId && byId.get(p.managerId)?.name) || <span className="muted">None</span>}</td>
                    {staff && <td data-l="Status"><Pill tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Pill></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!peopleQ.isPending && !peopleQ.isError && <div className="list-foot"><span>{rows.length} {rows.length === 1 ? "person" : "people"}</span></div>}
      </div>
      {open && <PersonDrawer key={open.id} person={open} people={people} onClose={() => setOpenId(null)} />}
      {adding && <AddPersonDrawer onClose={() => setAdding(false)} />}
    </>
  );
}
