import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DEPT_NAMES, EMPLOYEE_POSITION_ID } from "../../../shared/schema";
import { api, ApiError } from "../api";
import { errorText } from "../lib/errors";
import { managerChoices, useRefreshPeople } from "../lib/people";
import type { PersonRow } from "../lib/people";
import { usePositions } from "../lib/positions";
import { DrawerShell } from "./DrawerShell";
import { useToast } from "./Toast";

const ERRORS: Record<string, string> = {
  invalid_position: "Choose a position from the list.",
  invalid_manager: "Choose a different manager.",
  not_waiting: "Someone has already dealt with this request.",
};

/** Let someone in who asked with Google: their position (Admin included), department and manager. */
export function ApproveDrawer({ person, onClose }: { person: PersonRow; onClose: () => void }) {
  const notify = useToast();
  const refresh = useRefreshPeople();
  const positionsQ = usePositions(true);
  const peopleQ = useQuery({ queryKey: ["people"], queryFn: () => api<{ people: PersonRow[] }>("GET", "/people"), staleTime: 5 * 60_000 });
  const managers = managerChoices(peopleQ.data?.people ?? [], person.id);
  const [positionId, setPositionId] = useState(EMPLOYEE_POSITION_ID);
  const [dept, setDept] = useState("");
  const [managerId, setManagerId] = useState("");
  const [deptErr, setDeptErr] = useState("");
  const [busy, setBusy] = useState(false);
  const isAdminPick = positionsQ.data?.positions.find((p) => p.id === positionId)?.isAdmin;

  async function approve() {
    if (!dept) return setDeptErr("Choose a department.");
    setBusy(true);
    try {
      await api("POST", `/users/${person.id}/approve`, { positionId, dept, managerId: managerId || null });
      await refresh();
      notify(`${person.name} is in. They've been told.`);
      onClose();
    } catch (e) {
      notify((e instanceof ApiError && ERRORS[e.code]) || errorText(e), true);
      if (e instanceof ApiError && e.code === "not_waiting") { await refresh(); onClose(); }
    } finally {
      setBusy(false);
    }
  }

  return (
    <DrawerShell
      eyebrow="Waiting" title={`Let ${person.name} in`} titleId="apTitle" onClose={onClose}
      foot={
        <>
          <span />
          <div className="actions">
            <button type="button" className="btn quiet" onClick={onClose}>Cancel</button>
            <button type="button" className="btn" disabled={busy} onClick={() => void approve()}>Approve</button>
          </div>
        </>
      }
    >
      <div className="form">
        <p className="help wide" style={{ marginTop: 0 }}>{person.email} · signed in with Google</p>
        <div className="field">
          <label className="flabel" htmlFor="ap_pos">Position *</label>
          <select id="ap_pos" className="input" value={positionId} onChange={(e) => setPositionId(e.target.value)}>
            {!positionsQ.data && <option value={EMPLOYEE_POSITION_ID}>Employee</option>}
            {positionsQ.data?.positions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="flabel" htmlFor="ap_dept">Department *</label>
          <select
            id="ap_dept" className="input" value={dept} onChange={(e) => { setDept(e.target.value); setDeptErr(""); }}
            aria-invalid={!!deptErr} aria-describedby={deptErr ? "ap_dept_err" : undefined}
          >
            <option value="">Choose…</option>
            {DEPT_NAMES.map((n) => <option key={n}>{n}</option>)}
          </select>
          {deptErr && <span className="err" id="ap_dept_err">{deptErr}</span>}
        </div>
        <div className="field wide">
          <label className="flabel" htmlFor="ap_manager">Manager</label>
          <select id="ap_manager" className="input" value={managerId} onChange={(e) => setManagerId(e.target.value)}>
            <option value="">No manager yet</option>
            {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        {isAdminPick && <p className="notice wide">Administrators can do everything, and must turn on two-step sign-in before they start.</p>}
      </div>
    </DrawerShell>
  );
}
