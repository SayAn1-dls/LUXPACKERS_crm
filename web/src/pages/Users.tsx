import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DEPT_NAMES, ROLES } from "../../../shared/schema";
import type { RoleName } from "../../../shared/schema";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { AddPersonDrawer } from "../components/AddPersonDrawer";
import { PersonDrawer } from "../components/PersonDrawer";
import { Pill } from "../components/Pill";
import { Placeholder } from "../components/Placeholder";
import { TempPassword } from "../components/TempPassword";
import { useToast } from "../components/Toast";
import { errorText } from "../lib/errors";
import { ROLE_LABEL, STATUS_LABEL, STATUS_TONE, canChangeRole, canEditManaged, isStaff, managerChoices, useRefreshPeople } from "../lib/people";
import type { PersonRow } from "../lib/people";
import { useTitle } from "../lib/useTitle";

type Pending = { kind: "disable" | "reset"; person: PersonRow };

export function Users() {
  const { user } = useAuth();
  if (!user || !isStaff(user)) return <Placeholder title="Users" eyebrow="Manage" note="You don't have access to this page." />;
  return <UserAdmin />;
}

function UserAdmin() {
  const { user } = useAuth();
  const notify = useToast();
  const refresh = useRefreshPeople();
  useTitle("Users");
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [temp, setTemp] = useState<{ name: string; password: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["users"], queryFn: () => api<{ users: PersonRow[] }>("GET", "/users") });
  const all = q.data?.users ?? [];
  const byId = new Map(all.map((p) => [p.id, p]));
  const edit = editId ? byId.get(editId) ?? null : null;

  async function patch(p: PersonRow, body: Record<string, unknown>, done = "Saved.") {
    setBusy(p.id);
    try {
      await api("PATCH", `/users/${p.id}`, body);
      notify(done);
    } catch (e) {
      notify(e instanceof ApiError && e.code === "invalid_manager" ? "Choose a different manager." : errorText(e), true);
    } finally {
      await refresh();
      setBusy(null);
    }
  }

  async function confirm() {
    if (!pending) return;
    const { kind, person } = pending;
    setPending(null);
    if (kind === "disable") return patch(person, { status: "left" }, `${person.name} has been turned off.`);
    setBusy(person.id);
    try {
      const res = await api<{ tempPassword: string }>("POST", `/users/${person.id}/reset-password`);
      setTemp({ name: person.name, password: res.tempPassword });
    } catch (e) {
      notify(errorText(e), true);
    } finally {
      setBusy(null);
    }
  }

  const asked = pending && (
    <div className="notice red" role="alert">
      {pending.kind === "disable"
        ? <>Disable {pending.person.name}? They'll be signed out straight away.</>
        : <>Reset the password for {pending.person.name}? They'll be signed out and given a new temporary password.</>}
      <div className="actions" style={{ marginTop: 10 }}>
        <button type="button" className="btn danger" onClick={() => void confirm()}>{pending.kind === "disable" ? "Yes, disable" : "Yes, reset"}</button>
        <button type="button" className="btn quiet" onClick={() => setPending(null)}>Keep as it is</button>
      </div>
    </div>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Manage</div>
          <h1>Users</h1>
          <p>Create accounts, change who reports to whom, reset passwords and turn off sign-in for people who have left.</p>
        </div>
        <div className="actions"><button type="button" className="btn" onClick={() => setAdding(true)}>Add a person</button></div>
      </div>
      {temp && <TempPassword name={temp.name} password={temp.password} onDone={() => setTemp(null)} />}
      {asked}
      <div className="card">
        {q.isPending ? (
          <div className="empty">Loading users…</div>
        ) : q.isError ? (
          <div className="empty"><h3>Could not load users</h3><p>Refresh the page to try again.</p></div>
        ) : (
          <div className="table-wrap">
            <table className="stack">
              <thead><tr><th>Person</th><th>Role</th><th>Department</th><th>Manager</th><th>Status</th><th /></tr></thead>
              <tbody>
                {all.map((p) => {
                  const managed = !!user && canEditManaged(user, p);
                  const self = p.id === user?.id;
                  const managers = managerChoices(all, p.id);
                  const left = p.status === "left";
                  return (
                    <tr key={p.id} style={{ cursor: "default" }}>
                      <td>
                        <button type="button" className="rowbtn" onClick={() => setEditId(p.id)}>{p.name}</button>
                        <div className="t-meta">{p.email}</div>
                      </td>
                      <td data-l="Role">
                        {user && canChangeRole(user, p) ? (
                          <select className="input cell-select" aria-label={`Role for ${p.name}`} value={p.role} disabled={busy === p.id} onChange={(e) => void patch(p, { role: e.target.value as RoleName })}>
                            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                          </select>
                        ) : ROLE_LABEL[p.role]}
                      </td>
                      <td data-l="Department">
                        {managed ? (
                          <select className="input cell-select" aria-label={`Department for ${p.name}`} value={p.dept} disabled={busy === p.id} onChange={(e) => void patch(p, { dept: e.target.value })}>
                            {!DEPT_NAMES.includes(p.dept) && <option>{p.dept}</option>}
                            {DEPT_NAMES.map((n) => <option key={n}>{n}</option>)}
                          </select>
                        ) : p.dept}
                      </td>
                      <td data-l="Manager">
                        {managed ? (
                          <select className="input cell-select" aria-label={`Manager for ${p.name}`} value={p.managerId ?? ""} disabled={busy === p.id} onChange={(e) => void patch(p, { managerId: e.target.value || null })}>
                            <option value="">No manager</option>
                            {p.managerId && !managers.some((m) => m.id === p.managerId) && <option value={p.managerId}>{byId.get(p.managerId)?.name ?? "Former team member"}</option>}
                            {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                          </select>
                        ) : (p.managerId && byId.get(p.managerId)?.name) || <span className="muted">None</span>}
                      </td>
                      <td data-l="Status"><Pill tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Pill></td>
                      <td>
                        {managed && (
                          <div className="actions">
                            {!left && <button type="button" className="btn quiet" disabled={busy === p.id} onClick={() => setPending({ kind: "reset", person: p })}>Reset password</button>}
                            {!left && !self && <button type="button" className="btn quiet" disabled={busy === p.id} onClick={() => setPending({ kind: "disable", person: p })}>Disable</button>}
                            {left && <button type="button" className="btn quiet" disabled={busy === p.id} onClick={() => void patch(p, { status: "active" }, `${p.name} can sign in again.`)}>Turn back on</button>}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!q.isPending && !q.isError && <div className="list-foot"><span>{all.length} {all.length === 1 ? "account" : "accounts"}</span></div>}
      </div>
      {adding && <AddPersonDrawer onClose={() => setAdding(false)} />}
      {edit && <PersonDrawer key={edit.id} person={edit} people={all} onClose={() => setEditId(null)} />}
    </>
  );
}
