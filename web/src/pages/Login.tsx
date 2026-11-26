import { Navigate, useSearchParams } from "react-router-dom";
import { useAuth, type User } from "../auth";
import { AuthLayout } from "../components/AuthLayout";
import { GoogleButton, useGoogleConfigured } from "../components/GoogleButton";
import { useSetupNeeded } from "../lib/setupStatus";
import { useTitle } from "../lib/useTitle";

/** Where a freshly signed-in person goes: admin two-step setup comes first. */
export function nextStop(user: User, from: string): string {
  if (user.approval !== "approved") return "/";
  if (user.mfaRequired && !user.mfaEnabled) return "/account/two-step";
  return from;
}

/** What went wrong on the way back from Google. Only these codes are shown; anything else is the generic line. */
const ERRORS: Record<string, { title?: string; text: string }> = {
  declined: { title: "Your request wasn't approved", text: "The admin didn't approve access for this Google account. If you think that's a mistake, talk to them." },
  disabled: { title: "This account is turned off", text: "Your sign-in has been turned off. Talk to the admin if you need it back." },
  account_conflict: { text: "That Google account doesn't match the account for this email. Sign in with the Google account you used before, or ask the admin." },
  cancelled: { text: "Google sign-in was cancelled. Press the button to try again." },
  state: { text: "That sign-in took too long or was opened in another window. Please try again." },
  token: { text: "Google's answer couldn't be checked, or your email isn't verified with Google. Please try again." },
  google: { text: "Google sign-in didn't work this time. Please try again." },
  google_not_configured: { text: "Google sign-in isn't set up on the server yet. Ask whoever runs the system to add the Google client ID and secret." },
};

export function Login() {
  useTitle("Sign in");
  const { user, loading } = useAuth();
  const setup = useSetupNeeded();
  const configured = useGoogleConfigured();
  const [params] = useSearchParams();

  if (loading || setup.isPending) return <div className="empty" style={{ paddingTop: "30vh" }}>Opening the Luxpackers desk…</div>;
  if (setup.data?.needed) return <Navigate to="/setup" replace />;
  if (user) return <Navigate to={nextStop(user, "/")} replace />;

  const code = params.get("error");
  const err = code ? ERRORS[code] ?? ERRORS.google : null;
  const off = configured.data?.configured === false;

  return (
    <AuthLayout>
      <div className="login-card">
        <h1>{err?.title ?? "Sign in"}</h1>
        <p>{err?.title ? err.text : "Use your Google account. If you're new, the admin will let you in."}</p>
        {err && !err.title && <div className="notice red" role="alert">{err.text}</div>}
        {off && !err && <div className="notice red" role="alert">{ERRORS.google_not_configured.text}</div>}
        <GoogleButton disabled={off} />
        <p className="small muted">There are no passwords here: Google checks who you are.</p>
      </div>
    </AuthLayout>
  );
}
