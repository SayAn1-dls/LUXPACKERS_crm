import { useState } from "react";
import { api } from "../api";
import { errorText } from "../lib/errors";
import { MIN_PASSWORD } from "../lib/people";
import type { PersonRow } from "../lib/people";
import { DrawerShell } from "./DrawerShell";
import { PasswordInput } from "./PasswordInput";
import { TempPassword } from "./TempPassword";
import { useToast } from "./Toast";

/** Admin sets a new password for someone. It signs them out everywhere. */
export function SetPasswordDialog({ person, onClose }: { person: PersonRow; onClose: () => void }) {
  const notify = useToast();
  const [pw, setPw] = useState("");
  const [mustChange, setMustChange] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function save() {
    if (pw.length < MIN_PASSWORD) return setErr(`Use at least ${MIN_PASSWORD} characters, or press Generate.`);
    setBusy(true);
    try {
      await api("POST", `/users/${person.id}/password`, { password: pw, mustChange });
      notify(`New password set. ${person.name} has been signed out everywhere.`);
      setDone(true);
    } catch (e) {
      notify(errorText(e), true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <DrawerShell
      eyebrow="People & logins" title="Set a new password" titleId="spTitle" onClose={onClose}
      foot={
        done ? (
          <div className="actions" style={{ marginLeft: "auto" }}><button type="button" className="btn quiet" onClick={onClose}>Close</button></div>
        ) : (
          <>
            <span />
            <div className="actions">
              <button type="button" className="btn quiet" onClick={onClose}>Cancel</button>
              <button type="button" className="btn" disabled={busy} onClick={() => void save()}>Set password</button>
            </div>
          </>
        )
      }
    >
      {done ? (
        <TempPassword name={person.name} password={pw} mustChange={mustChange} onDone={onClose} />
      ) : (
        <div className="form">
          <p className="notice wide">This signs <b>{person.name}</b> out on every phone and computer. They'll sign in again with the new password.</p>
          <PasswordInput id="sp_pw" label="New password" value={pw} error={err} onChange={(v) => { setPw(v); setErr(""); }} />
          <label className="check wide">
            <input type="checkbox" checked={mustChange} onChange={(e) => setMustChange(e.target.checked)} />
            Ask them to choose their own password at next sign-in
          </label>
        </div>
      )}
    </DrawerShell>
  );
}
