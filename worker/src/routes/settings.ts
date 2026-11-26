import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { auditStmt } from "../lib/audit";
import { isRealDate } from "../lib/dates";
import { canEditSettings } from "../lib/policy";
import { requireUser } from "../lib/session";

export interface Settings {
  leaveAllowances: Record<"Casual" | "Sick" | "Earned", number>;
  holidays: string[];
}

const DEFAULTS: Settings = { leaveAllowances: { Casual: 12, Sick: 6, Earned: 15 }, holidays: [] };

export async function loadSettings(db: D1Database): Promise<Settings> {
  const { results } = await db.prepare("SELECT key, value FROM settings WHERE key IN ('leave_allowances', 'holidays')").all<{ key: string; value: string }>();
  const out: Settings = { leaveAllowances: { ...DEFAULTS.leaveAllowances }, holidays: [] };
  for (const r of results) {
    try {
      const v = JSON.parse(r.value);
      if (r.key === "leave_allowances" && v && typeof v === "object") Object.assign(out.leaveAllowances, v);
      if (r.key === "holidays" && Array.isArray(v)) out.holidays = v.filter((x) => typeof x === "string");
    } catch {
      /* keep defaults */
    }
  }
  return out;
}

const Allowance = z.number().finite().min(0);
const PatchBody = z
  .object({
    leaveAllowances: z.object({ Casual: Allowance, Sick: Allowance, Earned: Allowance }).strict().optional(),
    holidays: z
      .array(z.string().refine(isRealDate, "invalid date"))
      .max(500)
      .refine((a) => new Set(a).size === a.length, "duplicate dates")
      .optional(),
  })
  .strict();

export const settings = new Hono<AppEnv>();
settings.use("*", requireUser);

settings.get("/", async (c) => c.json(await loadSettings(c.env.DB)));

settings.patch("/", async (c) => {
  const u = c.var.user!;
  if (!canEditSettings(u)) return c.json({ error: "forbidden" }, 403);
  const parsed = PatchBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid" }, 400);
  const b = parsed.data;
  const db = c.env.DB;
  const upsert = (key: string, value: unknown) =>
    db
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(key, JSON.stringify(value));
  const stmts: D1PreparedStatement[] = [];
  const changed: string[] = [];
  if (b.leaveAllowances) {
    stmts.push(upsert("leave_allowances", b.leaveAllowances));
    changed.push("leaveAllowances");
  }
  if (b.holidays) {
    stmts.push(upsert("holidays", [...b.holidays].sort()));
    changed.push("holidays");
  }
  if (stmts.length === 0) return c.json(await loadSettings(db));
  stmts.push(auditStmt(db, u, "settings_updated", "settings", null, null, { fields: changed }));
  await db.batch(stmts);
  return c.json(await loadSettings(db));
});
