import { useState } from "react";
import { DEPT_NAMES, ROLES } from "../../../shared/schema";
import type { RoleName } from "../../../shared/schema";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { errorText } from "../lib/errors";
import { KINDS, ROLE_LABEL, STATUS_LABEL, canChangeRole, canEditManaged, isStaff, managerChoices, useRefreshPeople } from "../lib/people";
import type { PersonRow } from "../lib/people";
import { fmtDay } from "../lib/tasks";
import { DrawerShell } from "./DrawerShell";
import { useToast } from "./Toast";

interface Draft { name: string; title: string; phone: string; kind: string; joinedOn: string; status: PersonRow["status"]; dept: string; managerId: string; role: RoleName }

const toDraft = (p: PersonRow): Draft => ({
  name: p.name, title: p.title ?? "", phone: p.phone ?? "", kind: p.kind ?? "", joinedOn: p.joinedOn ?? "",
  status: p.status, dept: p.dept, managerId: p.managerId ?? "", role: p.role,
});

/** One person's details. Admin and HR can edit; everyone else reads. */
export function PersonDrawer({ person, people, onClose }: { person: PersonRow; people: PersonRow[]; onClose: () => void }) {
  const { user } = useAuth();
  const notify = useToast();
  const refresh = useRefreshPeople();
  const [d, setD] = useState<Draft>(() => toDraft(person));
  const [busy, setBusy] = useState(false);
  const [nameErr, setNameErr] = useState("");
  if (!user) return null;

  const staff = isStaff(user);
  const managed = canEditManaged(user, person);
  const roleEditable = canChangeRole(user, person);
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
    if (d.title.trim() !== (person.title ?? "")) body.title = d.title.trim() || null;
    if (d.phone.trim() !== (person.phone ?? "")) body.phone = d.phone.trim() || null;
    if (d.kind !== (person.kind ?? "")) body.kind = d.kind || null;
    if (d.joinedOn !== (person.joinedOn ?? "")) body.joinedOn = d.joinedOn || null;
    if (managed && d.status !== person.status) body.status = d.status;
    if (managed && d.dept !== person.dept) body.dept = d.dept;
    if (managed && d.managerId !== (person.managerId ?? "")) body.managerId = d.managerId || null;
    if (roleEditable && d.role !== person.role) body.role = d.role;
    if (Object.keys(body).length === 0) return onClose();
    setBusy(true);
    try {
      await api("PATCH", `/users/${person.id}`, body);
      await refresh();
      notify("Saved.");
      onClose();
    } catch (e) {
      notify(e instanceof ApiError && e.code === "invalid_manager" ? "Choose a different manager." : errorText(e), true);
    } finally {
      setBusy(false);
    }
  }

  const row = (label: string, value: React.ReactNode) => (
    <div className="field"><span className="flabel">{label}</span><div className="readonly">{value || <span className="muted">Not set</span>}</div></div>
  );

  return (
    <DrawerShell
      eyebrow={`${ROLE_LABEL[person.role]} · ${person.dept}`} title={person.name} titleId="pdTitle" onClose={onClose}
      foot={
        <>
          <span />
          <div className="actions">
            <button type="button" className="btn quiet" onClick={onClose}>{dirty ? "Cancel" : "Close"}</button>
            {staff && dirty && <button type="button" className="btn" disabled={busy} onClick={() => void save()}>Save changes</button>}
          </div>
        </>
      }
    >
      <div className="form">
        {staff ? (
          <>
            <div className="field">
              <label className="flabel" htmlFor="pd_name">Full name</label>
              <input id="pd_name" className="input" value={d.name} onChange={(e) => { set("name", e.target.value); setNameErr(""); }} aria-invalid={!!nameErr} />
              {nameErr && <span className="err">{nameErr}</span>}
            </div>
            {row("Email", person.email)}
            <div className="field">
              <label className="flabel" htmlFor="pd_title">Job title</label>
              <input id="pd_title" className="input" value={d.title} onChange={(e) => set("title", e.target.value)} />
            </div>
            <div className="field">
              <label className="flabel" htmlFor="pd_phone">Phone / WhatsApp</label>
              <input id="pd_phone" className="input" value={d.phone} onChange={(e) => set("phone", e.target.value)} />
            </div>
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
            {managed ? (
              <>
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
              </>
            ) : (
              <>
                {row("Department", person.dept)}
                {row("Manager", managerName)}
                {row("Status", STATUS_LABEL[person.status])}
              </>
            )}
            {roleEditable ? (
              <div className="field">
                <label className="flabel" htmlFor="pd_role">Role</label>
                <select id="pd_role" className="input" value={d.role} onChange={(e) => set("role", e.target.value as RoleName)}>
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
              </div>
            ) : row("Role", ROLE_LABEL[person.role])}
          </>
        ) : (
          <>
            {row("Job title", person.title)}
            {row("Email", <a href={`mailto:${person.email}`}>{person.email}</a>)}
            {row("Phone / WhatsApp", person.phone)}
            {row("Department", person.dept)}
            {row("Manager", managerName)}
          </>
        )}
      </div>
      {staff && person.joinedOn && <p className="help">Joined {fmtDay(person.joinedOn)}.</p>}
    </DrawerShell>
  );
}
