import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, SessionUser } from "../env";
import { hashPassword, verifyPassword } from "../lib/crypto";
import { audit } from "../lib/audit";
import {
  clearSessionCookie,
  createSession,
  destroySessions,
  requireUser,
  sessionTokenHash,
  setSessionCookie,
} from "../lib/session";

const MAX_FAILED = 5;
const WINDOW_MS = 15 * 60_000;

// A real PBKDF2 hash of a throwaway value, so unknown emails cost the same time as wrong passwords.
const DUMMY_SALT = "AAAAAAAAAAAAAAAAAAAAAA==";
const DUMMY_HASH = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

const LoginBody = z.object({
  email: z.string().trim().toLowerCase().min(1).max(320),
  password: z.string().min(1).max(500),
});
const PasswordBody = z.object({
  current: z.string().min(1).max(500),
  next: z.string().min(10).max(500),
});

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: SessionUser["role"];
  dept: string;
  manager_id: string | null;
  must_change_password: number;
  status: string;
  password_hash: string;
  password_salt: string;
}

function toSessionUser(r: UserRow): SessionUser {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    role: r.role,
    dept: r.dept,
    managerId: r.manager_id,
    mustChangePassword: r.must_change_password === 1,
  };
}

export const auth = new Hono<AppEnv>();

auth.post("/login", async (c) => {
  const parsed = LoginBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "bad_credentials" }, 401);
  const { email, password } = parsed.data;
  const db = c.env.DB;

  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const recent = await db
    .prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE email = ? AND at > ?")
    .bind(email, since)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= MAX_FAILED) return c.json({ error: "locked" }, 429);

  const row = await db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<UserRow>();
  const ok = row
    ? await verifyPassword(password, row.password_hash, row.password_salt)
    : (await verifyPassword(password, DUMMY_HASH, DUMMY_SALT), false);

  if (!row || !ok || row.status === "left") {
    await db.prepare("INSERT INTO login_attempts (email, at) VALUES (?, ?)").bind(email, new Date().toISOString()).run();
    return c.json({ error: "bad_credentials" }, 401);
  }

  await db.prepare("DELETE FROM login_attempts WHERE email = ?").bind(email).run();
  const token = await createSession(db, row.id, c.req.header("user-agent") ?? null);
  setSessionCookie(c, token);
  await audit(db, { id: row.id }, "login", "user", row.id, row.name);
  return c.json({ user: toSessionUser(row) });
});

auth.post("/logout", requireUser, async (c) => {
  const user = c.var.user!;
  const sid = await sessionTokenHash(c);
  if (sid) await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sid).run();
  clearSessionCookie(c);
  await audit(c.env.DB, user, "logout", "user", user.id, user.name);
  return c.json({ ok: true });
});

auth.post("/password", requireUser, async (c) => {
  const user = c.var.user!;
  const parsed = PasswordBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid" }, 400);
  const { current, next } = parsed.data;
  const db = c.env.DB;
  const row = await db.prepare("SELECT password_hash, password_salt FROM users WHERE id = ?").bind(user.id).first<UserRow>();
  if (!row || !(await verifyPassword(current, row.password_hash, row.password_salt))) {
    return c.json({ error: "wrong_current_password" }, 400);
  }
  const { hash, salt } = await hashPassword(next);
  await db
    .prepare("UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = 0, updated_at = ? WHERE id = ?")
    .bind(hash, salt, new Date().toISOString(), user.id)
    .run();
  // Sign out every other device; keep this one.
  const sid = await sessionTokenHash(c);
  await destroySessions(db, user.id, sid ?? undefined);
  await audit(db, user, "password_change", "user", user.id, user.name);
  return c.json({ ok: true });
});
