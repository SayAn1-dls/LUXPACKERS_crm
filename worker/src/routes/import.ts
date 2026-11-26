import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { DEPT_NAMES, REGISTERS, TASK_PRIORITIES, TASK_STATUSES, registerDepts } from "../../../shared/schema";
import type { AppEnv, SessionUser } from "../env";
import { auditStmt } from "../lib/audit";
import { cleanLegacyData, cleanLegacyLinks, isDateString, titleOf } from "../lib/recordFields";
import type { Data } from "../lib/recordFields";
import { canImport } from "../lib/policy";
import { requireUser } from "../lib/session";
import { SEED } from "../seed";

type Ctx = Context<AppEnv>;
interface Warning { collection: string; id: string; field: string }

const MAX_BODY = 5 * 1024 * 1024;
const CHUNK = 50;
/** Backup collections that are read; `team` and `activity` are counted and skipped. */
const SKIPPED_COLLECTIONS = ["team", "activity"];
const COLLECTIONS = ["tasks", ...REGISTERS.map((r) => r.id)];

const OwnerMap = z.record(z.string(), z.string().min(1).max(100).nullable());

const isObj = (v: unknown): v is Data => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const chunks = <T>(a: T[], n = CHUNK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
};

/** Reads the JSON body, refusing anything over 5 MB. */
async function readJson(c: Ctx): Promise<{ body: Data } | Response> {
  const declared = Number(c.req.header("content-length") ?? 0);
  if (declared > MAX_BODY) return c.json({ error: "too_large" }, 413);
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength > MAX_BODY) return c.json({ error: "too_large" }, 413);
  try {
    const v = JSON.parse(new TextDecoder().decode(buf));
    if (isObj(v)) return { body: v };
  } catch {
    /* falls through */
  }
  return c.json({ error: "invalid" }, 400);
}

/** The backup (or the bundled starting records) as collection -> raw rows. */
function sourceOf(body: Data): Record<string, unknown[]> | null {
  if (body.seed === true) {
    const out: Record<string, unknown[]> = {};
    for (const [c, rows] of Object.entries(SEED)) {
      out[c] = rows.map((r, i) => ({ id: `${c.slice(0, 2)}seed${String(i + 1).padStart(3, "0")}`, ...r }));
    }
    return out;
  }
  return isObj(body.backup) ? (body.backup as Record<string, unknown[]>) : null;
}

const badSource = (c: Ctx, field = "backup") => c.json({ error: "invalid", field }, 400);

/** Every named collection present must be an array. Returns the offending name. */
const badCollection = (src: Record<string, unknown>) =>
  [...COLLECTIONS, ...SKIPPED_COLLECTIONS].find((k) => src[k] !== undefined && !Array.isArray(src[k]));

export const importRoutes = new Hono<AppEnv>();
importRoutes.use("*", requireUser);
importRoutes.use("*", async (c, next) => {
  if (!canImport(c.var.user!)) return c.json({ error: "forbidden" }, 403);
  await next();
});

importRoutes.post("/preview", async (c) => {
  const r = await readJson(c);
  if (r instanceof Response) return r;
  const src = sourceOf(r.body);
  if (!src) return badSource(c);
  const bad = badCollection(src);
  if (bad) return badSource(c, bad);
  const counts: Record<string, number> = {};
  const owners = new Set<string>();
  for (const k of [...COLLECTIONS, ...SKIPPED_COLLECTIONS]) {
    const rows = (src[k] as unknown[] | undefined) ?? [];
    if (rows.length) counts[k] = rows.length;
    if (SKIPPED_COLLECTIONS.includes(k)) continue;
    for (const row of rows) {
      if (!isObj(row)) continue;
      for (const key of k === "access" ? ["owner", "holder"] : ["owner"]) if (str(row[key])) owners.add(str(row[key]));
    }
  }
  return c.json({ counts, owners: [...owners].sort((a, b) => a.localeCompare(b)) });
});

interface Importer { id: string; dept: string }
interface TaskPlan {
  id: string; title: string; notes: string | null; dept: string; assigneeId: string | null; priority: string | null;
  status: string; due: string | null; waitingOn: string | null; links: string[]; createdAt: string; updatedAt: string;
}
interface RecordPlan {
  id: string; collection: string; dept: string; ownerId: string | null; title: string; data: Data;
  createdAt: string; updatedAt: string;
}

const isoOr = (v: unknown, fallback: string) => {
  if (typeof v !== "string") return fallback;
  const t = Date.parse(v);
  return Number.isNaN(t) ? fallback : new Date(t).toISOString();
};

function planTask(row: Data, id: string, ctx: PlanCtx): TaskPlan {
  const warn = (field: string) => ctx.warnings.push({ collection: "tasks", id, field });
  const text = (key: string, max: number): string | null => {
    const v = row[key];
    if (v === undefined || v === null || v === "") return null;
    if (typeof v !== "string" || v.trim().length > max) {
      warn(key);
      return null;
    }
    return v.trim() || null;
  };
  let title = text("title", 300);
  if (!title) {
    if (row.title === undefined || row.title === null || row.title === "") warn("title");
    title = "(untitled task)";
  }
  const owner = ownerOf(row, ctx);
  const assignee = owner ? ctx.users.get(owner) ?? null : null;

  let dept = typeof row.dept === "string" && DEPT_NAMES.includes(row.dept) ? row.dept : null;
  if (!dept) {
    if (row.dept !== undefined && row.dept !== null && row.dept !== "") warn("dept");
    dept = assignee?.dept ?? ctx.importer.dept;
  }

  let status = "To do";
  const rawStatus = row.status;
  if (rawStatus === "To be given") status = "Waiting";
  else if (rawStatus === "Not done") status = "Blocked";
  else if ((TASK_STATUSES as readonly string[]).includes(rawStatus as string)) status = rawStatus as string;
  else if (rawStatus !== undefined && rawStatus !== null && rawStatus !== "") warn("status");

  let priority: string | null = null;
  if ((TASK_PRIORITIES as readonly string[]).includes(row.priority as string)) priority = row.priority as string;
  else if (row.priority !== undefined && row.priority !== null && row.priority !== "") warn("priority");

  let due: string | null = null;
  if (typeof row.due === "string" && isDateString(row.due)) due = row.due;
  else if (row.due !== undefined && row.due !== null && row.due !== "") warn("due");

  let links: string[] = [];
  if (row.links !== undefined && row.links !== null) {
    const l = cleanLegacyLinks(row.links);
    links = l.links.map((x) => x.url);
    if (l.dropped) warn("links");
  }
  const now = ctx.now;
  const createdAt = isoOr(row.createdAt, now);
  return {
    id, title, notes: text("notes", 5000), dept, assigneeId: owner, priority, status, due,
    waitingOn: text("givenBy", 300), links, createdAt, updatedAt: isoOr(row.updatedAt, now),
  };
}

function planRecord(collection: string, row: Data, id: string, ctx: PlanCtx): RecordPlan {
  const reg = REGISTERS.find((r) => r.id === collection)!;
  const warned = new Set<string>();
  const warn = (field: string) => {
    if (warned.has(field)) return;
    warned.add(field);
    ctx.warnings.push({ collection, id, field });
  };
  const data = cleanLegacyData(reg, row, warn);
  if (reg.fields.some((f) => f.key === reg.statusKey) && data[reg.statusKey] === undefined) data[reg.statusKey] = reg.statuses[0].v;
  for (const f of reg.fields) if (f.required && (data[f.key] === undefined || data[f.key] === "")) warn(f.key);
  const owners = registerDepts(reg.id);
  return {
    id, collection, dept: owners.length === 1 ? owners[0] : ctx.importer.dept, ownerId: ownerOf(row, ctx),
    title: titleOf(reg, data), data, createdAt: isoOr(row.createdAt, ctx.now), updatedAt: isoOr(row.updatedAt, ctx.now),
  };
}

interface PlanCtx {
  importer: Importer;
  ownerMap: Record<string, string | null>;
  users: Map<string, { dept: string }>;
  warnings: Warning[];
  now: string;
}

const ownerOf = (row: Data, ctx: PlanCtx): string | null => {
  const name = str(row.owner);
  return name && Object.hasOwn(ctx.ownerMap, name) ? ctx.ownerMap[name] : null;
};

async function selectIn<T>(db: D1Database, sql: (ph: string) => string, ids: string[]): Promise<T[]> {
  const out: T[] = [];
  for (const part of chunks(ids)) {
    const { results } = await db.prepare(sql(part.map(() => "?").join(","))).bind(...part).all<T>();
    out.push(...results);
  }
  return out;
}

importRoutes.post("/", async (c) => {
  const u = c.var.user as SessionUser;
  const db = c.env.DB;
  const r = await readJson(c);
  if (r instanceof Response) return r;
  const src = sourceOf(r.body);
  if (!src) return badSource(c);
  const bad = badCollection(src);
  if (bad) return badSource(c, bad);
  const om = OwnerMap.safeParse(r.body.ownerMap ?? {});
  if (!om.success) return badSource(c, "ownerMap");
  const ownerMap = om.data;

  // Every mapped user must exist and not have left.
  const mappedIds = [...new Set(Object.values(ownerMap).filter((v): v is string => !!v))];
  const found = await selectIn<{ id: string; dept: string; status: string }>(
    db, (ph) => `SELECT id, dept, status FROM users WHERE id IN (${ph})`, mappedIds,
  );
  const users = new Map(found.filter((x) => x.status !== "left").map((x) => [x.id, { dept: x.dept }]));
  if (mappedIds.some((id) => !users.has(id))) return badSource(c, "ownerMap");

  const now = new Date().toISOString();
  const ctx: PlanCtx = { importer: { id: u.id, dept: u.dept }, ownerMap, users, warnings: [], now };
  let skipped = SKIPPED_COLLECTIONS.reduce((n, k) => n + ((src[k] as unknown[] | undefined)?.length ?? 0), 0);

  const tasks = new Map<string, TaskPlan>();
  const recs = new Map<string, RecordPlan>();
  for (const collection of COLLECTIONS) {
    for (const row of (src[collection] as unknown[] | undefined) ?? []) {
      if (!isObj(row)) {
        skipped++;
        ctx.warnings.push({ collection, id: "", field: "row" });
        continue;
      }
      let id = typeof row.id === "string" ? row.id.trim() : typeof row.id === "number" ? String(row.id) : "";
      if (!id || id.length > 100) {
        ctx.warnings.push({ collection, id: "", field: "id" });
        id = crypto.randomUUID();
      }
      const dup = collection === "tasks" ? tasks.has(id) : recs.has(id);
      if (dup) {
        skipped++;
        ctx.warnings.push({ collection, id, field: "id" });
        continue;
      }
      if (collection === "tasks") tasks.set(id, planTask(row, id, ctx));
      else recs.set(id, planRecord(collection, row, id, ctx));
    }
  }

  // What already exists decides created vs updated, and protects other registers' ids.
  const existingTasks = new Set(
    (await selectIn<{ id: string }>(db, (ph) => `SELECT id FROM tasks WHERE id IN (${ph})`, [...tasks.keys()])).map((x) => x.id),
  );
  const existingRecs = new Map(
    (await selectIn<{ id: string; collection: string }>(db, (ph) => `SELECT id, collection FROM records WHERE id IN (${ph})`, [...recs.keys()])).map(
      (x) => [x.id, x.collection],
    ),
  );

  let created = 0;
  let updated = 0;
  const stmts: D1PreparedStatement[] = [];
  for (const t of tasks.values()) {
    if (existingTasks.has(t.id)) updated++;
    else created++;
    stmts.push(
      db
        .prepare(
          `INSERT INTO tasks (id, title, notes, dept, assignee_id, assigned_by_id, priority, status, due, waiting_on, links, version, created_at, updated_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET title = excluded.title, notes = excluded.notes, dept = excluded.dept,
             assignee_id = excluded.assignee_id, assigned_by_id = excluded.assigned_by_id, priority = excluded.priority,
             status = excluded.status, due = excluded.due, waiting_on = excluded.waiting_on, links = excluded.links,
             version = tasks.version + 1, updated_at = excluded.updated_at, completed_at = excluded.completed_at`,
        )
        .bind(
          t.id, t.title, t.notes, t.dept, t.assigneeId, u.id, t.priority, t.status, t.due, t.waitingOn, JSON.stringify(t.links),
          t.createdAt, t.updatedAt, t.status === "Done" ? t.updatedAt : null,
        ),
    );
  }
  for (const p of recs.values()) {
    const other = existingRecs.get(p.id);
    if (other && other !== p.collection) {
      skipped++;
      ctx.warnings.push({ collection: p.collection, id: p.id, field: "id" });
      continue;
    }
    if (other) updated++;
    else created++;
    stmts.push(
      db
        .prepare(
          `INSERT INTO records (id, collection, dept, owner_id, title, data, version, created_at, created_by, updated_at, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET dept = excluded.dept, owner_id = excluded.owner_id, title = excluded.title,
             data = excluded.data, version = records.version + 1, updated_at = excluded.updated_at, updated_by = excluded.updated_by
           WHERE records.collection = excluded.collection`,
        )
        .bind(p.id, p.collection, p.dept, p.ownerId, p.title, JSON.stringify(p.data), p.createdAt, u.id, p.updatedAt, u.id),
    );
  }

  for (const part of chunks(stmts)) await db.batch(part);
  const detail = { created, updated, skipped, warnings: ctx.warnings.length };
  await db.batch([auditStmt(db, u, "import", "import", null, r.body.seed === true ? "Starting records" : "Old CRM backup", detail)]);
  return c.json({ created, updated, skipped, warnings: ctx.warnings });
});
