import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth, type User } from "../auth";
import { AuthLayout } from "../components/AuthLayout";
import { useSetupNeeded } from "../lib/setupStatus";
import { useTitle } from "../lib/useTitle";

/** Where a freshly signed-in person goes: password change and admin two-step setup come first. */
export function nextStop(user: User, from: string): string {
  if (user.mustChangePassword) return "/change-password";
  if (user.mfaRequired && !user.mfaEnabled) return "/account/two-step";
  return from;
}

type LoginResult = { user: User } | { mfaRequired: true; mfaToken: string };

export function Login() {
  useTitle("Sign in");
  const { user, loading, setUser } = useAuth();
  const setup = useSetupNeeded();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (loading || setup.isPending) return <div className="empty" style={{ paddingTop: "30vh" }}>Opening the Luxpackers desk…</div>;
  if (setup.data?.needed) return <Navigate to="/setup" replace />;
  if (user) return <Navigate to={nextStop(user, "/")} replace />;

  const signedIn = (u: User) => {
    setUser(u);
    navigate(nextStop(u, from), { replace: true });
  };

  const startOver = (message: string) => {
    setMfaToken(null);
    setCode("");
    setPassword("");
    setUseBackup(false);
    setError(message);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError("Please enter your email and password.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await api<LoginResult>("POST", "/auth/login", { email: email.trim(), password });
      if ("mfaRequired" in res) {
        setBusy(false);
        setMfaToken(res.mfaToken);
        return;
      }
      signedIn(res.user);
    } catch (ex) {
      setBusy(false);
      if (ex instanceof ApiError && ex.status === 429) setError("Too many tries. Wait 15 minutes and try again.");
      else if (ex instanceof ApiError && ex.status === 401) setError("That email and password don't match.");
      else setError(ex instanceof ApiError ? ex.message : "Something went wrong. Please try again.");
    }
  };

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim()) {
      setError(useBackup ? "Please enter one of your backup codes." : "Please enter the 6-digit code from your app.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await api<{ user: User }>("POST", "/auth/login/mfa", { mfaToken, code: code.trim() });
      signedIn(res.user);
    } catch (ex) {
      setBusy(false);
      setCode("");
      if (ex instanceof ApiError && ex.code === "bad_code") setError(useBackup ? "That backup code isn't right, or it has been used." : "That code isn't right. Wait for a new one and try again.");
      else if (ex instanceof ApiError && ex.code === "mfa_expired") startOver("That took too long or had too many wrong codes. Please sign in again.");
      else if (ex instanceof ApiError && ex.status === 429) startOver("Too many tries. Wait 15 minutes and try again.");
      else if (ex instanceof ApiError && ex.code === "mfa_not_configured") setError("Two-step sign-in isn't set up on the server. Ask your administrator.");
      else setError(ex instanceof ApiError ? ex.message : "Something went wrong. Please try again.");
    }
  };

  if (mfaToken) {
    return (
      <AuthLayout>
        <form className="login-card" onSubmit={submitCode} noValidate>
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
            <button type="button" className="btn link" onClick={() => startOver("")}>Start again</button>
          </p>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <form className="login-card" onSubmit={submit} noValidate>
        <h1>Sign in</h1>
        <p>Use your work email and password.</p>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input className="input" id="email" type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input className="input" id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="err" role="alert">{error}</div>
        <button className="btn block" type="submit" disabled={busy}>{busy ? "Checking…" : "Sign in"}</button>
        <p className="small muted" style={{ marginTop: 18 }}>Forgot your password? Ask your manager or HR to reset it.</p>
      </form>
    </AuthLayout>
  );
}
