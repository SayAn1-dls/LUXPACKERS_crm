import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { DEPT_NAMES, REGISTERS, registerDepts } from "../../../shared/schema";
import type { FieldDef, RegisterDef } from "../../../shared/schema";
import type { AppEnv } from "../env";
import { auditStmt } from "../lib/audit";
import { canDeleteRecord, canReadRegister, canWriteRegister } from "../lib/policy";
import { requireUser } from "../lib/session";
import { httpUrl } from "../lib/validate";

type Data = Record<string, unknown>;
type Ctx = Context<AppEnv>;

class Invalid extends Error {
  constructor(public field?: string) {
    super("invalid");
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_TEXT = 5000;

const isEmpty = (v: unknown) => v === null || v === undefined || v === "";
const isDate = (s: string) => {
  if (!DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/** Validates one non-empty value for a field; returns the value to store. Throws Invalid(key). */
function cleanValue(reg: RegisterDef, f: FieldDef, v: unknown): unknown {
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

const STORED = (f: FieldDef) => f.type !== "computed" && f.type !== "person";

/** Applies `input` over `base` (field by field). Unknown keys, computed and person fields are ignored. */
function applyData(reg: RegisterDef, base: Data, input: Data): Data {
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

interface RecordRow {
  id: string;
  collection: string;
  dept: string | null;
  owner_id: string | null;
  title: string | null;
  data: string;
  version: number;
  updated_at: string;
  deleted_at: string | null;
  owner_name: string | null;
  updated_by_name: string | null;
}

const SELECT = `SELECT r.*, o.name AS owner_name, u.name AS updated_by_name
  FROM records r LEFT JOIN users o ON o.id = r.owner_id LEFT JOIN users u ON u.id = r.updated_by`;

const parseData = (s: string): Data => {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
};

const toApi = (r: RecordRow) => ({
  id: r.id,
  collection: r.collection,
  dept: r.dept,
  ownerId: r.owner_id,
  ownerName: r.owner_name,
  title: r.title ?? "",
  data: parseData(r.data),
  version: r.version,
  updatedAt: r.updated_at,
  updatedByName: r.updated_by_name,
});

const load = (db: D1Database, collection: string, id: string) =>
  db.prepare(`${SELECT} WHERE r.collection = ? AND r.id = ?`).bind(collection, id).first<RecordRow>();

const titleOf = (reg: RegisterDef, data: Data) => {
  const t = data[reg.titleKey];
  return typeof t === "string" ? t : "";
};

const DeptSchema = z.string().refine((d) => DEPT_NAMES.includes(d));
const Owner = z.string().min(1).max(100);
const DataSchema = z.record(z.string(), z.unknown());
const CreateBody = z.object({ dept: DeptSchema.optional(), ownerId: Owner.nullish(), data: DataSchema });
const PatchBody = z.object({
  version: z.number().int().min(1),
  dept: DeptSchema.optional(),
  ownerId: Owner.nullable().optional(),
  data: DataSchema.optional(),
});

const envelopeField = (e: z.ZodError) => {
  const k = e.issues[0]?.path[0];
  return typeof k === "string" && k !== "version" ? k : undefined;
};
const invalid = (c: Ctx, field?: string) => c.json(field ? { error: "invalid", field } : { error: "invalid" }, 400);

async function ownerOk(db: D1Database, id: string) {
  const o = await db.prepare("SELECT status FROM users WHERE id = ?").bind(id).first<{ status: string }>();
  return !!o && o.status !== "left";
}

/** Resolves the register and checks read access. Returns a Response on failure. */
function gate(c: Ctx): { reg: RegisterDef } | Response {
  const reg = REGISTERS.find((r) => r.id === c.req.param("collection"));
  if (!reg) return c.json({ error: "not_found" }, 404);
  if (!canReadRegister(c.var.user!, reg.id)) return c.json({ error: "forbidden" }, 403);
  return { reg };
}

export const records = new Hono<AppEnv>();
records.use("*", requireUser);

records.get("/:collection", async (c) => {
  const g = gate(c);
  if (g instanceof Response) return g;
  const { reg } = g;
  const trash = c.req.query("trash") === "1";
  if (trash && c.var.user!.role !== "admin") return c.json({ error: "forbidden" }, 403);

  const where = ["r.collection = ?", trash ? "r.deleted_at IS NOT NULL" : "r.deleted_at IS NULL"];
  const args: unknown[] = [reg.id];
  const status = c.req.query("status");
  if (status) {
    if (!reg.statuses.some((s) => s.v === status)) return c.json({ error: "invalid", field: "status" }, 400);
    where.push(`json_extract(r.data, '$.${reg.statusKey}') = ?`);
    args.push(status);
  }
  const q = c.req.query("q")?.trim();
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    where.push("(r.title LIKE ? ESCAPE '\\' OR r.data LIKE ? ESCAPE '\\')");
    args.push(like, like);
  }
  const { results } = await c.env.DB.prepare(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY r.updated_at DESC, r.rowid DESC LIMIT 1000`)
    .bind(...args)
    .all<RecordRow>();
  return c.json({ rows: results.map(toApi) });
});

records.post("/:collection", async (c) => {
  const g = gate(c);
  if (g instanceof Response) return g;
  const { reg } = g;
  const u = c.var.user!;
  if (!canWriteRegister(u, reg.id)) return c.json({ error: "forbidden" }, 403);
  const parsed = CreateBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, envelopeField(parsed.error));
  const b = parsed.data;
  const db = c.env.DB;

  let data: Data;
  try {
    data = applyData(reg, {}, b.data);
    const statusField = reg.fields.find((f) => f.key === reg.statusKey);
    if (statusField && data[reg.statusKey] === undefined) data[reg.statusKey] = reg.statuses[0].v;
    for (const f of reg.fields) if (f.required && isEmpty(data[f.key])) throw new Invalid(f.key);
  } catch (e) {
    if (e instanceof Invalid) return invalid(c, e.field);
    throw e;
  }
  if (b.ownerId && !(await ownerOk(db, b.ownerId))) return invalid(c, "ownerId");

  const owners = registerDepts(reg.id);
  const dept = b.dept ?? (owners.length === 1 ? owners[0] : u.dept);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const title = titleOf(reg, data);
  await db.batch([
    db
      .prepare(
        `INSERT INTO records (id, collection, dept, owner_id, title, data, version, created_at, created_by, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      )
      .bind(id, reg.id, dept, b.ownerId ?? null, title, JSON.stringify(data), now, u.id, now, u.id),
    auditStmt(db, u, "record_created", reg.id, id, title, { dept }),
  ]);
  return c.json({ record: toApi((await load(db, reg.id, id))!) }, 201);
});

/** Loads a live (not soft-deleted) record or null. */
async function liveRecord(c: Ctx, reg: RegisterDef) {
  const row = await load(c.env.DB, reg.id, c.req.param("id") ?? "");
  return row && !row.deleted_at ? row : null;
}

records.patch("/:collection/:id", async (c) => {
  const g = gate(c);
  if (g instanceof Response) return g;
  const { reg } = g;
  const u = c.var.user!;
  const db = c.env.DB;
  if (!canWriteRegister(u, reg.id)) return c.json({ error: "forbidden" }, 403);
  const row = await liveRecord(c, reg);
  if (!row) return c.json({ error: "not_found" }, 404);
  const parsed = PatchBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, envelopeField(parsed.error));
  const b = parsed.data;

  const old = parseData(row.data);
  let data: Data;
  try {
    data = applyData(reg, old, b.data ?? {});
    for (const f of reg.fields) if (f.required && isEmpty(data[f.key])) throw new Invalid(f.key);
  } catch (e) {
    if (e instanceof Invalid) return invalid(c, e.field);
    throw e;
  }
  const fields = Object.keys({ ...old, ...data }).filter((k) => JSON.stringify(old[k]) !== JSON.stringify(data[k]));
  const ownerChanged = b.ownerId !== undefined && b.ownerId !== row.owner_id;
  const deptChanged = b.dept !== undefined && b.dept !== row.dept;
  if (ownerChanged && b.ownerId && !(await ownerOk(db, b.ownerId))) return invalid(c, "ownerId");
  if (ownerChanged) fields.push("ownerId");
  if (deptChanged) fields.push("dept");

  if (b.version !== row.version) return c.json({ error: "conflict" }, 409);
  if (fields.length === 0) return c.json({ record: toApi(row) });

  const now = new Date().toISOString();
  const title = titleOf(reg, data);
  const res = await db.batch([
    db
      .prepare(
        `UPDATE records SET data = ?, title = ?, owner_id = ?, dept = ?, version = version + 1, updated_at = ?, updated_by = ?
         WHERE id = ? AND version = ? AND deleted_at IS NULL`,
      )
      .bind(
        JSON.stringify(data), title, ownerChanged ? b.ownerId : row.owner_id, deptChanged ? b.dept : row.dept,
        now, u.id, row.id, b.version,
      ),
    auditStmt(db, u, "record_updated", reg.id, row.id, title, { fields }),
  ]);
  if (res[0].meta.changes === 0) return c.json({ error: "conflict" }, 409);
  return c.json({ record: toApi((await load(db, reg.id, row.id))!) });
});

records.delete("/:collection/:id", async (c) => {
  const g = gate(c);
  if (g instanceof Response) return g;
  const { reg } = g;
  const u = c.var.user!;
  const db = c.env.DB;
  const row = await liveRecord(c, reg);
  if (!row) return c.json({ error: "not_found" }, 404);
  if (!canDeleteRecord(u, reg.id)) return c.json({ error: "forbidden" }, 403);
  const now = new Date().toISOString();
  const res = await db.batch([
    db
      .prepare("UPDATE records SET deleted_at = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ? AND deleted_at IS NULL")
      .bind(now, now, u.id, row.id),
    auditStmt(db, u, "record_deleted", reg.id, row.id, row.title),
  ]);
  if (res[0].meta.changes === 0) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

records.post("/:collection/:id/restore", async (c) => {
  const g = gate(c);
  if (g instanceof Response) return g;
  const { reg } = g;
  const u = c.var.user!;
  const db = c.env.DB;
  if (u.role !== "admin") return c.json({ error: "forbidden" }, 403);
  const row = await load(db, reg.id, c.req.param("id") ?? "");
  if (!row || !row.deleted_at) return c.json({ error: "not_found" }, 404);
  const now = new Date().toISOString();
  const res = await db.batch([
    db
      .prepare("UPDATE records SET deleted_at = NULL, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ? AND deleted_at IS NOT NULL")
      .bind(now, u.id, row.id),
    auditStmt(db, u, "record_restored", reg.id, row.id, row.title),
  ]);
  if (res[0].meta.changes === 0) return c.json({ error: "not_found" }, 404);
  return c.json({ record: toApi((await load(db, reg.id, row.id))!) });
});
