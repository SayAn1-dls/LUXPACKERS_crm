import { useState } from "react";
import { MIN_PASSWORD, generatePassword } from "../lib/people";

interface Props {
  id: string;
  value: string;
  onChange: (v: string, generated: boolean) => void;
  error?: string;
  label?: string;
  hint?: string;
}

/** A password box with Show and Generate. A generated password is shown so it can be copied. */
export function PasswordInput({ id, value, onChange, error, label = "Password", hint }: Props) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="field wide">
      <label className="flabel" htmlFor={id}>{label}</label>
      <div className="pw-row">
        <input
          id={id} className="input" type={visible ? "text" : "password"} autoComplete="new-password" value={value}
          onChange={(e) => onChange(e.target.value, false)} aria-invalid={!!error} aria-describedby={`${id}_hint${error ? ` ${id}_err` : ""}`}
        />
        <button type="button" className="btn quiet" onClick={() => setVisible((v) => !v)}>{visible ? "Hide" : "Show"}</button>
        <button type="button" className="btn quiet" onClick={() => { setVisible(true); onChange(generatePassword(), true); }}>Generate</button>
      </div>
      <span className="help" id={`${id}_hint`}>{hint ?? `At least ${MIN_PASSWORD} characters.`}</span>
      {error && <span className="err" id={`${id}_err`}>{error}</span>}
    </div>
  );
}
