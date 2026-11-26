import { Navigate } from "react-router-dom";
import { AuthLayout } from "../components/AuthLayout";
import { GoogleButton, useGoogleConfigured } from "../components/GoogleButton";
import { useSetupNeeded } from "../lib/setupStatus";
import { useTitle } from "../lib/useTitle";

/** First-ever visit: whoever finishes Google sign-in first becomes the administrator. */
export function Setup() {
  useTitle("Set up");
  const setup = useSetupNeeded();
  const configured = useGoogleConfigured();

  if (setup.isPending) return <div className="empty" style={{ paddingTop: "30vh" }}>Opening the Luxpackers desk…</div>;
  if (setup.data && !setup.data.needed) return <Navigate to="/login" replace />;
  const off = configured.data?.configured === false;

  return (
    <AuthLayout>
      <div className="login-card">
        <h1>Welcome</h1>
        <p>Continue with Google to create the admin account. You'll use it to let everyone else in.</p>
        {off && <div className="notice red" role="alert">Google sign-in isn't set up on the server yet. Add the Google client ID and secret first (see the README).</div>}
        <GoogleButton disabled={off} />
        <p className="small muted">The first Google account to sign in becomes the administrator.</p>
      </div>
    </AuthLayout>
  );
}
