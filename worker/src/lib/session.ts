import type { MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppContext, AppEnv, SessionUser } from "../env";
import { randomToken, sha256Hex } from "./crypto";

export const COOKIE = "lux_session";
const DAY = 86_400_000;
const LIFETIME_DAYS = 14;
const SLIDE_BELOW_DAYS = 13;

export async function createSession(db: D1Database, userId: string, ua: string | null): Promise<string> {
  const token = randomToken();
  const now = Date.now();
  await db
    .prepare("INSERT INTO sessions (id, user_id, expires_at, created_at, user_agent) VALUES (?, ?, ?, ?, ?)")
    .bind(
      await sha256Hex(token),
      userId,
      new Date(now + LIFETIME_DAYS * DAY).toISOString(),
      new Date(now).toISOString(),
      ua ? ua.slice(0, 300) : null,
    )
    .run();
  return token;
}

export async function destroySessions(db: D1Database, userId: string, exceptTokenHash?: string): Promise<void> {
  if (exceptTokenHash) {
    await db.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").bind(userId, exceptTokenHash).run();
  } else {
    await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
  }
}

export function setSessionCookie(c: AppContext, token: string): void {
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: LIFETIME_DAYS * 86400,
  });
}

export function clearSessionCookie(c: AppContext): void {
  deleteCookie(c, COOKIE, { path: "/", secure: true });
}

export async function sessionTokenHash(c: AppContext): Promise<string | null> {
  const token = getCookie(c, COOKIE);
  return token ? sha256Hex(token) : null;
}

interface Row {
  session_id: string;
  expires_at: string;
  id: string;
  name: string;
  email: string;
  role: SessionUser["role"];
  dept: string;
  manager_id: string | null;
  must_change_password: number;
  status: string;
}

export const readSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("user", null);
  const token = getCookie(c, COOKIE);
  if (token) {
    const sid = await sha256Hex(token);
    const row = await c.env.DB.prepare(
      `SELECT s.id AS session_id, s.expires_at, u.id, u.name, u.email, u.role, u.dept, u.manager_id,
              u.must_change_password, u.status
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    )
      .bind(sid)
      .first<Row>();
    if (row) {
      const exp = Date.parse(row.expires_at);
      if (!(exp > Date.now()) || row.status === "left") {
        await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sid).run();
      } else {
        if (exp - Date.now() < SLIDE_BELOW_DAYS * DAY) {
          await c.env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?")
            .bind(new Date(Date.now() + LIFETIME_DAYS * DAY).toISOString(), sid)
            .run();
          setSessionCookie(c, token);
        }
        c.set("user", {
          id: row.id,
          name: row.name,
          email: row.email,
          role: row.role,
          dept: row.dept,
          managerId: row.manager_id,
          mustChangePassword: row.must_change_password === 1,
        });
      }
    }
  }
  await next();
};

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.var.user) return c.json({ error: "signed_out" }, 401);
  await next();
};

/** Same-origin, JSON-only guard for state-changing requests. */
export const csrf: MiddlewareHandler<AppEnv> = async (c, next) => {
  const m = c.req.method;
  if (m !== "GET" && m !== "HEAD" && m !== "OPTIONS") {
    const origin = c.req.header("origin");
    const ct = c.req.header("content-type") ?? "";
    if (!origin || origin !== new URL(c.req.url).origin || !/^application\/json\b/i.test(ct)) {
      return c.json({ error: "forbidden" }, 403);
    }
  }
  await next();
};

const OPEN_WHEN_MUST_CHANGE = (p: string) =>
  p === "/api/me" || p === "/api/setup" || p === "/api/health" || p === "/api/auth" || p.startsWith("/api/auth/");

export const mustChangeGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const u = c.var.user;
  if (u?.mustChangePassword && !OPEN_WHEN_MUST_CHANGE(new URL(c.req.url).pathname)) {
    return c.json({ error: "must_change_password" }, 403);
  }
  await next();
};
