import { useState } from "react";

/** A temporary password, shown once. It is never stored on this page after it is dismissed. */
export function TempPassword({ name, password, onDone }: { name: string; password: string; onDone: () => void }) {
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied("yes");
    } catch {
      setCopied("no");
    }
  }

  return (
    <div className="notice" role="status">
      <b>Temporary password for {name}</b>
      <p style={{ margin: "8px 0" }}>Give it to them in person or by phone. They will be asked to choose their own at first sign-in.</p>
      <div className="actions" style={{ alignItems: "center", margin: "10px 0" }}>
        <code className="temp-pw">{password}</code>
        <button type="button" className="btn quiet" onClick={() => void copy()}>{copied === "yes" ? "Copied" : "Copy"}</button>
      </div>
      {copied === "no" && <p className="small" style={{ margin: "0 0 8px" }}>Could not copy. Select the password above and copy it by hand.</p>}
      <p className="small" style={{ margin: "0 0 12px" }}><b>It won't be shown again.</b></p>
      <button type="button" className="btn" onClick={onDone}>I have noted it</button>
    </div>
  );
}
