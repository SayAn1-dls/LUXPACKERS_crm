import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DEPT_NAMES, ROLES } from "../../../shared/schema";
import type { RoleName } from "../../../shared/schema";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { errorText } from "../lib/errors";
import { KINDS, ROLE_LABEL, managerChoices, useRefreshPeople } from "../lib/people";
import type { PersonRow } from "../lib/people";
import { DrawerShell } from "./DrawerShell";
import { TempPassword } from "./TempPassword";
import { useToast } from "./Toast";

interface Draft { name: string; email: string; role: RoleName; dept: string; managerId: string; title: string; phone: string; kind: string; joinedOn: string; status: "onboarding" | "active" }
const EMPTY: Draft = { name: "", email: "", role: "employee", dept: "", managerId: "", title: "", phone: "", kind: "Full-time", joinedOn: "", status: "onboarding" };

/** Create an account. Only an administrator sees the role; HR always creates a team member. */
export function AddPersonDrawer({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const notify = useToast();
  const refresh = useRefreshPeople();
  const [d, setD] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ name: string; password: string } | null>(null);
  const peopleQ = useQuery({ queryKey: ["people"], queryFn: () => api<{ people: PersonRow[] }>("GET", "/people"), staleTime: 5 * 60_000 });
  const managers = managerChoices(peopleQ.data?.people ?? [], null);
  const isAdmin = user?.role === "admin";

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setD((x) => ({ ...x, [k]: v }));
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
  };

  async function save() {
    const errs: typeof errors = {};
    if (!d.name.trim()) errs.name = "Please fill this in.";
    if (!/^\S+@\S+\.\S+$/.test(d.email.trim())) errs.email = "Enter a full email address.";
    if (!d.dept) errs.dept = "Choose a department.";
    if (Object.keys(errs).length) {
      setErrors(errs);
      return notify("Please fix the highlighted fields.", true);
    }
    setBusy(true);
    try {
      const body = {
        name: d.name.trim(), email: d.email.trim(), role: isAdmin ? d.role : "employee", dept: d.dept,
        managerId: d.managerId || null, title: d.title.trim() || null, phone: d.phone.trim() || null,
        kind: d.kind, joinedOn: d.joinedOn || null, status: d.status,
      };
      const res = await api<{ tempPassword: string }>("POST", "/users", body);
      await refresh();
      setMade({ name: body.name, password: res.tempPassword });
    } catch (e) {
      if (e instanceof ApiError && e.code === "email_taken") setErrors({ email: "That email already has an account." });
      else if (e instanceof ApiError && e.code === "invalid_manager") setErrors({ managerId: "Choose a different manager." });
      notify(e instanceof ApiError && e.status === 400 && e.code === "invalid" ? "Please check the details and try again." : e instanceof ApiError && e.status === 409 ? "That email already has an account." : errorText(e), true);
    } finally {
      setBusy(false);
    }
  }

  const err = (k: keyof Draft) => errors[k] && <span className="err" id={`np_${k}_err`}>{errors[k]}</span>;
  const bad = (k: keyof Draft) => (errors[k] ? { "aria-invalid": true, "aria-describedby": `np_${k}_err` } : {});

  return (
    <DrawerShell
      eyebrow="People" title={made ? "Account created" : "Add a person"} titleId="npTitle" onClose={onClose}
      foot={
        made ? (
          <div className="actions" style={{ marginLeft: "auto" }}><button type="button" className="btn quiet" onClick={onClose}>Close</button></div>
        ) : (
          <>
            <span />
            <div className="actions">
              <button type="button" className="btn quiet" onClick={onClose}>Cancel</button>
              <button type="button" className="btn" disabled={busy} onClick={() => void save()}>Create account</button>
            </div>
          </>
        )
      }
    >
      {made ? (
        <TempPassword name={made.name} password={made.password} onDone={onClose} />
      ) : (
        <div className="form">
          <div className="field">
            <label className="flabel" htmlFor="np_name">Full name *</label>
            <input id="np_name" className="input" value={d.name} onChange={(e) => set("name", e.target.value)} autoFocus {...bad("name")} />
            {err("name")}
          </div>
          <div className="field">
            <label className="flabel" htmlFor="np_email">Email *</label>
            <input id="np_email" type="email" className="input" value={d.email} onChange={(e) => set("email", e.target.value)} {...bad("email")} />
            {err("email")}
          </div>
          {isAdmin && (
            <div className="field">
              <label className="flabel" htmlFor="np_role">Role</label>
              <select id="np_role" className="input" value={d.role} onChange={(e) => set("role", e.target.value as RoleName)}>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </div>
          )}
          <div className="field">
            <label className="flabel" htmlFor="np_dept">Department *</label>
            <select id="np_dept" className="input" value={d.dept} onChange={(e) => set("dept", e.target.value)} {...bad("dept")}>
              <option value="">Choose…</option>
              {DEPT_NAMES.map((n) => <option key={n}>{n}</option>)}
            </select>
            {err("dept")}
          </div>
          <div className="field">
            <label className="flabel" htmlFor="np_manager">Manager</label>
            <select id="np_manager" className="input" value={d.managerId} onChange={(e) => set("managerId", e.target.value)} {...bad("managerId")}>
              <option value="">No manager yet</option>
              {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            {err("managerId")}
          </div>
          <div className="field">
            <label className="flabel" htmlFor="np_title">Job title</label>
            <input id="np_title" className="input" value={d.title} onChange={(e) => set("title", e.target.value)} />
          </div>
          <div className="field">
            <label className="flabel" htmlFor="np_phone">Phone / WhatsApp</label>
            <input id="np_phone" className="input" value={d.phone} onChange={(e) => set("phone", e.target.value)} />
          </div>
          <div className="field">
            <label className="flabel" htmlFor="np_kind">Type</label>
            <select id="np_kind" className="input" value={d.kind} onChange={(e) => set("kind", e.target.value)}>
              {KINDS.map((k) => <option key={k}>{k}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="flabel" htmlFor="np_joined">Joining date</label>
            <input id="np_joined" type="date" className="input" value={d.joinedOn} onChange={(e) => set("joinedOn", e.target.value)} />
          </div>
          <div className="field">
            <label className="flabel" htmlFor="np_status">Starting as</label>
            <select id="np_status" className="input" value={d.status} onChange={(e) => set("status", e.target.value as Draft["status"])}>
              <option value="onboarding">New joiner (onboarding checklist)</option>
              <option value="active">Already working here</option>
            </select>
          </div>
          <p className="help wide" style={{ margin: 0 }}>A temporary password is made for them and shown once after you create the account.</p>
        </div>
      )}
    </DrawerShell>
  );
}
