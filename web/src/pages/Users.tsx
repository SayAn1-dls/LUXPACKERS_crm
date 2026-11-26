import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { AddPersonDrawer } from "../components/AddPersonDrawer";
import { Empty, Icon } from "../components/Icon";
import { PersonDrawer } from "../components/PersonDrawer";
import { Pill } from "../components/Pill";
import { Placeholder } from "../components/Placeholder";
import { SetPasswordDialog } from "../components/SetPasswordDialog";
import { useToast } from "../components/Toast";
import { errorText } from "../lib/errors";
import { STATUS_LABEL, STATUS_TONE, positionLabel, useRefreshPeople } from "../lib/people";
import type { PersonRow } from "../lib/people";
import { canAddPeople } from "../lib/perms";
import { useTitle } from "../lib/useTitle";

/** People & logins. The admin manages everyone; someone with "add people" only gets the simple add form. */
export function Users() {
  const { user } = useAuth();
  if (user?.isAdmin) return <LoginAdmin />;
  if (user && canAddPeople(user)) return <AddOnly />;
  return <Placeholder title="People & logins" eyebrow="Admin" note="You don't have access to this page." />;
}

function AddOnly() {
  useTitle("Add an employee");
  const [adding, setAdding] = useState(false);
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Team</div>
          <h1>Add an employee</h1>
          <p>Create a sign-in for someone new. They start as an Employee and get a temporary password, shown to you once.</p>
        </div>
        <div className="actions"><button type="button" className="btn" onClick={() => setAdding(true)}><Icon name="userPlus" size={16} />Add an employee</button></div>
      </div>
      {adding && <AddPersonDrawer onClose={() => setAdding(false)} />}
    </>
  );
}

function LoginAdmin() {
  const { user } = useAuth();
  const notify = useToast();
  const refresh = useRefreshPeople();
  useTitle("People & logins");
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [pwFor, setPwFor] = useState<PersonRow | null>(null);
  const [disabling, setDisabling] = useState<PersonRow | null>(null);
  const [resetting, setResetting] = useState<PersonRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["users"], queryFn: () => api<{ users: PersonRow[] }>("GET", "/users") });
  const all = q.data?.users ?? [];
  const byId = new Map(all.map((p) => [p.id, p]));
  const edit = editId ? byId.get(editId) ?? null : null;

  async function setStatus(p: PersonRow, status: "left" | "active", done: string) {
    setBusy(p.id);
    setDisabling(null);
    try {
      await api("PATCH", `/users/${p.id}`, { status });
      notify(done);
    } catch (e) {
      notify(e instanceof ApiError && e.code === "last_admin" ? "Someone else must be an administrator first." : errorText(e), true);
    } finally {
      await refresh();
      setBusy(null);
    }
  }

  async function resetMfa(p: PersonRow) {
    setBusy(p.id);
    setResetting(null);
    try {
      await api("POST", `/users/${p.id}/mfa/reset`);
      notify(`Two-step sign-in reset for ${p.name}. They have been signed out everywhere.`);
    } catch (e) {
      notify(errorText(e), true);
    } finally {
      await refresh();
      setBusy(null);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Admin</div>
          <h1>People &amp; logins</h1>
          <p>Add people, choose their position, change their work email and set new passwords.</p>
          <p className="small">Passwords can't be viewed — only set. Setting a new one signs the person out everywhere. Administrators must use two-step sign-in.</p>
        </div>
        <div className="actions"><button type="button" className="btn" onClick={() => setAdding(true)}><Icon name="userPlus" size={16} />Add a person</button></div>
      </div>
      {disabling && (
        <div className="notice red" role="alert">
          Turn off sign-in for {disabling.name}? They'll be signed out straight away and marked as left.
          <div className="actions" style={{ marginTop: 10 }}>
            <button type="button" className="btn danger" onClick={() => void setStatus(disabling, "left", `${disabling.name} can no longer sign in.`)}>Yes, turn off</button>
            <button type="button" className="btn quiet" onClick={() => setDisabling(null)}>Keep as it is</button>
          </div>
        </div>
      )}
      {resetting && (
        <div className="notice red" role="alert">
          Reset two-step sign-in for {resetting.name}? Their authenticator app and backup codes stop working and they're signed out everywhere.
          {resetting.isAdmin ? " As an administrator, they'll have to set it up again when they next sign in." : " They can sign in with just their password until they turn it on again."}
          <div className="actions" style={{ marginTop: 10 }}>
            <button type="button" className="btn danger" onClick={() => void resetMfa(resetting)}>Yes, reset</button>
            <button type="button" className="btn quiet" onClick={() => setResetting(null)}>Keep as it is</button>
          </div>
        </div>
      )}
      <div className="card">
        {q.isPending ? (
          <Empty icon="key">Loading people…</Empty>
        ) : q.isError ? (
          <Empty icon="key" title="Could not load people"><p>Refresh the page to try again.</p></Empty>
        ) : (
          <div className="table-wrap">
            <table className="stack">
              <thead><tr><th>Person</th><th>Position</th><th>Department</th><th>Manager</th><th>Two-step</th><th>Status</th><th /></tr></thead>
              <tbody>
                {all.map((p) => {
                  const self = p.id === user?.id;
                  const left = p.status === "left";
                  return (
                    <tr key={p.id} style={{ cursor: "default" }}>
                      <td>
                        <button type="button" className="rowbtn" onClick={() => setEditId(p.id)}>{p.name}</button>
                        <div className="t-meta">{p.email}</div>
                      </td>
                      <td data-l="Position">{positionLabel(p)}</td>
                      <td data-l="Department">{p.dept}</td>
                      <td data-l="Manager">{(p.managerId && byId.get(p.managerId)?.name) || <span className="muted">None</span>}</td>
                      <td data-l="Two-step">{p.mfaEnabled ? <Pill tone="done">On</Pill> : <Pill tone={p.isAdmin && !left ? "alert" : "muted"}>Off</Pill>}</td>
                      <td data-l="Status"><Pill tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Pill></td>
                      <td>
                        <div className="actions row-actions">
                          <button type="button" className="btn quiet sm" onClick={() => setEditId(p.id)}>Edit</button>
                          {!self && !left && <button type="button" className="btn quiet sm" disabled={busy === p.id} onClick={() => setPwFor(p)}>Set a new password</button>}
                          {!self && p.mfaEnabled && <button type="button" className="btn quiet sm" disabled={busy === p.id} onClick={() => setResetting(p)}>Reset two-step sign-in</button>}
                          {!self && !left && <button type="button" className="btn quiet sm" disabled={busy === p.id} onClick={() => setDisabling(p)}>Turn off</button>}
                          {left && <button type="button" className="btn quiet sm" disabled={busy === p.id} onClick={() => void setStatus(p, "active", `${p.name} can sign in again.`)}>Turn back on</button>}
                        </div>
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
      {pwFor && <SetPasswordDialog person={pwFor} onClose={() => setPwFor(null)} />}
    </>
  );
}
