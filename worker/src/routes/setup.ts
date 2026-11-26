import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { hashPassword } from "../lib/crypto";
import { audit } from "../lib/audit";
import { createSession, setSessionCookie } from "../lib/session";

export const setup = new Hono<AppEnv>();

const Body = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(10).max(500),
});

setup.get("/", async (c) => {
  const row = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
  return c.json({ needed: (row?.n ?? 0) === 0 });
});

setup.post("/", async (c) => {
  const parsed = Body.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid" }, 400);
  const { name, email, password } = parsed.data;
  const { hash, salt } = await hashPassword(password);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  // Atomic: only inserts while the users table is still empty.
  const res = await c.env.DB.prepare(
    `INSERT INTO users (id, email, name, role, dept, status, password_hash, password_salt, must_change_password, created_at, updated_at)
     SELECT ?, ?, ?, 'admin', 'Management', 'active', ?, ?, 0, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM users)`,
  )
    .bind(id, email, name, hash, salt, now, now)
    .run();
  if (!res.meta.changes) return c.json({ error: "already_set_up" }, 403);
  await audit(c.env.DB, { id }, "setup", "user", id, name, { role: "admin" });
  const token = await createSession(c.env.DB, id, c.req.header("user-agent") ?? null);
  setSessionCookie(c, token);
  return c.json({
    user: { id, name, email, role: "admin", dept: "Management", managerId: null, mustChangePassword: false },
  });
});
