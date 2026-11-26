import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { REGISTERS } from "../../../shared/schema";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { Placeholder } from "../components/Placeholder";
import { useToast } from "../components/Toast";
import { errorText } from "../lib/errors";
import type { PersonRow } from "../lib/people";
import { useTitle } from "../lib/useTitle";

interface Preview { counts: Record<string, number>; owners: string[] }
interface Warning { collection: string; id: string; field: string }
interface Result { created: number; updated: number; skipped: number; warnings: Warning[] }
type Source = { kind: "seed" } | { kind: "file"; name: string; backup: unknown };

const MAX_BYTES = 5 * 1024 * 1024;
const NAMES: Record<string, string> = {
  tasks: "Tasks", ...Object.fromEntries(REGISTERS.map((r) => [r.id, r.name])),
  team: "Team members (not imported)", activity: "Activity log (not imported)",
};
const nameOf = (c: string) => NAMES[c] ?? c;
const SHOWN_WARNINGS = 50;

export function Import() {
  const { user } = useAuth();
  if (user?.role !== "admin") return <Placeholder title="Import" eyebrow="Administrator" note="You don't have access to this page." />;
  return <ImportFlow />;
}

function warningText(w: Warning): string {
  const where = `${nameOf(w.collection)}${w.id ? ` (${w.id})` : ""}`;
  if (w.field === "row") return `${where}: a row could not be read and was skipped.`;
  if (w.field === "id") return `${where}: the record's id was missing or repeated, so it was skipped or given a new one.`;
  return `${where}: “${w.field}” was missing or not understood, so it was left out.`;
}

function ImportFlow() {
  const notify = useToast();
  const qc = useQueryClient();
  useTitle("Import");
  const [source, setSource] = useState<Source | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [owners, setOwners] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const peopleQ = useQuery({ queryKey: ["people"], queryFn: () => api<{ people: PersonRow[] }>("GET", "/people"), staleTime: 5 * 60_000 });
  const people = (peopleQ.data?.people ?? []).filter((p) => p.status !== "left");

  const body = (s: Source) => (s.kind === "seed" ? { seed: true } : { backup: s.backup });

  function explain(e: unknown): string {
    if (e instanceof ApiError && e.status === 413) return "That file is too big. The limit is 5 MB.";
    if (e instanceof ApiError && e.status === 400) return e.field === "ownerMap" ? "One of the chosen people can't be used. Pick again." : "That file doesn't look like a Luxpackers backup.";
    return errorText(e);
  }

  async function choose(s: Source) {
    setBusy(true);
    setError("");
    try {
      const p = await api<Preview>("POST", "/import/preview", body(s));
      setSource(s);
      setPreview(p);
      setOwners({});
      setResult(null);
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_BYTES) return setError("That file is too big. The limit is 5 MB.");
    let backup: unknown;
    try {
      backup = JSON.parse(await file.text());
    } catch {
      return setError("That file doesn't look like a Luxpackers backup.");
    }
    if (!backup || typeof backup !== "object" || Array.isArray(backup)) return setError("That file doesn't look like a Luxpackers backup.");
    await choose({ kind: "file", name: file.name, backup });
  }

  async function run() {
    if (!source) return;
    const ownerMap = Object.fromEntries(Object.entries(owners).map(([name, id]) => [name, id || null]));
    setBusy(true);
    setError("");
    try {
      const r = await api<Result>("POST", "/import", { ...body(source), ownerMap });
      setResult(r);
      setPreview(null);
      await Promise.all(["tasks", "records", "dashboard", "audit", "people"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      notify("Import finished.");
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    setSource(null);
    setPreview(null);
    setResult(null);
    setError("");
  }

  const counts = preview ? Object.entries(preview.counts) : [];

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Administrator</div>
          <h1>Import</h1>
          <p>Bring in records from the old CRM backup, or load the starting records for a fresh desk.</p>
        </div>
      </div>

      {error && <div className="notice red" role="alert">{error}</div>}

      {result ? (
        <section className="card card-pad">
          <div className="section-head"><h2>Import finished</h2></div>
          <div className="figures four" style={{ marginBottom: 20 }}>
            <div className="fig"><span className="num">{result.created}</span><span className="lbl">Added</span></div>
            <div className="fig"><span className="num">{result.updated}</span><span className="lbl">Updated</span></div>
            <div className="fig"><span className="num">{result.skipped}</span><span className="lbl">Skipped</span></div>
            <div className="fig"><span className="num">{result.warnings.length}</span><span className="lbl">Warnings</span></div>
          </div>
          {result.warnings.length > 0 && (
            <>
              <h3>Things to check</h3>
              <ul className="warnings">
                {result.warnings.slice(0, SHOWN_WARNINGS).map((w, i) => <li key={i} className="small">{warningText(w)}</li>)}
              </ul>
              {result.warnings.length > SHOWN_WARNINGS && <p className="small muted">…and {result.warnings.length - SHOWN_WARNINGS} more.</p>}
            </>
          )}
          <div className="actions" style={{ marginTop: 18 }}><button type="button" className="btn quiet" onClick={startOver}>Import something else</button></div>
        </section>
      ) : preview ? (
        <section className="card card-pad">
          <div className="section-head"><h2>{source?.kind === "seed" ? "Starting records" : source?.name}</h2></div>
          <p className="muted small" style={{ marginTop: 0 }}>This is what was found:</p>
          {counts.length === 0 ? (
            <p>Nothing was found in this file.</p>
          ) : (
            <ul className="upcoming" style={{ maxWidth: 460 }}>
              {counts.map(([c, n]) => <li key={c}><span>{nameOf(c)}</span><b>{n}</b></li>)}
            </ul>
          )}

          {preview.owners.length > 0 && (
            <>
              <h3 style={{ margin: "24px 0 6px" }}>Who owns what</h3>
              <p className="muted small" style={{ marginTop: 0 }}>The old records name owners as text. Match each name to a person here.</p>
              <div className="form" style={{ maxWidth: 720 }}>
                {preview.owners.map((name, i) => (
                  <div className="field" key={name}>
                    <label className="flabel" htmlFor={`own_${i}`}>{name}</label>
                    <select id={`own_${i}`} className="input" value={owners[name] ?? ""} onChange={(e) => setOwners((o) => ({ ...o, [name]: e.target.value }))}>
                      <option value="">Leave unassigned</option>
                      {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="notice" style={{ marginTop: 20 }}>Importing again overwrites changes made here to the same records.</div>
          <div className="actions">
            <button type="button" className="btn" disabled={busy || counts.length === 0} onClick={() => void run()}>{busy ? "Importing…" : "Import"}</button>
            <button type="button" className="btn quiet" disabled={busy} onClick={startOver}>Choose a different file</button>
          </div>
        </section>
      ) : (
        <div className="grid-2">
          <section className="card card-pad">
            <div className="section-head"><h2>Old CRM backup</h2></div>
            <p className="muted small" style={{ marginTop: 0 }}>Choose the backup file you downloaded from the old CRM. You can look before anything is imported.</p>
            <div className="field">
              <label className="flabel" htmlFor="imp_file">Backup file (.json, up to 5 MB)</label>
              <input id="imp_file" type="file" accept="application/json,.json" className="input" disabled={busy} onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
            </div>
          </section>
          <section className="card card-pad">
            <div className="section-head"><h2>Starting records</h2></div>
            <p className="muted small" style={{ marginTop: 0 }}>The open tasks, the trips, the access register and the partner hotels the company began with.</p>
            <button type="button" className="btn" disabled={busy} onClick={() => void choose({ kind: "seed" })}>Load starting records</button>
          </section>
        </div>
      )}
    </>
  );
}
