import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth, type User } from "../auth";
import { AuthLayout } from "../components/AuthLayout";
import { useSetupNeeded } from "../lib/setupStatus";
import { useTitle } from "../lib/useTitle";

export function Login() {
  useTitle("Sign in");
  const { user, loading, setUser } = useAuth();
  const setup = useSetupNeeded();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (loading || setup.isPending) return <div className="empty" style={{ paddingTop: "30vh" }}>Opening the Luxpackers desk…</div>;
  if (setup.data?.needed) return <Navigate to="/setup" replace />;
  if (user) return <Navigate to={user.mustChangePassword ? "/change-password" : "/"} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError("Please enter your email and password.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await api<{ user: User }>("POST", "/auth/login", { email: email.trim(), password });
      setUser(res.user);
      navigate(res.user.mustChangePassword ? "/change-password" : from, { replace: true });
    } catch (ex) {
      setBusy(false);
      if (ex instanceof ApiError && ex.status === 429) setError("Too many tries. Wait 15 minutes and try again.");
      else if (ex instanceof ApiError && ex.status === 401) setError("That email and password don't match.");
      else setError(ex instanceof ApiError ? ex.message : "Something went wrong. Please try again.");
    }
  };

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
