import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { api, applyMigrations } from "./helpers";

const TABLES = [
  "users", "sessions", "tasks", "task_comments", "records", "leave_requests",
  "onboarding", "notifications", "audit_log", "settings", "login_attempts",
];

describe("scaffold", () => {
  beforeAll(async () => {
    await applyMigrations(env);
  });

  it("creates all app tables", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'",
    ).all<{ name: string }>();
    const names = results.map((r) => r.name);
    for (const t of TABLES) expect(names).toContain(t);
  });

  it("seeds settings", async () => {
    const { results } = await env.DB.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
    const m = Object.fromEntries(results.map((r) => [r.key, r.value]));
    expect(JSON.parse(m.leave_allowances)).toEqual({ Casual: 12, Sick: 6, Earned: 15 });
    expect(JSON.parse(m.holidays)).toEqual([]);
  });

  it("GET /api/health returns ok", async () => {
    const res = await api(null, "GET", "/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("unknown api path returns JSON 404", async () => {
    const res = await api(null, "GET", "/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});
