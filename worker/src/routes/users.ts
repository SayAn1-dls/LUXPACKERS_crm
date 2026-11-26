import { Hono } from "hono";
import { z } from "zod";
import { DEPT_NAMES, EMPLOYEE_POSITION_ID, ONBOARDING_STEPS, ROLES } from "../../../shared/schema";
import type { AppEnv, Role } from "../env";
import { auditStmt, auditStmtWhen } from "../lib/audit";
import { notifyStmts } from "../lib/notify";
import { canAddPeople, canCreateUserWithPosition, canEditUsers, canSeePeoplePrivate } from "../lib/policy";
import { parsePerms, roleLabel } from "../lib/positions";
import { requireUser } from "../lib/session";

const Dept = z.string().refine((d) => DEPT_NAMES.includes(d), "unknown department");
const Kind = z.enum(["Full-time", "Intern", "Freelancer"]);
const Status = z.enum(["active", "onboarding", "left"]);
const Date10 = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Text = (n: number) => z.string().trim().max(n);
const Email = z.string().trim().toLowerCase().email().max(320);
const PositionId = z.string().min(1).max(100);

const CreateBody = z.object({
  name: Text(200).min(1),
  email: Email,
  positionId: PositionId.optional(),
  /** Deprecated: maps to the matching starter position when positionId is absent. */
  role: z.enum(ROLES).optional(),
  dept: Dept,
  managerId: z.string().min(1).nullish(),
  title: Text(200).nullish(),
  phone: Text(50).nullish(),
  kind: Kind,
  joinedOn: Date10.nullish(),
  status: Status,
});

const PatchBody = z.object({
  name: Text(200).min(1).optional(),
  email: Email.optional(),
  positionId: PositionId.optional(),
  /** Deprecated: maps to the matching starter position when positionId is absent. */
  role: z.enum(ROLES).optional(),
  dept: Dept.optional(),
  managerId: z.string().min(1).nullable().optional(),
  title: Text(200).nullable().optional(),
  phone: Text(50).nullable().optional(),
  kind: Kind.nullable().optional(),
  joinedOn: Date10.nullable().optional(),
  status: Status.optional(),
});

const ApproveBody = z.object({ positionId: PositionId, dept: Dept, managerId: z.string().min(1).nullish() });

/** Passwords are gone: a body that still carries one is refused rather than silently ignored. */
const hasPassword = (b: unknown) => !!b && typeof b === "object" && ("password" in b || "mustChangePassword" in b);
const GOOGLE_ONLY = { error: "google_only" } as const;

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  dept: string;
  manager_id: string | null;
  title: string | null;
  phone: string | null;
  kind: string | null;
  joined_on: string | null;
  status: string;
  approval: string;
  created_at: string;
  updated_at: string;
  position_id: string | null;
  position_name: string | null;
  position_is_admin: number | null;
  totp_enabled_at: string | null;
}

const SELECT = `SELECT u.id, u.email, u.name, u.role, u.dept, u.manager_id, u.title, u.phone, u.kind, u.joined_on, u.status, u.approval,
    u.created_at, u.updated_at, u.position_id, u.totp_enabled_at, p.name AS position_name, p.is_admin AS position_is_admin
  FROM users u LEFT JOIN positions p ON p.id = u.position_id`;

const loadUser = (db: D1Database, id: string) => db.prepare(`${SELECT} WHERE u.id = ?`).bind(id).first<UserRow>();

/** Never includes the Google id, password leftovers or anything about the two-step secret beyond on/off. */
const toApi = (r: UserRow) => ({
  id: r.id,
  email: r.email,
  name: r.name,
  role: r.role,
  positionId: r.position_id,
  positionName: r.position_name,
  isAdmin: r.position_is_admin === 1,
  dept: r.dept,
  managerId: r.manager_id,
  title: r.title,
  phone: r.phone,
  kind: r.kind,
  joinedOn: r.joined_on,
  status: r.status,
  /** "pending" / "declined": asked to join with Google; shown in the Waiting tab, nowhere else. */
  approval: r.approval,
  mfaEnabled: !!r.totp_enabled_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

interface PositionRow { id: string; name: string; is_admin: number; perms: string }
const loadPosition = (db: D1Database, id: string) =>
  db.prepare("SELECT id, name, is_admin, perms FROM positions WHERE id = ?").bind(id).first<PositionRow>();
const labelOf = (p: PositionRow) => roleLabel(p.is_admin === 1, parsePerms(p.perms));

async function managerOk(db: D1Database, managerId: string, selfId: string | null): Promise<boolean> {
  if (managerId === selfId) return false;
  const m = await db.prepare("SELECT status, approval FROM users WHERE id = ?").bind(managerId).first<{ status: string; approval: string }>();
  return !!m && m.status !== "left" && m.approval === "approved";
}

/** Active admins other than `exceptId`. */
const OTHER_ADMINS = `SELECT COUNT(*) AS n FROM users ou JOIN positions op ON op.id = ou.position_id
  WHERE op.is_admin = 1 AND ou.status != 'left' AND ou.approval = 'approved' AND ou.id != ?`;

const isUnique = (e: unknown) => /UNIQUE/i.test(String((e as Error)?.message ?? "") + String((e as Error)?.cause ?? ""));

export const users = new Hono<AppEnv>();

users.use("*", requireUser);

users.get("/", async (c) => {
  if (!canSeePeoplePrivate(c.var.user!)) return c.json({ error: "forbidden" }, 403);
  const { results } = await c.env.DB.prepare(`${SELECT} ORDER BY u.name COLLATE NOCASE`).all<UserRow>();
  return c.json({ users: results.map(toApi) });
});

users.post("/", async (c) => {
  const actor = c.var.user!;
  if (!canAddPeople(actor)) return c.json({ error: "forbidden" }, 403);
  const raw = await c.req.json().catch(() => null);
  if (hasPassword(raw)) return c.json(GOOGLE_ONLY, 410);
  const parsed = CreateBody.safeParse(raw);
  if (!parsed.success) return c.json({ error: "invalid" }, 400);
  const b = parsed.data;
  const positionId = b.positionId ?? (b.role ? `pos_${b.role}` : EMPLOYEE_POSITION_ID);
  if (!canCreateUserWithPosition(actor, positionId)) return c.json({ error: "forbidden" }, 403);
  const db = c.env.DB;
  const position = await loadPosition(db, positionId);
  if (!position) return c.json({ error: "invalid_position" }, 400);
  if (b.managerId && !(await managerOk(db, b.managerId, null))) return c.json({ error: "invalid_manager" }, 400);
  if (await db.prepare("SELECT 1 FROM users WHERE email = ?").bind(b.email).first()) {
    return c.json({ error: "email_taken" }, 409);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const role = labelOf(position);
  const stmts = [
    db
      .prepare(
        `INSERT INTO users (id, email, name, role, position_id, dept, manager_id, title, phone, kind, joined_on, status,
                            approval, password_hash, password_salt, must_change_password, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', 'google-only', '', 0, ?, ?)`,
      )
      .bind(
        id, b.email, b.name, role, position.id, b.dept, b.managerId ?? null, b.title ?? null, b.phone ?? null,
        b.kind, b.joinedOn ?? null, b.status, now, now,
      ),
  ];
  if (b.status === "onboarding") {
    const ins = db.prepare(
      "INSERT INTO onboarding (id, user_id, step, done, done_by, done_at) VALUES (?, ?, ?, ?, ?, ?)",
    );
    ONBOARDING_STEPS.forEach((step, i) => {
      stmts.push(
        i === 0
          ? ins.bind(crypto.randomUUID(), id, step, 1, actor.id, now)
          : ins.bind(crypto.randomUUID(), id, step, 0, null, null),
      );
    });
  }
  // People with full people access (not admins) hear about new accounts.
  const hrs = await db
    .prepare(
      `SELECT u.id FROM users u JOIN positions p ON p.id = u.position_id
       WHERE p.is_admin = 0 AND json_extract(p.perms, '$.people') = 'full' AND u.status != 'left'`,
    )
    .all<{ id: string }>();
  stmts.push(...notifyStmts(db, hrs.results.map((r) => r.id).filter((x) => x !== actor.id), "user_created", `New account created: ${b.name}`, "/people"));
  // An account made by someone other than an admin is also announced to every active admin.
  if (!actor.isAdmin) {
    const admins = await db
      .prepare("SELECT u.id FROM users u JOIN positions p ON p.id = u.position_id WHERE p.is_admin = 1 AND u.status != 'left'")
      .all<{ id: string }>();
    stmts.push(...notifyStmts(db, admins.results.map((r) => r.id), "user_created", `${actor.name} created an account: ${b.name}`, "/users"));
  }
  stmts.push(
    auditStmt(db, actor, "user_created", "user", id, b.name, {
      positionId: position.id, dept: b.dept, status: b.status,
    }),
  );
  try {
    await db.batch(stmts);
  } catch (e) {
    if (isUnique(e)) return c.json({ error: "email_taken" }, 409);
    throw e;
  }
  return c.json({ user: toApi((await loadUser(db, id))!) }, 201);
});

const COLUMN: Record<string, string> = {
  name: "name", email: "email", positionId: "position_id", dept: "dept", managerId: "manager_id", title: "title",
  phone: "phone", kind: "kind", joinedOn: "joined_on", status: "status",
};

const CURRENT: Record<string, (r: UserRow) => unknown> = {
  name: (r) => r.name, email: (r) => r.email, positionId: (r) => r.position_id, dept: (r) => r.dept,
  managerId: (r) => r.manager_id, title: (r) => r.title, phone: (r) => r.phone, kind: (r) => r.kind,
  joinedOn: (r) => r.joined_on, status: (r) => r.status,
};

users.patch("/:id", async (c) => {
  const actor = c.var.user!;
  if (!canEditUsers(actor)) return c.json({ error: "forbidden" }, 403);
  const db = c.env.DB;
  const id = c.req.param("id");
  const target = await loadUser(db, id);
  if (!target) return c.json({ error: "not_found" }, 404);
  const raw = await c.req.json().catch(() => null);
  if (hasPassword(raw)) return c.json(GOOGLE_ONLY, 410);
  const parsed = PatchBody.safeParse(raw);
  if (!parsed.success) return c.json({ error: "invalid" }, 400);
  const { role, ...rest } = parsed.data;
  const body: Record<string, unknown> = { ...rest };
  if (body.positionId === undefined && role !== undefined) body.positionId = `pos_${role}`;
  const supplied = Object.keys(body).filter((k) => body[k] !== undefined);
  if (supplied.length === 0) return c.json({ error: "invalid" }, 400);
  const self = actor.id === id;

  // Only values that actually differ count as changes.
  const fields = supplied.filter((k) => body[k] !== CURRENT[k](target));
  if (fields.length === 0) return c.json({ user: toApi(target) });

  let position: PositionRow | null = null;
  if (fields.includes("positionId")) {
    position = await loadPosition(db, body.positionId as string);
    if (!position) return c.json({ error: "invalid_position" }, 400);
  }
  const disabling = fields.includes("status") && body.status === "left";
  const wasAdmin = target.position_is_admin === 1 && target.status !== "left";
  const losesAdmin = wasAdmin && (disabling || (position !== null && position.is_admin !== 1));
  if (losesAdmin) {
    const others = await db.prepare(OTHER_ADMINS).bind(id).first<{ n: number }>();
    if ((others?.n ?? 0) === 0) return c.json({ error: "last_admin" }, 409);
  }
  // Your own position and status are not changed from here.
  if (self && (fields.includes("positionId") || disabling)) return c.json({ error: "forbidden" }, 403);
  if (typeof body.managerId === "string" && fields.includes("managerId") && !(await managerOk(db, body.managerId, id))) {
    return c.json({ error: "invalid_manager" }, 400);
  }
  if (fields.includes("email") && (await db.prepare("SELECT 1 FROM users WHERE email = ? AND id != ?").bind(body.email, id).first())) {
    return c.json({ error: "email_taken" }, 409);
  }

  const now = new Date().toISOString();
  const sets = fields.map((k) => `${COLUMN[k]} = ?`);
  const vals: unknown[] = fields.map((k) => body[k]);
  if (position) {
    sets.push("role = ?");
    vals.push(labelOf(position));
  }
  // Re-checked inside the write so two admins demoting each other at once cannot leave none.
  const guard = losesAdmin ? ` AND (${OTHER_ADMINS}) > 0` : "";
  // Every follow-up only runs if the UPDATE above really happened (it stamps this request's updated_at), so a
  // write that changed nothing (lost last-admin race) leaves no sessions deleted and no audit behind.
  const done = { sql: "EXISTS (SELECT 1 FROM users WHERE id = ? AND updated_at = ?)", args: [id, now] };
  const stmts = [
    db
      .prepare(`UPDATE users SET ${sets.join(", ")}, updated_at = ? WHERE id = ?${guard}`)
      .bind(...vals, now, id, ...(losesAdmin ? [id] : [])),
  ];
  if (disabling) {
    stmts.push(db.prepare(`DELETE FROM sessions WHERE user_id = ? AND ${done.sql}`).bind(id, ...done.args));
  }
  // Access changed: a half-finished sign-in (Google done, code owed) must not carry on under the old access.
  if (disabling || position) {
    stmts.push(db.prepare(`DELETE FROM mfa_pending WHERE user_id = ? AND ${done.sql}`).bind(id, ...done.args));
  }
  if (disabling) stmts.push(auditStmtWhen(db, done, actor, "user_disabled", "user", id, target.name));
  const others = disabling ? fields.filter((f) => f !== "status") : fields;
  if (others.length > 0) stmts.push(auditStmtWhen(db, done, actor, "user_updated", "user", id, target.name, { fields: others }));
  let res: D1Result[];
  try {
    res = await db.batch(stmts);
  } catch (e) {
    if (isUnique(e)) return c.json({ error: "email_taken" }, 409);
    throw e;
  }
  if (res[0].meta.changes === 0) return c.json({ error: "last_admin" }, 409);

  return c.json({ user: toApi((await loadUser(db, id))!) });
});

/** Passwords are gone: Google is the only way in. */
users.post("/:id/password", (c) => c.json(GOOGLE_ONLY, 410));

/* ---------- people asking to join (Google sign-in by someone unknown) ---------- */

/** Let someone in: their position (any, Admin included), department and optional manager. They are told. */
users.post("/:id/approve", async (c) => {
  const actor = c.var.user!;
  if (!canEditUsers(actor)) return c.json({ error: "forbidden" }, 403);
  const db = c.env.DB;
  const id = c.req.param("id");
  const target = await loadUser(db, id);
  if (!target) return c.json({ error: "not_found" }, 404);
  const parsed = ApproveBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid" }, 400);
  const b = parsed.data;
  if (target.approval !== "pending") return c.json({ error: "not_waiting" }, 409);
  const position = await loadPosition(db, b.positionId);
  if (!position) return c.json({ error: "invalid_position" }, 400);
  if (b.managerId && !(await managerOk(db, b.managerId, id))) return c.json({ error: "invalid_manager" }, 400);
  const now = new Date().toISOString();
  const done = { sql: "EXISTS (SELECT 1 FROM users WHERE id = ? AND approval = 'approved' AND updated_at = ?)", args: [id, now] };
  const res = await db.batch([
    db
      .prepare(
        `UPDATE users SET approval = 'approved', status = 'active', position_id = ?, role = ?, dept = ?, manager_id = ?, updated_at = ?
          WHERE id = ? AND approval = 'pending'`,
      )
      .bind(position.id, labelOf(position), b.dept, b.managerId ?? null, now, id),
    db.prepare(`DELETE FROM mfa_pending WHERE user_id = ? AND ${done.sql}`).bind(id, ...done.args),
    db
      .prepare(
        `INSERT INTO notifications (id, user_id, kind, title, link, read_at, created_at)
         SELECT ?, ?, 'access_approved', ?, '/', NULL, ? WHERE ${done.sql}`,
      )
      .bind(crypto.randomUUID(), id, "You're in. Welcome to the Luxpackers desk.", now, ...done.args),
    auditStmtWhen(db, done, actor, "access_approved", "user", id, target.name, { positionId: position.id, dept: b.dept }),
  ]);
  if (res[0].meta.changes !== 1) return c.json({ error: "not_waiting" }, 409);
  return c.json({ user: toApi((await loadUser(db, id))!) });
});

/** Turn someone away. They are signed out and see "Your request wasn't approved" if they try again. */
users.post("/:id/decline", async (c) => {
  const actor = c.var.user!;
  if (!canEditUsers(actor)) return c.json({ error: "forbidden" }, 403);
  const db = c.env.DB;
  const id = c.req.param("id");
  const target = await loadUser(db, id);
  if (!target) return c.json({ error: "not_found" }, 404);
  const now = new Date().toISOString();
  const done = { sql: "EXISTS (SELECT 1 FROM users WHERE id = ? AND approval = 'declined' AND updated_at = ?)", args: [id, now] };
  const res = await db.batch([
    db.prepare("UPDATE users SET approval = 'declined', updated_at = ? WHERE id = ? AND approval = 'pending'").bind(now, id),
    db.prepare(`DELETE FROM sessions WHERE user_id = ? AND ${done.sql}`).bind(id, ...done.args),
    db.prepare(`DELETE FROM mfa_pending WHERE user_id = ? AND ${done.sql}`).bind(id, ...done.args),
    auditStmtWhen(db, done, actor, "access_declined", "user", id, target.name),
  ]);
  if (res[0].meta.changes !== 1) return c.json({ error: "not_waiting" }, 409);
  return c.json({ user: toApi((await loadUser(db, id))!) });
});

/** Undo a decline: back to Waiting, where they can be approved. */
users.post("/:id/undecline", async (c) => {
  const actor = c.var.user!;
  if (!canEditUsers(actor)) return c.json({ error: "forbidden" }, 403);
  const db = c.env.DB;
  const id = c.req.param("id");
  const target = await loadUser(db, id);
  if (!target) return c.json({ error: "not_found" }, 404);
  const now = new Date().toISOString();
  const done = { sql: "EXISTS (SELECT 1 FROM users WHERE id = ? AND approval = 'pending' AND updated_at = ?)", args: [id, now] };
  const res = await db.batch([
    db.prepare("UPDATE users SET approval = 'pending', updated_at = ? WHERE id = ? AND approval = 'declined'").bind(now, id),
    auditStmtWhen(db, done, actor, "access_decline_undone", "user", id, target.name),
  ]);
  if (res[0].meta.changes !== 1) return c.json({ error: "not_declined" }, 409);
  return c.json({ user: toApi((await loadUser(db, id))!) });
});

/** Admin clears someone else's two-step sign-in (lost phone). Signs them out everywhere; they enrol again. */
users.post("/:id/mfa/reset", async (c) => {
  const actor = c.var.user!;
  if (!canEditUsers(actor)) return c.json({ error: "forbidden" }, 403);
  const db = c.env.DB;
  const id = c.req.param("id");
  if (actor.id === id) return c.json({ error: "forbidden" }, 403);
  const target = await loadUser(db, id);
  if (!target) return c.json({ error: "not_found" }, 404);
  await db.batch([
    db
      .prepare("UPDATE users SET totp_secret_enc = NULL, totp_enabled_at = NULL, totp_last_step = NULL, updated_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), id),
    db.prepare("DELETE FROM mfa_backup_codes WHERE user_id = ?").bind(id),
    db.prepare("DELETE FROM mfa_pending WHERE user_id = ?").bind(id),
    db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id),
    auditStmt(db, actor, "mfa_reset", "user", id, target.name, { wasEnabled: !!target.totp_enabled_at }),
  ]);
  return c.json({ ok: true });
});
