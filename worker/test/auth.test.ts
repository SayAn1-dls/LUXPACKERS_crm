import { env, exports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { api, applyMigrations, makeUser } from "./helpers";
import { cookiesOf, googleSignIn, installGoogle, sessionOf } from "./google";

beforeAll(async () => {
  await applyMigrations();
  await installGoogle();
});

beforeEach(async () => {
  for (const t of ["audit_log", "login_attempts", "sessions", "users"]) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
});

describe("sessions", () => {
  it("the Google sign-in cookie is HttpOnly, Secure, SameSite=Lax, Path=/; /api/me never shows secrets", async () => {
    await makeUser("admin", "Management");
    const u = await makeUser("employee", "Sales", { email: "s@luxpackers.com" });
    const r = await googleSignIn("sub-s", "S@Luxpackers.com");
    const sc = cookiesOf(r).lux_session.raw;
    expect(sc).toContain("HttpOnly");
    expect(sc).toContain("SameSite=Lax");
    expect(sc).toContain("Secure");
    expect(sc).toContain("Path=/");
    const me = await api(sessionOf(r), "GET", "/api/me");
    expect(me.status).toBe(200);
    const text = await me.text();
    expect(text).not.toMatch(/hash|salt|password|google_sub|sub-s/i);
    expect(JSON.parse(text).user.id).toBe(u.id);
  });

  it("stores only a hash of the session token", async () => {
    const u = await makeUser("employee", "Sales");
    const token = u.cookie.split("=")[1];
    const rows = await env.DB.prepare("SELECT id FROM sessions").all();
    expect(rows.results.some((r: any) => r.id === token)).toBe(false);
  });

  it("someone who has left loses their session", async () => {
    const u = await makeUser("employee", "Sales");
    await env.DB.prepare("UPDATE users SET status = 'left' WHERE id = ?").bind(u.id).run();
    expect((await api(u.cookie, "GET", "/api/me")).status).toBe(401);
  });
});

describe("csrf", () => {
  it("POST without Origin -> 403; with foreign Origin -> 403", async () => {
    const noOrigin = await exports.default.fetch(
      new Request("https://example.com/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "a@b.co", password: "x" }),
      }),
    );
    expect(noOrigin.status).toBe(403);
    const foreign = await exports.default.fetch(
      new Request("https://example.com/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://evil.example" },
        body: JSON.stringify({ email: "a@b.co", password: "x" }),
      }),
    );
    expect(foreign.status).toBe(403);
    const notJson = await exports.default.fetch(
      new Request("https://example.com/api/auth/login", {
        method: "POST",
        headers: { "content-type": "text/plain", origin: "https://example.com" },
        body: "{}",
      }),
    );
    expect(notJson.status).toBe(403);
  });
});

describe("logout and session expiry", () => {
  it("logout then /api/me -> 401", async () => {
    const u = await makeUser("employee", "Sales");
    expect((await api(u.cookie, "GET", "/api/me")).status).toBe(200);
    const out = await api(u.cookie, "POST", "/api/auth/logout");
    expect(out.status).toBe(200);
    const me = await api(u.cookie, "GET", "/api/me");
    expect(me.status).toBe(401);
    expect(await me.json()).toEqual({ error: "signed_out" });
  });

  it("expired session -> 401", async () => {
    const u = await makeUser("employee", "Sales");
    await env.DB.prepare("UPDATE sessions SET expires_at = ?").bind("2000-01-01T00:00:00.000Z").run();
    expect((await api(u.cookie, "GET", "/api/me")).status).toBe(401);
  });

  it("slides expiry forward when under 13 days remain", async () => {
    const u = await makeUser("employee", "Sales");
    const soon = new Date(Date.now() + 2 * 86400000).toISOString();
    await env.DB.prepare("UPDATE sessions SET expires_at = ?").bind(soon).run();
    await api(u.cookie, "GET", "/api/me");
    const row: any = await env.DB.prepare("SELECT expires_at FROM sessions").first();
    expect(Date.parse(row.expires_at)).toBeGreaterThan(Date.now() + 13 * 86400000);
  });

  it("re-sends the cookie with a fresh Max-Age when the session slides", async () => {
    const u = await makeUser("employee", "Sales");
    const soon = new Date(Date.now() + 2 * 86400000).toISOString();
    await env.DB.prepare("UPDATE sessions SET expires_at = ?").bind(soon).run();
    const r = await api(u.cookie, "GET", "/api/me");
    const sc = r.headers.get("set-cookie") ?? "";
    expect(sc).toContain(`${u.cookie};`);
    expect(sc).toContain("Max-Age=1209600");
    // no slide needed -> no cookie re-sent
    const r2 = await api(u.cookie, "GET", "/api/me");
    expect(r2.headers.get("set-cookie")).toBeNull();
  });
});
