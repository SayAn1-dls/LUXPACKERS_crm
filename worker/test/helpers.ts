import { env, exports } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";

export async function applyMigrations(e: typeof env = env): Promise<void> {
  await applyD1Migrations(e.DB, e.TEST_MIGRATIONS);
}

export function api(
  cookie: string | null,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const origin = "https://example.com";
  const headers: Record<string, string> = { "content-type": "application/json", origin };
  if (cookie) headers.cookie = cookie;
  return exports.default.fetch(
    new Request(origin + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

export async function makeUser(
  role: "admin" | "manager" | "hr" | "employee",
  deptName: string,
  opts: {
    managerId?: string;
    status?: string;
    mustChangePassword?: boolean;
    email?: string;
    password?: string;
  } = {},
): Promise<{ id: string; email: string; password: string; cookie: string }> {
  const { hashPassword } = await import("../src/lib/crypto");
  const { createSession } = await import("../src/lib/session");
  const id = crypto.randomUUID();
  const email = (opts.email ?? `${role}-${id.slice(0, 8)}@example.com`).trim().toLowerCase();
  const password = opts.password ?? "correct-horse-battery";
  const { hash, salt } = await hashPassword(password);
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO users (id, email, name, role, dept, manager_id, status, password_hash, password_salt, must_change_password, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      email,
      `${role} ${id.slice(0, 4)}`,
      role,
      deptName,
      opts.managerId ?? null,
      opts.status ?? "active",
      hash,
      salt,
      opts.mustChangePassword ? 1 : 0,
      now,
      now,
    )
    .run();
  const token = await createSession(env.DB, id, "test");
  return { id, email, password, cookie: `lux_session=${token}` };
}
