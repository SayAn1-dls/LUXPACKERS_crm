import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import QRCode from "qrcode";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { AuthLayout } from "../components/AuthLayout";
import { BackupCodes } from "../components/BackupCodes";
import { GoogleButton } from "../components/GoogleButton";
import { useTitle } from "../lib/useTitle";

type Step = { kind: "intro" } | { kind: "scan"; secret: string; uri: string } | { kind: "codes"; codes: string[] };

const NOT_CONFIGURED = "Two-step sign-in isn't set up on the server yet. Ask whoever runs the system to add the MFA_KEY secret.";

/** Turn on two-step sign-in: scan the QR code (or type the key), confirm with a code, save the backup codes. */
export function TwoStepSetup() {
  useTitle("Two-step sign-in");
  const { user, refresh, signOut } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>({ kind: "intro" });
  const [qr, setQr] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reauth, setReauth] = useState(false);
  const forced = !!user?.mfaRequired && !user.mfaEnabled;

  useEffect(() => {
    if (step.kind !== "scan") return;
    let live = true;
    QRCode.toString(step.uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" })
      .then((svg) => live && setQr(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`))
      .catch(() => live && setQr(""));
    return () => {
      live = false;
    };
  }, [step]);

  if (!user) return null;
  if (user.mfaEnabled && step.kind !== "codes") return <Navigate to="/account" replace />;

  const start = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await api<{ secret: string; uri: string }>("POST", "/auth/mfa/setup");
      setStep({ kind: "scan", ...res });
    } catch (ex) {
      if (ex instanceof ApiError && ex.code === "already_enabled") await refresh();
      else if (ex instanceof ApiError && ex.code === "reauth_required") setReauth(true);
      else setError(ex instanceof ApiError && ex.code === "mfa_not_configured" ? NOT_CONFIGURED : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code.replace(/\s/g, ""))) return setError("Type the 6-digit code your app shows.");
    setBusy(true);
    setError("");
    try {
      const res = await api<{ backupCodes: string[] }>("POST", "/auth/mfa/enable", { code: code.replace(/\s/g, "") });
      setStep({ kind: "codes", codes: res.backupCodes });
    } catch (ex) {
      setCode("");
      if (ex instanceof ApiError && ex.code === "reauth_required") setReauth(true);
      else if (ex instanceof ApiError && ex.code === "bad_code") setError("That code isn't right. Check the time on your phone, wait for a new code and try again.");
      else if (ex instanceof ApiError && ex.code === "mfa_not_configured") setError(NOT_CONFIGURED);
      else setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    await refresh();
    navigate(forced ? "/" : "/account", { replace: true });
  };

  const leave = forced ? (
    <button type="button" className="btn link" onClick={() => void signOut()}>Sign out</button>
  ) : (
    <Link className="small muted" to="/account">Cancel</Link>
  );

  return (
    <AuthLayout>
      <div className="login-card">
        <h1>Two-step sign-in</h1>
        {reauth && step.kind !== "codes" && (
          <>
            <p>To keep your account safe, sign in with Google again first. You'll come straight back here.</p>
            <GoogleButton next="two-step" />
          </>
        )}
        {!reauth && step.kind === "intro" && (
          <>
            <p>
              {forced
                ? "Administrators must turn this on before carrying on. "
                : ""}
              After Google, you'll also type a 6-digit code from an authenticator app on your phone, such as Google Authenticator.
            </p>
            <div className="err" role="alert">{error}</div>
            <button type="button" className="btn block" disabled={busy} onClick={() => void start()}>{busy ? "Starting…" : "Turn on two-step sign-in"}</button>
          </>
        )}
        {!reauth && step.kind === "scan" && (
          <form onSubmit={confirm} noValidate>
            <p>1. In your authenticator app, add an account and scan this code.</p>
            <div className="qr">{qr ? <img src={qr} width={200} height={200} alt="QR code to add Luxpackers to your authenticator app" /> : <span className="small">Making the QR code…</span>}</div>
            <p className="small">Can't scan? Choose “enter a setup key” in the app and type this key:</p>
            <code className="secret-key" aria-label="Setup key">{step.secret.replace(/(.{4})/g, "$1 ").trim()}</code>
            <p style={{ marginTop: 18 }}>2. Type the 6-digit code the app now shows.</p>
            <div className="field">
              <label htmlFor="code">6-digit code</label>
              <input className="input code-input" id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <div className="err" role="alert">{error}</div>
            <button className="btn block" type="submit" disabled={busy}>{busy ? "Checking…" : "Turn on"}</button>
          </form>
        )}
        {step.kind === "codes" && (
          <>
            <p>Two-step sign-in is on.</p>
            <BackupCodes codes={step.codes} email={user.email} onDone={() => void finish()} />
          </>
        )}
        {step.kind !== "codes" && <p style={{ marginTop: 14 }}>{leave}</p>}
      </div>
    </AuthLayout>
  );
}
