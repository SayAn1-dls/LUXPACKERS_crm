import { env, exports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/lib/crypto";
import { api, applyMigrations, makeUser } from "./helpers";

beforeAll(async () => {
  await applyMigrations();
});

beforeEach(async () => {
  for (const t of ["audit_log", "login_attempts", "sessions", "users"]) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
});

describe("passwords", () => {
  it("hash/verify round-trip; wrong password false; two hashes of same pw differ", async () => {
    const a = await hashPassword("a-long-password");
    const b = await hashPassword("a-long-password");
    expect(await verifyPassword("a-long-password", a.hash)).toBe(true);
    expect(await verifyPassword("wrong-password!", a.hash)).toBe(false);
    expect(a.hash).not.toBe(b.hash);
    expect(a.salt).not.toBe(b.salt);
  });

  it("stores a versioned string and verifies using the iteration count recorded in it", async () => {
    const a = await hashPassword("a-long-password");
    expect(a.hash).toMatch(/^pbkdf2-sha256\$100000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    // A hash written with a lower count still verifies: the count comes from the string, not the code.
    const [scheme, , salt, hash] = a.hash.split("$");
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("another-password"), "PBKDF2", false, ["deriveBits"]);
    const saltBytes = Uint8Array.from(atob(salt), (ch) => ch.charCodeAt(0));
    const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations: 5000 }, key, 256));
    const low = `${scheme}$5000$${salt}$${btoa(String.fromCharCode(...bits))}`;
    expect(await verifyPassword("another-password", low)).toBe(true);
    expect(hash).not.toBe("");
  });

  it("a tampered iteration count fails", async () => {
    const a = await hashPassword("a-long-password");
    const [scheme, , salt, hash] = a.hash.split("$");
    expect(await verifyPassword("a-long-password", `${scheme}$99999$${salt}$${hash}`)).toBe(false);
    expect(await verifyPassword("a-long-password", `${scheme}$1$${salt}$${hash}`)).toBe(false);
  });

  it("malformed stored values fail safely instead of throwing", async () => {
    for (const bad of [
      "",
      "garbage",
      "pbkdf2-sha256$100000$onlythree",
      "pbkdf2-sha256$abc$AAAA$AAAA",
      "pbkdf2-sha256$0$AAAA$AAAA",
      "pbkdf2-sha256$100000$!!!$AAAA",
      "pbkdf2-sha256$100000$AAAA$",
      "md5$100000$AAAA$AAAA",
      "pbkdf2-sha256$100000$AAAA$AAAA$extra",
    ]) {
      expect(await verifyPassword("a-long-password", bad)).toBe(false);
    }
  });
});

describe("setup", () => {
  it("setup works once, second POST /api/setup -> 403", async () => {
    const need = await (await api(null, "GET", "/api/setup")).json();
    expect(need).toEqual({ needed: true });
    const body = { name: "Boss", email: " Boss@Example.com ", password: "long-enough-pw" };
    const r1 = await api(null, "POST", "/api/setup", body);
    expect(r1.status).toBe(200);
    expect(r1.headers.get("set-cookie")).toContain("lux_session=");
    const j: any = await r1.json();
    expect(j.user.role).toBe("admin");
    expect(j.user.email).toBe("boss@example.com");
    const r2 = await api(null, "POST", "/api/setup", body);
    expect(r2.status).toBe(403);
    expect(await (await api(null, "GET", "/api/setup")).json()).toEqual({ needed: false });
    const audit = await env.DB.prepare("SELECT action FROM audit_log").all();
    expect(audit.results.map((r: any) => r.action)).toContain("setup");
  });

  it("rejects short passwords", async () => {
    const r = await api(null, "POST", "/api/setup", { name: "B", email: "b@example.com", password: "short" });
    expect(r.status).toBe(400);
  });
});

describe("login", () => {
  it("sets HttpOnly SameSite=Lax cookie; /api/me returns user without password fields", async () => {
    const u = await makeUser("employee", "Sales");
    const r = await api(null, "POST", "/api/auth/login", { email: u.email.toUpperCase(), password: u.password });
    expect(r.status).toBe(200);
    const sc = r.headers.get("set-cookie")!;
    expect(sc).toContain("lux_session=");
    expect(sc).toContain("HttpOnly");
    expect(sc).toContain("SameSite=Lax");
    expect(sc).toContain("Secure");
    expect(sc).toContain("Path=/");
    const loginBody = JSON.stringify(await r.json());
    expect(loginBody).not.toMatch(/hash|salt/i);
    const cookie = sc.split(";")[0];
    const me = await api(cookie, "GET", "/api/me");
    expect(me.status).toBe(200);
    const text = await me.text();
    expect(text).not.toMatch(/hash|salt|password_/i);
    expect(JSON.parse(text).user.id).toBe(u.id);
  });

  it("stores only a hash of the session token", async () => {
    const u = await makeUser("employee", "Sales");
    const token = u.cookie.split("=")[1];
    const rows = await env.DB.prepare("SELECT id FROM sessions").all();
    expect(rows.results.some((r: any) => r.id === token)).toBe(false);
  });

  it("unknown email gives same 401 as wrong password", async () => {
    const r = await api(null, "POST", "/api/auth/login", { email: "nobody@example.com", password: "whatever-pw" });
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "bad_credentials" });
  });

  it("wrong password 5 times -> 6th attempt 429 even with right password", async () => {
    const u = await makeUser("employee", "Sales");
    for (let i = 0; i < 5; i++) {
      const r = await api(null, "POST", "/api/auth/login", { email: u.email, password: "nope-nope-nope" });
      expect(r.status).toBe(401);
    }
    const r = await api(null, "POST", "/api/auth/login", { email: u.email, password: u.password });
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ error: "locked" });
  });

  it("a failed sign-in prunes that email's attempts older than 15 minutes, and only that email's", async () => {
    const u = await makeUser("employee", "Sales");
    const old = new Date(Date.now() - 20 * 60_000).toISOString();
    const fresh = new Date(Date.now() - 5 * 60_000).toISOString();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO login_attempts (email, at) VALUES (?, ?)").bind(u.email, old),
      env.DB.prepare("INSERT INTO login_attempts (email, at) VALUES (?, ?)").bind(u.email, fresh),
      env.DB.prepare("INSERT INTO login_attempts (email, at) VALUES (?, ?)").bind("other@example.com", old),
    ]);
    const r = await api(null, "POST", "/api/auth/login", { email: u.email, password: "nope-nope-nope" });
    expect(r.status).toBe(401);
    const mine = await env.DB.prepare("SELECT at FROM login_attempts WHERE email = ?").bind(u.email).all();
    expect(mine.results.length).toBe(2); // the fresh one plus the new failure
    expect(mine.results.some((x: any) => x.at === old)).toBe(false);
    const other = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE email = ?").bind("other@example.com").first<{ n: number }>();
    expect(other?.n).toBe(1);
  });

  it("users who have left cannot sign in", async () => {
    const u = await makeUser("employee", "Sales", { status: "left" });
    const r = await api(null, "POST", "/api/auth/login", { email: u.email, password: u.password });
    expect(r.status).toBe(401);
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

describe("must change password", () => {
  it("must_change_password user gets 403 on /api/tasks until password changed", async () => {
    const u = await makeUser("employee", "Sales", { mustChangePassword: true });
    const blocked = await api(u.cookie, "GET", "/api/tasks");
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toEqual({ error: "must_change_password" });
    expect((await api(u.cookie, "GET", "/api/me")).status).toBe(200);

    const bad = await api(u.cookie, "POST", "/api/auth/password", { current: "wrong-current-pw", next: "brand-new-password" });
    expect(bad.status).toBe(400);
    const short = await api(u.cookie, "POST", "/api/auth/password", { current: u.password, next: "short" });
    expect(short.status).toBe(400);
    const same = await api(u.cookie, "POST", "/api/auth/password", { current: u.password, next: u.password });
    expect(same.status).toBe(400);
    expect(await same.json()).toEqual({ error: "same_password" });
    const ok = await api(u.cookie, "POST", "/api/auth/password", { current: u.password, next: "brand-new-password" });
    expect(ok.status).toBe(200);

    const after = await api(u.cookie, "GET", "/api/tasks");
    expect(after.status).not.toBe(403);
    const login = await api(null, "POST", "/api/auth/login", { email: u.email, password: "brand-new-password" });
    expect(login.status).toBe(200);
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
