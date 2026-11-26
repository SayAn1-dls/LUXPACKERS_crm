/* Field-level validation shared by the records routes and the old-CRM import. */
import type { FieldDef, RegisterDef } from "../../../shared/schema";
import { httpUrl } from "./validate";

export type Data = Record<string, unknown>;

export class Invalid extends Error {
  constructor(public field?: string) {
    super("invalid");
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_TEXT = 5000;

export const isEmpty = (v: unknown) => v === null || v === undefined || v === "";
export const isDate = (s: string) => {
  if (!DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/** Validates one non-empty value for a field; returns the value to store. Throws Invalid(key). */
export function cleanValue(reg: RegisterDef, f: FieldDef, v: unknown): unknown {
  const bad = () => new Invalid(f.key);
  switch (f.type) {
    case "text":
    case "textarea":
    case "email": {
      if (typeof v !== "string") throw bad();
      const s = v.trim();
      if (s.length > MAX_TEXT) throw bad();
      if (s === "") return undefined;
      if (f.type === "email" && !EMAIL.test(s)) throw bad();
      return s;
    }
    case "select":
      if (typeof v !== "string" || !(f.options ?? []).includes(v)) throw bad();
      return v;
    case "status":
      if (typeof v !== "string" || !reg.statuses.some((s) => s.v === v)) throw bad();
      return v;
    case "money":
    case "number":
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw bad();
      return v;
    case "date":
      if (typeof v !== "string" || !isDate(v)) throw bad();
      return v;
    case "checklist": {
      if (!Array.isArray(v) || v.length > 100) throw bad();
      const opts = f.options ?? [];
      const seen = new Set<string>();
      for (const x of v) {
        if (typeof x !== "string" || !opts.includes(x) || seen.has(x)) throw bad();
        seen.add(x);
      }
      return v;
    }
    case "links": {
      if (!Array.isArray(v) || v.length > 20) throw bad();
      return v.map((x) => {
        if (!x || typeof x !== "object") throw bad();
        const { label, url } = x as Record<string, unknown>;
        if (typeof label !== "string" || label.length > 300) throw bad();
        if (typeof url !== "string" || url.length > 2000 || !httpUrl(url.trim())) throw bad();
        return { label: label.trim(), url: url.trim() };
      });
    }
    default:
      throw bad();
  }
}

export const STORED = (f: FieldDef) => f.type !== "computed" && f.type !== "person";

/** Applies `input` over `base` (field by field). Unknown keys, computed and person fields are ignored. */
export function applyData(reg: RegisterDef, base: Data, input: Data): Data {
  const out: Data = { ...base };
  for (const f of reg.fields.filter(STORED)) {
    if (!(f.key in input)) continue;
    const v = input[f.key];
    const clean = isEmpty(v) ? undefined : cleanValue(reg, f, v);
    if (clean === undefined) delete out[f.key];
    else out[f.key] = clean;
  }
  return out;
}

export const titleOf = (reg: RegisterDef, data: Data) => {
  const t = data[reg.titleKey];
  return typeof t === "string" ? t : "";
};

export const isDateString = isDate;

/** Pre-coerces legacy values (numeric strings for number/money fields). */
const legacyCoerce = (f: FieldDef, v: unknown): unknown =>
  (f.type === "money" || f.type === "number") && typeof v === "string" && /^\s*\d+(\.\d+)?\s*$/.test(v) ? Number(v) : v;

/**
 * Lenient version of applyData for old backups: every stored field is validated with the same rules,
 * but an invalid value is dropped and reported through `bad(fieldKey)` instead of failing.
 * Link lists are filtered item by item.
 */
export function cleanLegacyData(reg: RegisterDef, input: Data, bad: (field: string) => void): Data {
  const out: Data = {};
  for (const f of reg.fields.filter(STORED)) {
    const raw = input[f.key];
    if (isEmpty(raw)) continue;
    try {
      if (f.type === "links") {
        const { links, dropped } = cleanLegacyLinks(raw);
        if (dropped) bad(f.key);
        if (links.length) out[f.key] = links;
        continue;
      }
      const clean = cleanValue(reg, f, legacyCoerce(f, raw));
      if (clean !== undefined) out[f.key] = clean;
    } catch (e) {
      if (!(e instanceof Invalid)) throw e;
      bad(f.key);
    }
  }
  return out;
}

/** Legacy links: [{label,url}] (or bare url strings). Keeps valid http(s) items, at most 20. */
export function cleanLegacyLinks(raw: unknown): { links: { label: string; url: string }[]; dropped: boolean } {
  if (!Array.isArray(raw)) return { links: [], dropped: true };
  const links: { label: string; url: string }[] = [];
  let dropped = raw.length > 20;
  for (const x of raw.slice(0, 20)) {
    const o = typeof x === "string" ? { url: x } : x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    const url = typeof o.url === "string" ? o.url.trim() : "";
    if (!url || url.length > 2000 || !httpUrl(url)) {
      dropped = true;
      continue;
    }
    const label = typeof o.label === "string" && o.label.length <= 300 ? o.label.trim() : url;
    links.push({ label: label || url, url });
  }
  return { links, dropped };
}
