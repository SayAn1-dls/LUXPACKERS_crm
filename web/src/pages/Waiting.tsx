import { useState } from "react";
import { useAuth } from "../auth";
import { AuthLayout } from "../components/AuthLayout";
import { useTitle } from "../lib/useTitle";

/** Signed in with Google, not let in yet. */
export function Waiting() {
  useTitle("Waiting for approval");
  const { user, refresh, signOut } = useAuth();
  const [checking, setChecking] = useState(false);
  const [still, setStill] = useState(false);

  const check = async () => {
    setChecking(true);
    const u = await refresh();
    setChecking(false);
    setStill(!!u && u.approval !== "approved");
  };

  return (
    <AuthLayout>
      <div className="login-card">
        <div className="waiting-mark" aria-hidden="true">…</div>
        <h1>Waiting for approval</h1>
        <p>The admin will let you in soon. We've told them you're here{user ? ` as ${user.email}` : ""}.</p>
        <button type="button" className="btn block" disabled={checking} onClick={() => void check()}>{checking ? "Checking…" : "Check again"}</button>
        <div className="small muted" role="status" style={{ minHeight: 22, marginTop: 10 }}>{still ? "Not yet. Try again in a little while." : ""}</div>
        <p style={{ marginTop: 6 }}><button type="button" className="btn link" onClick={() => void signOut()}>Sign out</button></p>
      </div>
    </AuthLayout>
  );
}
