import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { AddPersonDrawer } from "../components/AddPersonDrawer";
import { ApproveDrawer } from "../components/ApproveDrawer";
import { Empty, Icon } from "../components/Icon";
import { PersonDrawer } from "../components/PersonDrawer";
import { Pill } from "../components/Pill";
import { Placeholder } from "../components/Placeholder";
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
          <p>Add someone new. They start as an Employee and sign in with Google using the work email you enter.</p>
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
  const [approving, setApproving] = useState<PersonRow | null>(null);
  const [declining, setDeclining] = useState<PersonRow | null>(null);
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "waiting" ? "waiting" : "everyone";
  const [disabling, setDisabling] = useState<PersonRow | null>(null);
  const [resetting, setResetting] = useState<PersonRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["users"], queryFn: () => api<{ users: PersonRow[] }>("GET", "/users") });
  const everyone = q.data?.users ?? [];
  const all = everyone.filter((p) => (p.approval ?? "approved") === "approved");
  const waiting = everyone.filter((p) => p.approval === "pending").sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
  const declined = everyone.filter((p) => p.approval === "declined");
  const byId = new Map(all.map((p) => [p.id, p]));
  const setTab = (t: "everyone" | "waiting") =>
    setParams((p) => { const n = new URLSearchParams(p); if (t === "waiting") n.set("tab", "waiting"); else n.delete("tab"); return n; }, { replace: true });

  async function decide(p: PersonRow, action: "decline" | "undecline", done: string) {
    setBusy(p.id);
    setDeclining(null);
    try {
      await api("POST", `/users/${p.id}/${action}`);
      notify(done);
    } catch (e) {
      notify(e instanceof ApiError && (e.code === "not_waiting" || e.code === "not_declined") ? "Someone has already dealt with this request." : errorText(e), true);
    } finally {
      await refresh();
      setBusy(null);
    }
  }
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
          <p>Let in people who asked to join, add people ahead of time, and choose their position.</p>
          <p className="small">Everyone signs in with Google. Someone you add here goes straight in when they sign in with that email. Administrators must use two-step sign-in.</p>
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
      {declining && (
        <div className="notice red" role="alert">
          Turn away {declining.name} ({declining.email})? They'll be signed out and see "Your request wasn't approved" if they try again. You can undo this later.
          <div className="actions" style={{ marginTop: 10 }}>
            <button type="button" className="btn danger" onClick={() => void decide(declining, "decline", `${declining.name} was turned away.`)}>Yes, decline</button>
            <button type="button" className="btn quiet" onClick={() => setDeclining(null)}>Keep waiting</button>
          </div>
        </div>
      )}
      {resetting && (
        <div className="notice red" role="alert">
          Reset two-step sign-in for {resetting.name}? Their authenticator app and backup codes stop working and they're signed out everywhere.
          {resetting.isAdmin ? " As an administrator, they'll have to set it up again when they next sign in." : " They can sign in with just Google until they turn it on again."}
          <div className="actions" style={{ marginTop: 10 }}>
            <button type="button" className="btn danger" onClick={() => void resetMfa(resetting)}>Yes, reset</button>
            <button type="button" className="btn quiet" onClick={() => setResetting(null)}>Keep as it is</button>
          </div>
        </div>
      )}
      <div className="card">
        <div className="chips" role="tablist" aria-label="Which people">
          <button type="button" role="tab" className="chip" aria-selected={tab === "everyone"} aria-pressed={tab === "everyone"} onClick={() => setTab("everyone")}>
            Everyone<b>{all.length}</b>
          </button>
          <button type="button" role="tab" className="chip" aria-selected={tab === "waiting"} aria-pressed={tab === "waiting"} onClick={() => setTab("waiting")}>
            Waiting<b>{waiting.length}</b>
          </button>
        </div>
        {tab === "waiting" && !q.isPending && !q.isError ? (
          <WaitingList waiting={waiting} declined={declined} busy={busy} onApprove={setApproving} onDecline={setDeclining} onUndo={(p) => void decide(p, "undecline", `${p.name} is back in Waiting.`)} />
        ) : q.isPending ? (
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
        {tab === "everyone" && !q.isPending && !q.isError && <div className="list-foot"><span>{all.length} {all.length === 1 ? "account" : "accounts"}</span></div>}
      </div>
      {adding && <AddPersonDrawer onClose={() => setAdding(false)} />}
      {edit && <PersonDrawer key={edit.id} person={edit} people={all} onClose={() => setEditId(null)} />}
      {approving && <ApproveDrawer key={approving.id} person={approving} onClose={() => setApproving(null)} />}
    </>
  );
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

function asked(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/** People who signed in with Google and are not let in yet, then those turned away (who can be brought back). */
function WaitingList({ waiting, declined, busy, onApprove, onDecline, onUndo }: {
  waiting: PersonRow[]; declined: PersonRow[]; busy: string | null;
  onApprove: (p: PersonRow) => void; onDecline: (p: PersonRow) => void; onUndo: (p: PersonRow) => void;
}) {
  if (waiting.length === 0 && declined.length === 0) {
    return <Empty icon="inbox" title="Nobody is waiting"><p>When someone new signs in with Google, they'll show up here for you to let in.</p></Empty>;
  }
  const row = (p: PersonRow, actions: React.ReactNode, state: React.ReactNode) => (
    <tr key={p.id} style={{ cursor: "default" }}>
      <td>
        <div className="who">
          <span className="avatar" aria-hidden="true">{initials(p.name)}</span>
          <div><b>{p.name}</b><div className="t-meta">{p.email}</div></div>
        </div>
      </td>
      <td data-l="Asked" style={{ whiteSpace: "nowrap" }}>{asked(p.createdAt)}</td>
      <td data-l="Status">{state}</td>
      <td><div className="actions row-actions">{actions}</div></td>
    </tr>
  );
  return (
    <div className="table-wrap">
      <table className="stack">
        <thead><tr><th>Person</th><th>Asked</th><th>Status</th><th /></tr></thead>
        <tbody>
          {waiting.map((p) => row(p, (
            <>
              <button type="button" className="btn sm" disabled={busy === p.id} onClick={() => onApprove(p)}>Approve</button>
              <button type="button" className="btn quiet sm" disabled={busy === p.id} onClick={() => onDecline(p)}>Decline</button>
            </>
          ), <Pill tone="wait">Waiting</Pill>))}
          {declined.map((p) => row(p, (
            <button type="button" className="btn quiet sm" disabled={busy === p.id} onClick={() => onUndo(p)}>Undo decline</button>
          ), <Pill tone="muted">Declined</Pill>))}
        </tbody>
      </table>
    </div>
  );
}
