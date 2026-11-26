import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import { useAuth, type User } from "../auth";
import { AuthLayout } from "../components/AuthLayout";
import { useSetupNeeded } from "../lib/setupStatus";
import { useTitle } from "../lib/useTitle";

export function Setup() {
  useTitle("Set up");
  const { setUser } = useAuth();
  const setup = useSetupNeeded();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (setup.isPending) return <div className="empty" style={{ paddingTop: "30vh" }}>Opening the Luxpackers desk…</div>;
  if (setup.data && !setup.data.needed) return <Navigate to="/login" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return setError("Please enter your name and email.");
    if (password.length < 10) return setError("Choose a password of at least 10 characters.");
    if (password !== again) return setError("The two passwords don't match.");
    setBusy(true);
    setError("");
    try {
      const res = await api<{ user: User }>("POST", "/setup", { name: name.trim(), email: email.trim(), password });
      qc.setQueryData(["setup"], { needed: false });
      setUser(res.user);
      navigate("/", { replace: true });
    } catch (ex) {
      setBusy(false);
      if (ex instanceof ApiError && ex.code === "already_set_up") navigate("/login", { replace: true });
      else if (ex instanceof ApiError && ex.code === "invalid") setError("Please check the name, a valid email, and a password of at least 10 characters.");
      else setError(ex instanceof ApiError ? ex.message : "Something went wrong. Please try again.");
    }
  };

  return (
    <AuthLayout>
      <form className="login-card" onSubmit={submit} noValidate>
        <h1>Welcome</h1>
        <p>Create the first administrator account. You will use it to add everyone else.</p>
        <div className="field">
          <label htmlFor="name">Your name</label>
          <input className="input" id="name" autoComplete="name" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="email">Work email</label>
          <input className="input" id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input className="input" id="password" type="password" autoComplete="new-password" aria-describedby="pw-help" value={password} onChange={(e) => setPassword(e.target.value)} />
          <span className="help" id="pw-help">At least 10 characters. Keep it somewhere safe.</span>
        </div>
        <div className="field">
          <label htmlFor="again">Password again</label>
          <input className="input" id="again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
        </div>
        <div className="err" role="alert">{error}</div>
        <button className="btn block" type="submit" disabled={busy}>{busy ? "Setting up…" : "Create account"}</button>
      </form>
    </AuthLayout>
  );
}
