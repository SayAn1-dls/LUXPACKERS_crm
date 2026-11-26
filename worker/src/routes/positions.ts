import { Hono } from "hono";
import { z } from "zod";
import type { Perms, Position } from "../../../shared/schema";
import type { AppEnv } from "../env";
import { auditStmt, auditStmtWhen } from "../lib/audit";
import { canManagePositions } from "../lib/policy";
import { BUILT_IN, PermsSchema, parsePerms, roleLabel } from "../lib/positions";
import { requireUser } from "../lib/session";

const Name = z.string().trim().min(1).max(80);
// Strict: isAdmin can never be set or toggled through the API (only the built-in Admin position is an admin).
const CreateBody = z.object({ name: Name, perms: PermsSchema }).strict();
const PatchBody = z.object({ name: Name.optional(), perms: PermsSchema.optional() }).strict();

interface Row { id: string; name: string; is_admin: number; perms: string; created_at: string; updated_at: string; members: number }

const SELECT = `SELECT p.*, (SELECT COUNT(*) FROM users u WHERE u.position_id = p.id) AS members FROM positions p`;

const toApi = (r: Row): Position => ({
  id: r.id,
  name: r.name,
  isAdmin: r.is_admin === 1,
  builtIn: BUILT_IN.has(r.id),
  perms: parsePerms(r.perms),
  memberCount: r.members,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const load = (db: D1Database, id: string) => db.prepare(`${SELECT} WHERE p.id = ?`).bind(id).first<Row>();
const isUnique = (e: unknown) => /UNIQUE/i.test(String((e as Error)?.message ?? "") + String((e as Error)?.cause ?? ""));

export const positions = new Hono<AppEnv>();
positions.use("*", requireUser);
positions.use("*", async (c, next) => {
  if (!canManagePositions(c.var.user!)) return c.json({ error: "forbidden" }, 403);
  await next();
});

positions.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(`${SELECT} ORDER BY p.is_admin DESC, p.name COLLATE NOCASE`).all<Row>();
  return c.json({ positions: results.map(toApi) });
});

positions.post("/", async (c) => {
  const parsed = CreateBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid" }, 400);
  const { name, perms } = parsed.data;
  const db = c.env.DB;
  const id = `pos_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const now = new Date().toISOString();
  try {
    await db.batch([
      db
        .prepare("INSERT INTO positions (id, name, is_admin, perms, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?)")
        .bind(id, name, JSON.stringify(perms), now, now),
      auditStmt(db, c.var.user!, "position_created", "position", id, name, { perms }),
    ]);
  } catch (e) {
    if (isUnique(e)) return c.json({ error: "name_taken" }, 409);
    throw e;
  }
  return c.json({ position: toApi((await load(db, id))!) }, 201);
});

positions.patch("/:id", async (c) => {
  const db = c.env.DB;
  const row = await load(db, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  const parsed = PatchBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid" }, 400);
  const { name, perms } = parsed.data;
  // The Admin position has every permission regardless; its perms are not editable.
  if (perms !== undefined && row.is_admin === 1) return c.json({ error: "builtin" }, 409);
  const fields: string[] = [];
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (name !== undefined && name !== row.name) {
    fields.push("name");
    sets.push("name = ?");
    vals.push(name);
  }
  if (perms !== undefined && JSON.stringify(perms) !== JSON.stringify(parsePerms(row.perms))) {
    fields.push("perms");
    sets.push("perms = ?");
    vals.push(JSON.stringify(perms));
  }
  if (fields.length === 0) return c.json({ position: toApi(row) });
  const now = new Date().toISOString();
  const stmts = [db.prepare(`UPDATE positions SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).bind(...vals, now, row.id)];
  // Keep the members' display label in step with what the position now allows.
  if (perms !== undefined) {
    stmts.push(db.prepare("UPDATE users SET role = ? WHERE position_id = ?").bind(roleLabel(false, perms as Perms), row.id));
  }
  stmts.push(auditStmt(db, c.var.user!, "position_updated", "position", row.id, name ?? row.name, { fields, ...(perms ? { perms } : {}) }));
  try {
    await db.batch(stmts);
  } catch (e) {
    if (isUnique(e)) return c.json({ error: "name_taken" }, 409);
    throw e;
  }
  return c.json({ position: toApi((await load(db, row.id))!) });
});

positions.delete("/:id", async (c) => {
  const db = c.env.DB;
  const row = await load(db, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  if (BUILT_IN.has(row.id) || row.is_admin === 1) return c.json({ error: "builtin" }, 409);
  if (row.members > 0) return c.json({ error: "in_use", members: row.members }, 409);
  const res = await db.batch([
    db.prepare("DELETE FROM positions WHERE id = ? AND NOT EXISTS (SELECT 1 FROM users WHERE position_id = ?)").bind(row.id, row.id),
    // Only audited if the DELETE above really removed the row.
    auditStmtWhen(db, { sql: "NOT EXISTS (SELECT 1 FROM positions WHERE id = ?)", args: [row.id] }, c.var.user!, "position_deleted", "position", row.id, row.name),
  ]);
  if (res[0].meta.changes === 0) return c.json({ error: "in_use" }, 409);
  return c.json({ ok: true });
});
