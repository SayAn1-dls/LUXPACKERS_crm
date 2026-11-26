import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { FieldDef, RegisterDef } from "../../../shared/schema";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { RecordFields } from "./RecordFields";
import type { Draft } from "./RecordFields";
import { useToast } from "./Toast";
import { CONFLICT_MESSAGE } from "../lib/tasks";
import type { Person } from "../lib/tasks";
import { NO_DELETE, safeLink, todayIST } from "../lib/registers";
import type { RecordLink, RegisterRecord } from "../lib/registers";

interface Props {
  register: RegisterDef;
  /** The record to edit, or null to add a new one. */
  record: RegisterRecord | null;
  /** People who can own a record (not left). */
  people: Person[];
  /** False for a view-only register: the drawer becomes a read-only sheet. */
  canEdit: boolean;
  canDelete: boolean;
  conflict: boolean;
  onConflict: () => void;
  onReload: () => void;
  onClose: () => void;
}

const STORED = (f: FieldDef) => f.type !== "computed" && f.type !== "person";
const NUM = (f: FieldDef) => f.type === "money" || f.type === "number";

function toDraft(reg: RegisterDef, rec: RegisterRecord | null, userId: string, people: Person[]): Draft {
  const d: Draft = {};
  for (const f of reg.fields.filter(STORED)) {
    const v = rec?.data[f.key];
    d[f.key] = f.type === "links" ? (v ?? []).map((l: RecordLink) => ({ ...l })) : f.type === "checklist" ? [...(v ?? [])] : NUM(f) ? (v == null ? "" : String(v)) : v ?? "";
  }
  if (rec) d.owner_id = rec.ownerId ?? "";
  else {
    d[reg.statusKey] ||= reg.statuses[0]?.v ?? "";
    if (reg.id === "finance") {
      d.flow ||= "In";
      d.date ||= todayIST();
    }
    d.owner_id = people.some((p) => p.id === userId) ? userId : "";
  }
  return d;
}

/** What goes to the server for one field: a number, trimmed text, a list, or null to clear. */
function toValue(f: FieldDef, raw: unknown): unknown {
  if (f.type === "links") return (raw as RecordLink[]).map((l) => ({ label: l.label.trim(), url: l.url.trim() })).filter((l) => l.label || l.url);
  if (f.type === "checklist") return raw;
  if (NUM(f)) return raw === "" || raw == null ? null : Number(raw);
  const s = typeof raw === "string" ? raw.trim() : raw;
  return s === "" || s == null ? null : s;
}

function validate(reg: RegisterDef, d: Draft): Record<string, string> {
  const errs: Record<string, string> = {};
  for (const f of reg.fields.filter(STORED)) {
    const v = toValue(f, d[f.key]);
    if (f.required && (v === null || v === "")) errs[f.key] = "Please fill this in.";
    else if (NUM(f) && v !== null && (!Number.isFinite(v as number) || (v as number) < 0)) errs[f.key] = "Use a number that is 0 or more.";
    else if (f.type === "links" && (v as RecordLink[]).some((l) => !safeLink(l))) errs[f.key] = "Each link needs an address starting with http:// or https://";
  }
  return errs;
}

export function RecordDrawer({ register: reg, record, people, canEdit, canDelete, conflict, onConflict, onReload, onClose }: Props) {
  const { user } = useAuth();
  const notify = useToast();
  const qc = useQueryClient();
  const box = useRef<HTMLElement>(null);
  const isNew = !record;
  const [draft, setDraft] = useState<Draft>(() => toDraft(reg, record, user!.id, people));
  const [base, setBase] = useState<Draft>(draft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Load saved values whenever the record changes underneath us (opened, saved by someone else, reloaded).
  useEffect(() => {
    const d = toDraft(reg, record, user!.id, people);
    setDraft(d);
    setBase(d);
    setErrors({});
  }, [record?.id, record?.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(base), [draft, base]);
  if (!user) return null;

  const set = (key: string, value: unknown) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: "" } : e));
  };

  const refresh = () => Promise.all(["records", "dashboard"].map((k) => qc.invalidateQueries({ queryKey: [k] })));

  function fail(e: unknown) {
    if (!(e instanceof ApiError)) return notify("Something went wrong. Please try again.", true);
    if (e.status === 409) {
      onConflict();
      return notify(CONFLICT_MESSAGE, true);
    }
    if (e.status === 400 && e.field) {
      const key = e.field === "ownerId" ? "owner_id" : e.field;
      const f = reg.fields.find((x) => x.key === key);
      if (f) {
        setErrors({ [key]: f.required && !String(draft[key] ?? "").trim() ? "Please fill this in." : "Please check this one." });
        return notify(`Please check “${f.label}”.`, true);
      }
    }
    if (e.status === 403) return notify("You don't have permission to do that.", true);
    if (e.status === 404) {
      void refresh();
      return notify("That record no longer exists.", true);
    }
    notify(e.message, true);
  }

  async function save() {
    const errs = validate(reg, draft);
    if (Object.keys(errs).length) {
      setErrors(errs);
      return notify("Please fix the highlighted fields.", true);
    }
    const stored = reg.fields.filter(STORED);
    const data: Record<string, unknown> = {};
    const body: Record<string, unknown> = {};
    for (const f of stored) {
      const next = toValue(f, draft[f.key]);
      if (isNew ? next !== null : JSON.stringify(next) !== JSON.stringify(toValue(f, base[f.key]))) data[f.key] = next;
    }
    if (isNew) {
      Object.assign(body, { data, ...(draft.owner_id ? { ownerId: draft.owner_id } : {}) });
    } else {
      if (draft.owner_id !== base.owner_id) body.ownerId = draft.owner_id || null;
      if (Object.keys(data).length) body.data = data;
      if (Object.keys(body).length === 0) return onClose();
      body.version = record.version;
    }
    setBusy(true);
    try {
      await (isNew ? api("POST", `/records/${reg.id}`, body) : api("PATCH", `/records/${reg.id}/${record.id}`, body));
      await refresh();
      notify(isNew ? `${cap(reg.singular)} added.` : "Saved.");
      onClose();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!record) return;
    setBusy(true);
    try {
      await api("DELETE", `/records/${reg.id}/${record.id}`);
      notify("Moved to Trash.");
      onClose(); // close first so the page does not treat the vanished row as a bad link
      await refresh();
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) notify(NO_DELETE, true);
      else fail(e);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  const title = record ? record.title || cap(reg.singular) : `New ${reg.singular}`;
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="drawer" role="dialog" aria-modal="true" aria-labelledby="recTitle" tabIndex={-1} ref={box}>
        <div className="drawer-head">
          <div className="eyebrow">{reg.name}{isNew ? " · new" : ""}</div>
          <h2 id="recTitle">{title}</h2>
        </div>
        <div className="drawer-body">
          {conflict && (
            <div className="notice red" role="alert" style={{ position: "sticky", top: 0, zIndex: 2 }}>
              {CONFLICT_MESSAGE}{" "}
              <button type="button" className="btn quiet" style={{ marginLeft: 8, minHeight: 36 }} onClick={onReload}>Reload</button>
            </div>
          )}
          {reg.id === "access" && (
            <div className="notice red"><b>Never write a password, OTP, API key or card number in this CRM.</b> Record only who holds a login and where it is kept.</div>
          )}
          {!canEdit && <p className="notice soft">You can look at this {reg.singular} but not change it.</p>}
          <fieldset className="plain" disabled={!canEdit}>
            <RecordFields register={reg} draft={draft} set={set} people={people} ownerName={record?.ownerName ?? null} errors={errors} />
          </fieldset>
          {record && (
            <div className="history">
              <span className="flabel">Last change</span>
              <ul><li>{record.updatedByName ? `${record.updatedByName} · ` : ""}{new Date(record.updatedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</li></ul>
            </div>
          )}
        </div>
        <div className="drawer-foot">
          <div>
            {record && canDelete && !confirming && <button type="button" className="btn quiet" disabled={busy} onClick={() => setConfirming(true)}>Delete</button>}
            {confirming && (
              <span className="actions">
                <span className="small">Move this {reg.singular} to Trash?</span>
                <button type="button" className="btn danger" disabled={busy} onClick={() => void remove()}>Yes, delete</button>
                <button type="button" className="btn quiet" onClick={() => setConfirming(false)}>Keep it</button>
              </span>
            )}
          </div>
          <div className="actions">
            <button type="button" className="btn quiet" onClick={onClose}>{isNew || dirty ? "Cancel" : "Close"}</button>
            {canEdit && (isNew || dirty) && <button type="button" className="btn" disabled={busy} onClick={() => void save()}>{isNew ? `Add ${reg.singular}` : "Save changes"}</button>}
          </div>
        </div>
      </section>
    </div>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
