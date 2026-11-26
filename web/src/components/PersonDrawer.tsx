import { useState } from "react";
import { DEPT_NAMES } from "../../../shared/schema";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { errorText } from "../lib/errors";
import { KINDS, STATUS_LABEL, managerChoices, positionLabel, useRefreshPeople } from "../lib/people";
import type { PersonRow } from "../lib/people";
import { canSeePeoplePrivate } from "../lib/perms";
import { usePositions } from "../lib/positions";
import { fmtDay } from "../lib/tasks";
import { DrawerShell } from "./DrawerShell";
import { useToast } from "./Toast";

interface Draft {
  name: string; email: string; positionId: string; title: string; phone: string; kind: string; joinedOn: string;
  status: PersonRow["status"]; dept: string; managerId: string;
}

const toDraft = (p: PersonRow): Draft => ({
  name: p.name, email: p.email, positionId: p.positionId ?? "", title: p.title ?? "", phone: p.phone ?? "", kind: p.kind ?? "",
  joinedOn: p.joinedOn ?? "", status: p.status, dept: p.dept, managerId: p.managerId ?? "",
});

const ERRORS: Record<string, string> = {
  invalid_manager: "Choose a different manager.",
  invalid_position: "Choose a position from the list.",
  email_taken: "Another person already uses that email.",
  last_admin: "Someone else must be an administrator first.",
};

/** One person's details. The administrator edits; everyone else reads. */
export function PersonDrawer({ person, people, onClose }: { person: PersonRow; people: PersonRow[]; onClose: () => void }) {
  const { user } = useAuth();
  const notify = useToast();
  const refresh = useRefreshPeople();
  const [d, setD] = useState<Draft>(() => toDraft(person));
  const [busy, setBusy] = useState(false);
  const [nameErr, setNameErr] = useState("");
  const editable = !!user?.isAdmin;
  const positionsQ = usePositions(editable);
  if (!user) return null;

  const priv = canSeePeoplePrivate(user);
  const self = person.id === user.id;
  const base = toDraft(person);
  const dirty = (Object.keys(d) as (keyof Draft)[]).some((k) => d[k] !== base[k]);
  const managers = managerChoices(people, person.id);
  const managerName = people.find((p) => p.id === person.managerId)?.name;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  async function save() {
    if (!d.name.trim()) return setNameErr("Please fill this in.");
    const body: Record<string, unknown> = {};
    if (d.name.trim() !== person.name) body.name = d.name.trim();
    if (d.email.trim() !== person.email) body.email = d.email.trim();
    if (d.title.trim() !== (person.title ?? "")) body.title = d.title.trim() || null;
    if (d.phone.trim() !== (person.phone ?? "")) body.phone = d.phone.trim() || null;
    if (d.kind !== (person.kind ?? "")) body.kind = d.kind || null;
    if (d.joinedOn !== (person.joinedOn ?? "")) body.joinedOn = d.joinedOn || null;
    if (d.status !== person.status) body.status = d.status;
    if (d.dept !== person.dept) body.dept = d.dept;
    if (d.managerId !== (person.managerId ?? "")) body.managerId = d.managerId || null;
    if (d.positionId && d.positionId !== (person.positionId ?? "")) body.positionId = d.positionId;
    if (Object.keys(body).length === 0) return onClose();
    setBusy(true);
    try {
      await api("PATCH", `/users/${person.id}`, body);
      await refresh();
      notify(body.status === "left" ? `${person.name} has left and can no longer sign in.` : "Saved.");
      onClose();
    } catch (e) {
      notify((e instanceof ApiError && ERRORS[e.code]) || errorText(e), true);
    } finally {
      setBusy(false);
    }
  }

  const row = (label: string, value: React.ReactNode) => (
    <div className="field"><span className="flabel">{label}</span><div className="readonly">{value || <span className="muted">Not set</span>}</div></div>
  );
  const input = (k: "name" | "email" | "title" | "phone", label: string, type = "text") => (
    <div className="field">
      <label className="flabel" htmlFor={`pd_${k}`}>{label}</label>
      <input id={`pd_${k}`} type={type} className="input" value={d[k]} onChange={(e) => { set(k, e.target.value); if (k === "name") setNameErr(""); }} aria-invalid={k === "name" && !!nameErr} />
      {k === "name" && nameErr && <span className="err">{nameErr}</span>}
    </div>
  );

  return (
    <DrawerShell
      eyebrow={`${positionLabel(person)} · ${person.dept}`} title={person.name} titleId="pdTitle" onClose={onClose}
      foot={
        <>
          <span />
          <div className="actions">
            <button type="button" className="btn quiet" onClick={onClose}>{dirty ? "Cancel" : "Close"}</button>
            {editable && dirty && <button type="button" className="btn" disabled={busy} onClick={() => void save()}>Save changes</button>}
          </div>
        </>
      }
    >
      {editable ? (
        <div className="form">
          {input("name", "Full name")}
          {input("email", "Work email", "email")}
          <div className="field">
            <label className="flabel" htmlFor="pd_pos">Position</label>
            {self ? (
              <div className="readonly">{positionLabel(person)} <span className="help">(you can't change your own)</span></div>
            ) : (
              <select id="pd_pos" className="input" value={d.positionId} onChange={(e) => set("positionId", e.target.value)}>
                {!d.positionId && <option value="">Choose…</option>}
                {!positionsQ.data && d.positionId && <option value={d.positionId}>{positionLabel(person)}</option>}
                {positionsQ.data?.positions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
          </div>
          <div className="field">
            <label className="flabel" htmlFor="pd_dept">Department</label>
            <select id="pd_dept" className="input" value={d.dept} onChange={(e) => set("dept", e.target.value)}>
              {!DEPT_NAMES.includes(d.dept) && <option>{d.dept}</option>}
              {DEPT_NAMES.map((n) => <option key={n}>{n}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="flabel" htmlFor="pd_manager">Manager</label>
            <select id="pd_manager" className="input" value={d.managerId} onChange={(e) => set("managerId", e.target.value)}>
              <option value="">No manager</option>
              {d.managerId && !managers.some((m) => m.id === d.managerId) && <option value={d.managerId}>{managerName ?? "Former team member"}</option>}
              {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="flabel" htmlFor="pd_status">Status</label>
            <select id="pd_status" className="input" value={d.status} onChange={(e) => set("status", e.target.value as PersonRow["status"])}>
              <option value="onboarding">{STATUS_LABEL.onboarding}</option>
              <option value="active">{STATUS_LABEL.active}</option>
              {!self && <option value="left">{STATUS_LABEL.left} (turns off their sign-in)</option>}
            </select>
          </div>
          {input("title", "Job title")}
          {input("phone", "Phone / WhatsApp")}
          <div className="field">
            <label className="flabel" htmlFor="pd_kind">Type</label>
            <select id="pd_kind" className="input" value={d.kind} onChange={(e) => set("kind", e.target.value)}>
              <option value="">Not set</option>
              {KINDS.map((k) => <option key={k}>{k}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="flabel" htmlFor="pd_joined">Joining date</label>
            <input id="pd_joined" type="date" className="input" value={d.joinedOn} onChange={(e) => set("joinedOn", e.target.value)} />
          </div>
        </div>
      ) : (
        <div className="form">
          {row("Job title", person.title)}
          {row("Position", positionLabel(person))}
          {row("Email", <a href={`mailto:${person.email}`}>{person.email}</a>)}
          {row("Phone / WhatsApp", person.phone)}
          {row("Department", person.dept)}
          {row("Manager", managerName)}
          {priv && row("Status", STATUS_LABEL[person.status])}
          {priv && row("Type", person.kind)}
          {priv && row("Joining date", person.joinedOn ? fmtDay(person.joinedOn) : null)}
        </div>
      )}
    </DrawerShell>
  );
}
