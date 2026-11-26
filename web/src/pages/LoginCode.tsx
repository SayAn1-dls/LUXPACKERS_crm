import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth, type User } from "../auth";
import { AuthLayout } from "../components/AuthLayout";
import { useTitle } from "../lib/useTitle";
import { nextStop } from "./Login";

/** After Google, for people with two-step sign-in on: the code from their app (or a backup code). */
export function LoginCode() {
  useTitle("One more step");
  const { user, loading, setUser } = useAuth();
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);

  if (loading) return <div className="empty" style={{ paddingTop: "30vh" }}>Opening the Luxpackers desk…</div>;
  if (user) return <Navigate to={nextStop(user, "/")} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return setError(useBackup ? "Please enter one of your backup codes." : "Please enter the 6-digit code from your app.");
    setBusy(true);
    setError("");
    try {
      const res = await api<{ user: User }>("POST", "/auth/login/mfa", { code: code.trim() });
      setUser(res.user);
      navigate(nextStop(res.user, "/"), { replace: true });
    } catch (ex) {
      setBusy(false);
      setCode("");
      if (ex instanceof ApiError && ex.code === "bad_code") setError(useBackup ? "That backup code isn't right, or it has been used." : "That code isn't right. Wait for a new one and try again.");
      else if (ex instanceof ApiError && ex.code === "mfa_expired") setExpired(true);
      else if (ex instanceof ApiError && ex.status === 429) setError("Too many tries. Wait 15 minutes and try again.");
      else if (ex instanceof ApiError && ex.code === "mfa_not_configured") setError("Two-step sign-in isn't set up on the server. Ask your administrator.");
      else setError("Something went wrong. Please try again.");
    }
  };

  if (expired) {
    return (
      <AuthLayout>
        <div className="login-card">
          <h1>Start again</h1>
          <p>That took too long or had too many wrong codes. Sign in with Google again.</p>
          <Link className="btn block" to="/login">Back to sign in</Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <form className="login-card" onSubmit={submit} noValidate>
        <h1>One more step</h1>
        <p>{useBackup ? "Type one of the backup codes you saved. Each one works only once." : "Open your authenticator app and type the 6-digit code for Luxpackers."}</p>
        <div className="field">
          <label htmlFor="code">{useBackup ? "Backup code" : "6-digit code"}</label>
          <input
            className="input code-input" id="code" autoFocus autoComplete="one-time-code" spellCheck={false}
            inputMode={useBackup ? "text" : "numeric"} maxLength={useBackup ? 12 : 7}
            value={code} onChange={(e) => setCode(e.target.value)}
          />
        </div>
        <div className="err" role="alert">{error}</div>
        <button className="btn block" type="submit" disabled={busy}>{busy ? "Checking…" : "Sign in"}</button>
        <p className="small" style={{ marginTop: 18, display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button type="button" className="btn link" onClick={() => { setUseBackup((b) => !b); setCode(""); setError(""); }}>
            {useBackup ? "Use the app code instead" : "Use a backup code instead"}
          </button>
          <Link className="btn link" to="/login">Start again</Link>
        </p>
      </form>
    </AuthLayout>
  );
}
