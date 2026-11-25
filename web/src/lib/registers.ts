/* Register helpers shared by the table, the drawer and the pages. */
import { registerDepts } from "../../../shared/schema";
import type { FieldDef, RegisterDef, Tone } from "../../../shared/schema";
import type { User } from "../auth";

export interface RecordLink { label: string; url: string }

/** A register row as the API returns it. */
export interface RegisterRecord {
  id: string;
  collection: string;
  dept: string | null;
  ownerId: string | null;
  ownerName: string | null;
  title: string;
  data: Record<string, any>;
  version: number;
  updatedAt: string;
  updatedByName: string | null;
}

export const NO_ACCESS = "You don't have access to this register.";
export const NO_DELETE = "You can't delete in this register.";

/** Mirrors canReadRegister / canWriteRegister on the server (it checks again). */
export const canUseRegister = (u: User, id: string) => u.role === "admin" || registerDepts(id).includes(u.dept);
/** Mirrors canDeleteRecord: admin, or a manager whose department owns the register. */
export const canDeleteIn = (u: User, id: string) => canUseRegister(u, id) && (u.role === "admin" || u.role === "manager");

export const fieldOf = (reg: RegisterDef, key: string): FieldDef | undefined => reg.fields.find((f) => f.key === key);

/** Value of a column for a row. The owner lives outside `data`. */
export const valueOf = (r: RegisterRecord, key: string): any => (key === "owner_id" ? r.ownerName ?? "" : r.data[key]);

/** A record as the form and the calc functions see it (owner as an id under owner_id). */
export const flatten = (r: RegisterRecord): Record<string, any> => ({ ...r.data, owner_id: r.ownerId ?? "" });

export const toneOf = (reg: RegisterDef, v: unknown): Tone => reg.statuses.find((s) => s.v === v)?.tone ?? "muted";
export const isOpen = (reg: RegisterDef, r: RegisterRecord) => !reg.doneValues.includes(r.data[reg.statusKey]);

/** Today in India, as YYYY-MM-DD. */
export const todayIST = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

export const isLate = (reg: RegisterDef, r: RegisterRecord) => {
  const due = reg.dueKey ? r.data[reg.dueKey] : null;
  return !!due && due < todayIST() && isOpen(reg, r) && reg.id !== "bookings";
};

export const money = (n: unknown): string =>
  n === "" || n == null || Number.isNaN(Number(n)) ? "" : "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });

export const moneyShort = (v: unknown): string => {
  const n = Number(v) || 0;
  if (n >= 1e7) return "₹" + (n / 1e7).toFixed(n >= 1e8 ? 0 : 1) + " Cr";
  if (n >= 1e5) return "₹" + (n / 1e5).toFixed(n >= 1e6 ? 0 : 1) + " L";
  return "₹" + n.toLocaleString("en-IN");
};

/** One plain-English line about a register, or "" when there is nothing useful to say. */
export function summaryOf(reg: RegisterDef, rows: RegisterRecord[]): string {
  const num = (v: unknown) => Number(v) || 0;
  const d = (r: RegisterRecord) => r.data;
  if (reg.id === "leads") {
    const open = rows.filter((r) => isOpen(reg, r));
    return `${open.length} open · ${moneyShort(open.reduce((s, r) => s + num(d(r).quote), 0))} quoted · ${rows.filter((r) => d(r).stage === "Confirmed").length} confirmed`;
  }
  if (reg.id === "finance") {
    const sum = (f: (r: RegisterRecord) => boolean) => rows.filter(f).reduce((s, r) => s + num(d(r).amount), 0);
    const pending = rows
      .filter((r) => d(r).status === "Pending" || d(r).status === "Overdue")
      .reduce((s, r) => s + (d(r).flow === "In" ? 1 : -1) * num(d(r).amount), 0);
    return `Received ${money(sum((r) => d(r).flow === "In" && d(r).status === "Paid"))} · Paid out ${money(sum((r) => d(r).flow === "Out" && d(r).status === "Paid"))} · Still pending ${money(Math.abs(pending))}`;
  }
  if (reg.id === "bookings") {
    const bal = rows.filter((r) => d(r).payStatus !== "Cancelled").reduce((s, r) => s + num(d(r).value) - num(d(r).received), 0);
    return `${rows.length} ${rows.length === 1 ? "booking" : "bookings"} · ${money(bal)} still to be received`;
  }
  if (reg.id === "trips") return `${rows.filter((r) => d(r).status === "Live").length} of ${rows.length} live on the website`;
  return "";
}

/** Link {label,url}: only http(s) become anchors. */
export function safeLink(l: RecordLink): string | null {
  try {
    const u = new URL(l.url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}
