import { useState } from "react";
import { LEAVE_LEVELS, PEOPLE_LEVELS, REGISTERS, REGISTER_LEVELS, TASK_LEVELS } from "../../../shared/schema";
import type { Perms, RegisterLevel } from "../../../shared/schema";
import { api, ApiError } from "../api";
import { errorText } from "../lib/errors";
import { useRefreshPeople } from "../lib/people";
import { LEAVE_WORDS, PEOPLE_WORDS, REGISTER_WORDS, TASK_WORDS, blankPerms } from "../lib/positions";
import type { Position } from "../lib/positions";
import { DrawerShell } from "./DrawerShell";
import { Icon } from "./Icon";
import { useToast } from "./Toast";

type Words<T extends string> = Record<T, { label: string; hint: string }>;

/** One question with a few pill-shaped choices and a plain-English line about the current one. */
function Choice<T extends string>({ name, legend, value, levels, words, onChange }: { name: string; legend: string; value: T; levels: readonly T[]; words: Words<T>; onChange: (v: T) => void }) {
  return (
    <fieldset className="choice">
      <legend className="flabel">{legend}</legend>
      <div className="seg">
        {levels.map((l) => (
          <label key={l}>
            <input type="radio" name={name} value={l} checked={value === l} onChange={() => onChange(l)} />
            <span>{words[l].label}</span>
          </label>
        ))}
      </div>
      <p className="help">{words[value].hint}</p>
    </fieldset>
  );
}

/** Create or edit a position. The Admin position's permissions are fixed; only its name changes. */
export function PositionDrawer({ position, onClose }: { position: Position | null; onClose: () => void }) {
  const notify = useToast();
  const refresh = useRefreshPeople();
  const [name, setName] = useState(position?.name ?? "");
  const [perms, setPerms] = useState<Perms>(() => (position ? structuredClone(position.perms) : blankPerms()));
  const [nameErr, setNameErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const locked = !!position?.isAdmin;
  const set = <K extends keyof Perms>(k: K, v: Perms[K]) => setPerms((p) => ({ ...p, [k]: v }));
  const setReg = (id: string, v: RegisterLevel) => setPerms((p) => ({ ...p, registers: { ...p.registers, [id]: v } }));

  async function save() {
    if (!name.trim()) return setNameErr("Give the position a name, for example “Finance Head”.");
    setBusy(true);
    try {
      const body = locked ? { name: name.trim() } : { name: name.trim(), perms };
      if (position) await api("PATCH", `/positions/${position.id}`, body);
      else await api("POST", "/positions", body);
      await refresh();
      notify(position ? "Position saved. People in it see the change straight away." : "Position created.");
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === "name_taken") setNameErr("There is already a position with this name.");
      notify(e instanceof ApiError && e.code === "name_taken" ? "Choose a different name." : errorText(e), true);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!position) return;
    setBusy(true);
    try {
      await api("DELETE", `/positions/${position.id}`);
      await refresh();
      notify("Position deleted.");
      onClose();
    } catch (e) {
      notify(e instanceof ApiError && e.code === "in_use" ? "Move the people in this position first." : errorText(e), true);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  const canDelete = !!position && !position.builtIn;
  const inUse = (position?.memberCount ?? 0) > 0;
  const foot = (
    <>
      <div className="actions">
        {canDelete && !confirming && (
          <button type="button" className="btn quiet" disabled={busy} onClick={() => (inUse ? notify("Move the people in this position first.", true) : setConfirming(true))}>Delete</button>
        )}
        {confirming && (
          <>
            <span className="small">Delete “{position!.name}”?</span>
            <button type="button" className="btn danger" disabled={busy} onClick={() => void remove()}>Yes, delete</button>
            <button type="button" className="btn quiet" onClick={() => setConfirming(false)}>Keep it</button>
          </>
        )}
      </div>
      <div className="actions">
        <button type="button" className="btn quiet" onClick={onClose}>Cancel</button>
        <button type="button" className="btn" disabled={busy} onClick={() => void save()}>{position ? "Save position" : "Create position"}</button>
      </div>
    </>
  );

  return (
    <DrawerShell eyebrow={position ? "Edit position" : "New position"} title={position?.name || "New position"} titleId="posTitle" onClose={onClose} foot={foot} wide>
      {position?.builtIn && (
        <p className="notice soft"><Icon name="lock" size={16} /> <b>Built in.</b>{" "}
          {locked ? "The Admin position can open everything. You can rename it, but its permissions are fixed." : "Everyone added by HR starts here. You can change what it opens, but it can't be deleted."}
        </p>
      )}
      <div className="field">
        <label className="flabel" htmlFor="pos_name">Position name</label>
        <input id="pos_name" className="input" value={name} maxLength={80} autoFocus placeholder="For example: Finance Head"
          onChange={(e) => { setName(e.target.value); setNameErr(""); }} aria-invalid={!!nameErr} aria-describedby={nameErr ? "pos_name_err" : undefined} />
        {nameErr && <span className="err" id="pos_name_err">{nameErr}</span>}
      </div>

      <fieldset className="plain" disabled={locked}>
        <h3 className="group-title"><Icon name="tasks" size={16} /> Work</h3>
        <Choice name="tasks" legend="Tasks" value={perms.tasks} levels={TASK_LEVELS} words={TASK_WORDS} onChange={(v) => set("tasks", v)} />
        <Choice name="leave" legend="Leave approvals" value={perms.leave} levels={LEAVE_LEVELS} words={LEAVE_WORDS} onChange={(v) => set("leave", v)} />

        <h3 className="group-title"><Icon name="people" size={16} /> People</h3>
        <Choice name="people" legend="People details" value={perms.people} levels={PEOPLE_LEVELS} words={PEOPLE_WORDS} onChange={(v) => set("people", v)} />
        <label className="toggle">
          <input type="checkbox" checked={perms.addPeople} onChange={(e) => set("addPeople", e.target.checked)} />
          <span className="toggle-ui" aria-hidden="true" />
          <span><b>Can add new people</b><span className="help">They can create accounts for new employees. They can't choose positions or passwords.</span></span>
        </label>

        <h3 className="group-title"><Icon name="folder" size={16} /> Registers</h3>
        <p className="help" style={{ marginTop: -4 }}>Hidden: not in their menu · View: can look, can't change · Edit: can add and change · Edit + delete: can also move to Trash.</p>
        <div className="reg-grid" role="group" aria-label="Register access">
          {REGISTERS.map((r) => (
            <fieldset key={r.id} className="reg-row">
              <legend>{r.name}</legend>
              <div className="seg">
                {REGISTER_LEVELS.map((l) => (
                  <label key={l}>
                    <input type="radio" name={`reg_${r.id}`} value={l} checked={(perms.registers[r.id] ?? "none") === l} onChange={() => setReg(r.id, l)} />
                    <span>{REGISTER_WORDS[l].label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      </fieldset>
    </DrawerShell>
  );
}
