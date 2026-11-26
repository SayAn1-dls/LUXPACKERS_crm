import { useState } from "react";
import { Icon } from "./Icon";

/** A new password, shown once. It is never stored on this page after it is dismissed. */
export function TempPassword({ name, password, mustChange = true, onDone }: { name: string; password: string; mustChange?: boolean; onDone: () => void }) {
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
      <b>Password for {name}</b>
      <p style={{ margin: "8px 0" }}>
        Give it to them in person or by phone.{mustChange ? " They will be asked to choose their own at first sign-in." : ""}
      </p>
      <div className="actions" style={{ alignItems: "center", margin: "10px 0" }}>
        <code className="temp-pw">{password}</code>
        <button type="button" className="btn quiet" onClick={() => void copy()}>
          <Icon name={copied === "yes" ? "check" : "log"} size={16} />{copied === "yes" ? "Copied" : "Copy"}
        </button>
      </div>
      {copied === "no" && <p className="small" style={{ margin: "0 0 8px" }}>Could not copy. Select the password above and copy it by hand.</p>}
      <p className="small" style={{ margin: "0 0 12px" }}><b>It won't be shown again.</b> Passwords can't be viewed later — only set.</p>
      <button type="button" className="btn" onClick={onDone}>I have noted it</button>
    </div>
  );
}
