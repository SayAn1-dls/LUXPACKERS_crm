import { useState } from "react";
import { Icon } from "./Icon";

/** One-time backup codes, shown once. They are not kept anywhere on this page after it is left. */
export function BackupCodes({ codes, email, onDone, doneLabel = "I have saved them" }: { codes: string[]; email: string; onDone: () => void; doneLabel?: string }) {
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  const text = codes.join("\n");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("yes");
    } catch {
      setCopied("no");
    }
  }

  function download() {
    const body = `Luxpackers backup codes for ${email}\nEach code works once. Keep them somewhere safe.\n\n${text}\n`;
    const url = URL.createObjectURL(new Blob([body], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "luxpackers-backup-codes.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="notice" role="status">
      <b>Your backup codes</b>
      <p style={{ margin: "8px 0" }}>If you lose your phone, each of these lets you sign in once. Save them somewhere safe, away from your phone.</p>
      <ul className="backup-codes" aria-label="Backup codes">
        {codes.map((c) => <li key={c}><code>{c}</code></li>)}
      </ul>
      <div className="actions" style={{ margin: "10px 0" }}>
        <button type="button" className="btn quiet sm" onClick={() => void copy()}>
          <Icon name={copied === "yes" ? "check" : "log"} size={16} />{copied === "yes" ? "Copied" : "Copy"}
        </button>
        <button type="button" className="btn quiet sm" onClick={download}><Icon name="download" size={16} />Download .txt</button>
      </div>
      {copied === "no" && <p className="small" style={{ margin: "0 0 8px" }}>Could not copy. Select the codes above and copy them by hand.</p>}
      <p className="small" style={{ margin: "0 0 12px" }}><b>They won't be shown again.</b></p>
      <button type="button" className="btn" onClick={onDone}>{doneLabel}</button>
    </div>
  );
}
