import { Hono } from "hono";
import { z } from "zod";
import { DEPT_NAMES, ONBOARDING_STEPS, ROLES } from "../../../shared/schema";
import type { AppEnv, Role, SessionUser } from "../env";
import { auditStmt } from "../lib/audit";
import { hashPassword } from "../lib/crypto";
import { notifyStmts } from "../lib/notify";
import { canChangeRole, canEditProfile, canManageUser } from "../lib/policy";
import { requireUser } from "../lib/session";

// No 0/O/1/l/I. 24 + 25 + 8 = 57 characters.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const TEMP_LEN = 12;

/** Unbiased: bytes at or above the largest multiple of the alphabet size are discarded. */
export function generateTempPassword(): string {
  const limit = 256 - (256 % ALPHABET.length);
  let out = "";
  while (out.length < TEMP_LEN) {
    for (const b of crypto.getRandomValues(new Uint8Array(32))) {
      if (b < limit && out.length < TEMP_LEN) out += ALPHABET[b % ALPHABET.length];
    }
  }
  return out;
}

const Dept = z.string().refine((d) => DEPT_NAMES.includes(d), "unknown department");
const Kind = z.enum(["Full-time", "Intern", "Freelancer"]);
const Status = z.enum(["active", "onboarding", "left"]);
const Date10 = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Text = (n: number) => z.string().trim().max(n);

const CreateBody = z.object({
  name: Text(200).min(1),
  email: z.string().trim().toLowerCase().email().max(320),
  role: z.enum(ROLES),
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
  role: z.enum(ROLES).optional(),
  dept: Dept.optional(),
  managerId: z.string().min(1).nullable().optional(),
  title: Text(200).nullable().optional(),
  phone: Text(50).nullable().optional(),
  kind: Kind.nullable().optional(),
  joinedOn: Date10.nullable().optional(),
  status: Status.optional(),
});

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
  created_at: string;
  updated_at: string;
}

const PUBLIC_COLS =
  "id, email, name, role, dept, manager_id, title, phone, kind, joined_on, status, created_at, updated_at";

const toApi = (r: UserRow) => ({
  id: r.id,
  email: r.email,
  name: r.name,
  role: r.role,
  dept: r.dept,
  managerId: r.manager_id,
  title: r.title,
  phone: r.phone,
  kind: r.kind,
  joinedOn: r.joined_on,
  status: r.status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

async function managerOk(db: D1Database, managerId: string, selfId: string | null): Promise<boolean> {
  if (managerId === selfId) return false;
  const m = await db.prepare("SELECT status FROM users WHERE id = ?").bind(managerId).first<{ status: string }>();
  return !!m && m.status !== "left";
}

const isUnique = (e: unknown) => /UNIQUE/i.test(String((e as Error)?.message ?? "") + String((e as Error)?.cause ?? ""));

export const users = new Hono<AppEnv>();

users.use("*", requireUser);

function staffOnly(u: SessionUser): boolean {
  return u.role === "admin" || u.role === "hr";
}

users.get("/", async (c) => {
  if (!staffOnly(c.var.user!)) return c.json({ error: "forbidden" }, 403);
  const { results } = await c.env.DB.prepare(`SELECT ${PUBLIC_COLS} FROM users ORDER BY name COLLATE NOCASE`).all<UserRow>();
  return c.json({ users: results.map(toApi) });
});

users.post("/", async (c) => {
  const actor = c.var.user!;
  const parsed = CreateBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid" }, 400);
  const b = parsed.data;
  if (!canManageUser(actor, b.role)) return c.json({ error: "forbidden" }, 403);
  const db = c.env.DB;
  if (b.managerId && !(await managerOk(db, b.managerId, null))) return c.json({ error: "invalid_manager" }, 400);
  if (await db.prepare("SELECT 1 FROM users WHERE email = ?").bind(b.email).first()) {
    return c.json({ error: "email_taken" }, 409);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const tempPassword = generateTempPassword();
  const { hash, salt } = await hashPassword(tempPassword);
  const stmts = [
    db
      .prepare(
        `INSERT INTO users (id, email, name, role, dept, manager_id, title, phone, kind, joined_on, status,
                            password_hash, password_salt, must_change_password, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .bind(
        id, b.email, b.name, b.role, b.dept, b.managerId ?? null, b.title ?? null, b.phone ?? null,
        b.kind, b.joinedOn ?? null, b.status, hash, salt, now, now,
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
  const hrs = await db.prepare("SELECT id FROM users WHERE role = 'hr' AND status != 'left'").all<{ id: string }>();
  stmts.push(...notifyStmts(db, hrs.results.map((r) => r.id), "user_created", `New account created: ${b.name}`, "/people"));
  stmts.push(auditStmt(db, actor, "user_created", "user", id, b.name, { role: b.role, dept: b.dept, status: b.status }));
  try {
    await db.batch(stmts);
  } catch (e) {
    if (isUnique(e)) return c.json({ error: "email_taken" }, 409);
    throw e;
  }

  const row: UserRow = {
    id, email: b.email, name: b.name, role: b.role, dept: b.dept, manager_id: b.managerId ?? null,
    title: b.title ?? null, phone: b.phone ?? null, kind: b.kind, joined_on: b.joinedOn ?? null,
    status: b.status, created_at: now, updated_at: now,
  };
  return c.json({ user: toApi(row), tempPassword }, 201);
});

const COLUMN: Record<string, string> = {
  name: "name", role: "role", dept: "dept", managerId: "manager_id", title: "title",
  phone: "phone", kind: "kind", joinedOn: "joined_on", status: "status",
};

const CURRENT: Record<string, (r: UserRow) => unknown> = {
  name: (r) => r.name, role: (r) => r.role, dept: (r) => r.dept, managerId: (r) => r.manager_id,
  title: (r) => r.title, phone: (r) => r.phone, kind: (r) => r.kind, joinedOn: (r) => r.joined_on,
  status: (r) => r.status,
};
// Changes to these need canManageUser (admin: anyone; HR: employees only), and are never self-service.
const MANAGED = new Set(["status", "dept", "managerId"]);

users.patch("/:id", async (c) => {
  const actor = c.var.user!;
  if (!staffOnly(actor)) return c.json({ error: "forbidden" }, 403);
  const db = c.env.DB;
  const id = c.req.param("id");
  const target = await db.prepare(`SELECT ${PUBLIC_COLS} FROM users WHERE id = ?`).bind(id).first<UserRow>();
  if (!target) return c.json({ error: "not_found" }, 404);
  const parsed = PatchBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid" }, 400);
  const body = parsed.data as Record<string, unknown>;
  const supplied = Object.keys(body).filter((k) => body[k] !== undefined);
  if (supplied.length === 0) return c.json({ error: "invalid" }, 400);
  const self = actor.id === id;
  const isAdmin = actor.role === "admin";

  // Only values that actually differ count as changes.
  const fields = supplied.filter((k) => body[k] !== CURRENT[k](target));
  if (fields.length === 0) return c.json({ user: toApi(target) });

  if (fields.includes("role") && (self || !canChangeRole(actor, target.role, body.role as string))) {
    return c.json({ error: "forbidden" }, 403);
  }
  const managed = fields.filter((k) => MANAGED.has(k));
  if (managed.length > 0 && (!canManageUser(actor, target.role) || (self && !isAdmin))) {
    return c.json({ error: "forbidden" }, 403);
  }
  if (fields.some((k) => k !== "role" && !MANAGED.has(k)) && !canEditProfile(actor, target.role)) {
    return c.json({ error: "forbidden" }, 403);
  }
  const disabling = fields.includes("status") && body.status === "left";
  if (disabling && self) return c.json({ error: "forbidden" }, 403);
  if (typeof body.managerId === "string" && fields.includes("managerId") && !(await managerOk(db, body.managerId, id))) {
    return c.json({ error: "invalid_manager" }, 400);
  }

  const now = new Date().toISOString();
  const stmts = [
    db
      .prepare(`UPDATE users SET ${fields.map((k) => `${COLUMN[k]} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
      .bind(...fields.map((k) => body[k]), now, id),
  ];
  if (disabling) {
    stmts.push(db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id));
    stmts.push(auditStmt(db, actor, "user_disabled", "user", id, target.name));
  }
  const rest = disabling ? fields.filter((f) => f !== "status") : fields;
  if (rest.length > 0) stmts.push(auditStmt(db, actor, "user_updated", "user", id, target.name, { fields: rest }));
  await db.batch(stmts);

  const row = await db.prepare(`SELECT ${PUBLIC_COLS} FROM users WHERE id = ?`).bind(id).first<UserRow>();
  return c.json({ user: toApi(row!) });
});

users.post("/:id/reset-password", async (c) => {
  const actor = c.var.user!;
  const db = c.env.DB;
  const id = c.req.param("id");
  const target = await db.prepare(`SELECT ${PUBLIC_COLS} FROM users WHERE id = ?`).bind(id).first<UserRow>();
  if (!target) return c.json({ error: "not_found" }, 404);
  if (!canManageUser(actor, target.role)) return c.json({ error: "forbidden" }, 403);
  const tempPassword = generateTempPassword();
  const { hash, salt } = await hashPassword(tempPassword);
  await db.batch([
    db
      .prepare("UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = 1, updated_at = ? WHERE id = ?")
      .bind(hash, salt, new Date().toISOString(), id),
    db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id),
    auditStmt(db, actor, "password_reset", "user", id, target.name),
  ]);
  return c.json({ tempPassword });
});
