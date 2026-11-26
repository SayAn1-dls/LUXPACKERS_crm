import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { BackupCodes } from "../components/BackupCodes";
import { Icon } from "../components/Icon";
import { Pill } from "../components/Pill";
import { useToast } from "../components/Toast";
import { useTitle } from "../lib/useTitle";

interface MfaStatus { enabled: boolean; required: boolean; enabledAt: string | null; backupCodesLeft: number }

const codeError = (ex: unknown): string => {
  if (ex instanceof ApiError) {
    if (ex.code === "bad_code") return "That code isn't right. Wait for a new one and try again.";
    if (ex.code === "wrong_password") return "Your password isn't right.";
    if (ex.code === "locked") return "Too many tries. Wait 15 minutes and try again.";
    if (ex.code === "mfa_not_configured") return "Two-step sign-in isn't set up on the server. Ask your administrator.";
  }
  return "Something went wrong. Please try again.";
};

/** My account: password and two-step sign-in. */
export function Account() {
  useTitle("My account");
  const { user, refresh } = useAuth();
  const qc = useQueryClient();
  const notify = useToast();
  const q = useQuery({ queryKey: ["mfa"], queryFn: () => api<MfaStatus>("GET", "/auth/mfa") });
  const [mode, setMode] = useState<"none" | "codes" | "off">("none");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  if (!user) return null;
  const s = q.data;

  const reset = (m: typeof mode) => {
    setMode(m);
    setCode("");
    setPassword("");
    setError("");
  };

  const regenerate = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await api<{ backupCodes: string[] }>("POST", "/auth/mfa/backup-codes", { code: code.trim() });
      reset("none");
      setNewCodes(res.backupCodes);
    } catch (ex) {
      setCode("");
      setError(codeError(ex));
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: ["mfa"] });
    }
  };

  const turnOff = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("POST", "/auth/mfa/disable", { password, code: code.trim() });
      reset("none");
      notify("Two-step sign-in is off.");
      await refresh();
    } catch (ex) {
      setCode("");
      setError(codeError(ex));
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: ["mfa"] });
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Account</div>
          <h1>My account</h1>
          <p>{user.name} · {user.email}</p>
        </div>
      </div>

      <div className="account-grid">
        <section className="card card-pad">
          <h2>Password</h2>
          <p className="muted">Choose a password only you know. Changing it signs you out on your other devices.</p>
          <Link className="btn quiet" to="/change-password"><Icon name="key" size={16} />Change password</Link>
        </section>

        <section className="card card-pad" aria-busy={q.isPending}>
          <h2 style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            Two-step sign-in
            {s && <Pill tone={s.enabled ? "done" : "muted"}>{s.enabled ? "On" : "Off"}</Pill>}
          </h2>
          {q.isPending ? (
            <p className="muted">Loading…</p>
          ) : q.isError || !s ? (
            <p className="muted">Could not load this. Refresh the page to try again.</p>
          ) : newCodes ? (
            <BackupCodes codes={newCodes} email={user.email} onDone={() => setNewCodes(null)} />
          ) : !s.enabled ? (
            <>
              <p className="muted">After your password, also type a 6-digit code from an authenticator app on your phone, such as Google Authenticator. Someone who learns your password still can't get in.</p>
              {s.required && <p className="notice red">Administrators must have this on.</p>}
              <Link className="btn" to="/account/two-step"><Icon name="lock" size={16} />Turn on two-step sign-in</Link>
            </>
          ) : (
            <>
              <p className="muted">
                On since {s.enabledAt ? new Date(s.enabledAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "—"}.{" "}
                {s.backupCodesLeft} of 8 backup codes left.
              </p>
              {s.backupCodesLeft <= 2 && <p className="notice">You're running low on backup codes. Make a new set.</p>}
              {s.required && <p className="small muted">Administrators can't turn this off. If you lose your phone, use a backup code, or ask another administrator to reset it.</p>}

              {mode === "none" && (
                <div className="actions">
                  <button type="button" className="btn quiet" onClick={() => reset("codes")}>Make new backup codes</button>
                  {!s.required && <button type="button" className="btn quiet" onClick={() => reset("off")}>Turn off</button>}
                </div>
              )}

              {mode === "codes" && (
                <form onSubmit={regenerate} noValidate className="inline-form">
                  <p className="small">Your old backup codes will stop working.</p>
                  <div className="field">
                    <label htmlFor="acc_code">6-digit code from your app</label>
                    <input className="input code-input" id="acc_code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
                  </div>
                  <div className="err" role="alert">{error}</div>
                  <div className="actions">
                    <button className="btn" type="submit" disabled={busy || !code.trim()}>Make new codes</button>
                    <button className="btn quiet" type="button" onClick={() => reset("none")}>Cancel</button>
                  </div>
                </form>
              )}

              {mode === "off" && (
                <form onSubmit={turnOff} noValidate className="inline-form">
                  <p className="small">You'll sign in with just your password again.</p>
                  <div className="field">
                    <label htmlFor="acc_pw">Your password</label>
                    <input className="input" id="acc_pw" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="acc_code2">6-digit code (or a backup code)</label>
                    <input className="input code-input" id="acc_code2" autoComplete="one-time-code" maxLength={12} value={code} onChange={(e) => setCode(e.target.value)} />
                  </div>
                  <div className="err" role="alert">{error}</div>
                  <div className="actions">
                    <button className="btn danger" type="submit" disabled={busy || !code.trim() || !password}>Turn off</button>
                    <button className="btn quiet" type="button" onClick={() => reset("none")}>Cancel</button>
                  </div>
                </form>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}
