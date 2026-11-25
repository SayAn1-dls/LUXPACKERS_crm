import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { AuthLayout } from "../components/AuthLayout";
import { useToast } from "../components/Toast";
import { useTitle } from "../lib/useTitle";

const SAME_PASSWORD = "Choose a new password — it can't be the same as the temporary one.";

export function ChangePassword() {
  useTitle("Change password");
  const { user, refresh, signOut } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const forced = !!user?.mustChangePassword;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!current) return setError("Please enter your current password.");
    if (next.length < 10) return setError("Choose a new password of at least 10 characters.");
    if (next !== again) return setError("The two new passwords don't match.");
    if (next === current) return setError(SAME_PASSWORD);
    setBusy(true);
    setError("");
    try {
      await api("POST", "/auth/password", { current, next });
      await refresh();
      toast("Password changed.");
      navigate("/", { replace: true });
    } catch (ex) {
      setBusy(false);
      if (ex instanceof ApiError && ex.code === "wrong_current_password") setError("Your current password isn't right.");
      else if (ex instanceof ApiError && ex.code === "same_password") setError(SAME_PASSWORD);
      else setError(ex instanceof ApiError ? ex.message : "Something went wrong. Please try again.");
    }
  };

  return (
    <AuthLayout>
      <form className="login-card" onSubmit={submit} noValidate>
        <h1>Choose a new password</h1>
        <p>{forced ? "You need to choose your own password before you carry on." : "Pick a password only you know."}</p>
        <div className="field">
          <label htmlFor="current">Current password</label>
          <input className="input" id="current" type="password" autoComplete="current-password" autoFocus value={current} onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="next">New password</label>
          <input className="input" id="next" type="password" autoComplete="new-password" aria-describedby="pw-help" value={next} onChange={(e) => setNext(e.target.value)} />
          <span className="help" id="pw-help">At least 10 characters.</span>
        </div>
        <div className="field">
          <label htmlFor="again">New password again</label>
          <input className="input" id="again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
        </div>
        <div className="err" role="alert">{error}</div>
        <button className="btn block" type="submit" disabled={busy}>{busy ? "Saving…" : "Save password"}</button>
        <p style={{ marginTop: 14 }}>
          {forced ? (
            <button type="button" className="btn link" onClick={() => void signOut()}>Sign out</button>
          ) : (
            <Link className="small muted" to="/">Cancel</Link>
          )}
        </p>
      </form>
    </AuthLayout>
  );
}
