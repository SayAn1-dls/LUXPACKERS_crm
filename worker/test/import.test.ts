import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import backup from "./fixtures/old-backup.json";
import { api, applyMigrations, makeUser } from "./helpers";

beforeAll(async () => {
  await applyMigrations();
});

beforeEach(async () => {
  for (const t of ["audit_log", "notifications", "task_comments", "tasks", "records", "sessions", "users"]) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
});

type U = Awaited<ReturnType<typeof makeUser>>;
const MGMT = "Management";

async function setup() {
  const admin = await makeUser("admin", MGMT);
  const cfo = await makeUser("employee", "Finance");
  const ops = await makeUser("employee", "Operations");
  return { admin, cfo, ops, map: { CFO: cfo.id, "Ops intern": ops.id } as Record<string, string | null> };
}
const run = async (u: U, body: unknown) => {
  const res = await api(u.cookie, "POST", "/api/import", body);
  return { res, json: (await res.json()) as any };
};
const task = (id: string) => env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first<any>();
const rec = (id: string) => env.DB.prepare("SELECT * FROM records WHERE id = ?").bind(id).first<any>();
const count = async (t: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>())!.n;

describe("access", () => {
  it("non-admin gets 403 on preview and import", async () => {
    const { cfo } = await setup();
    expect((await api(cfo.cookie, "POST", "/api/import/preview", { backup })).status).toBe(403);
    expect((await api(cfo.cookie, "POST", "/api/import", { backup, ownerMap: {} })).status).toBe(403);
    expect(await count("tasks")).toBe(0);
  });
  it("rejects a backup over 5 MB with 413", async () => {
    const { admin } = await setup();
    const big = { tasks: [{ id: "x", title: "y", notes: "z".repeat(5 * 1024 * 1024) }] };
    expect((await api(admin.cookie, "POST", "/api/import", { backup: big, ownerMap: {} })).status).toBe(413);
    expect((await api(admin.cookie, "POST", "/api/import/preview", { backup: big })).status).toBe(413);
    expect(await count("tasks")).toBe(0);
  });
});

describe("preview", () => {
  it("lists counts and the distinct old owner and holder texts", async () => {
    const { admin } = await setup();
    const res = await api(admin.cookie, "POST", "/api/import/preview", { backup });
    expect(res.status).toBe(200);
    const j = (await res.json()) as any;
    expect(j.owners).toEqual(["CFO", "CTO", "Nobody Known", "Ops intern"]);
    expect(j.counts).toMatchObject({ tasks: 3, bookings: 2, finance: 1, team: 1, access: 1 });
    expect(await count("tasks")).toBe(0);
  });
});

describe("tasks", () => {
  it("maps statuses, owners, links, dates and keeps timestamps", async () => {
    const { admin, cfo, ops, map } = await setup();
    const { res, json } = await run(admin, { backup, ownerMap: map });
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ created: 7, updated: 0, skipped: 2 });

    const t1 = await task("t1");
    expect(t1).toMatchObject({ status: "Waiting", waiting_on: "CEO", assignee_id: cfo.id, assigned_by_id: admin.id, dept: "Finance", priority: "High", due: "2026-11-28", version: 1 });
    expect(JSON.parse(t1.links)).toEqual(["https://lux-dashord.vercel.app/trips"]);
    expect(t1.created_at).toBe("2026-11-20T10:00:00.000Z");
    expect(t1.updated_at).toBe("2026-11-22T09:30:00.000Z");
    expect(json.warnings).toContainEqual({ collection: "tasks", id: "t1", field: "links" });

    const t2 = await task("t2");
    expect(t2).toMatchObject({ status: "Blocked", assignee_id: ops.id, dept: "Trips & Content" });
    expect(t2.created_at).toBeTruthy();
  });
  it("unmapped owner imports unassigned; bad dept falls back to the importer's, bad due is dropped", async () => {
    const { admin, map } = await setup();
    const { json } = await run(admin, { backup, ownerMap: map });
    const t3 = await task("t3");
    expect(t3).toMatchObject({ status: "Done", assignee_id: null, dept: MGMT, due: null });
    expect(json.warnings).toContainEqual({ collection: "tasks", id: "t3", field: "dept" });
    expect(json.warnings).toContainEqual({ collection: "tasks", id: "t3", field: "due" });
  });
  it("a bad dept falls back to the assignee's department", async () => {
    const { admin, cfo } = await setup();
    await run(admin, { backup: { tasks: [{ id: "q", title: "T", dept: "Nope", owner: "CFO" }] }, ownerMap: { CFO: cfo.id } });
    expect((await task("q")).dept).toBe("Finance");
  });
  it("an unknown status becomes To do with a warning", async () => {
    const { admin } = await setup();
    const { json } = await run(admin, { backup: { tasks: [{ id: "q", title: "T", status: "Whatever" }] }, ownerMap: {} });
    expect((await task("q")).status).toBe("To do");
    expect(json.warnings).toContainEqual({ collection: "tasks", id: "q", field: "status" });
  });
});

describe("records", () => {
  it("keys by old id, maps owner, dept and title, keeps holder, drops bad values", async () => {
    const { admin, cfo, ops, map } = await setup();
    const { json } = await run(admin, { backup, ownerMap: map });
    const b1 = await rec("b1");
    expect(b1).toMatchObject({ collection: "bookings", owner_id: ops.id, title: "Asha Rao", dept: MGMT, version: 1 });
    const data = JSON.parse(b1.data);
    expect(data).toMatchObject({ guest: "Asha Rao", value: 133998, payStatus: "Part paid" });
    expect(data.owner).toBeUndefined();
    const b2 = await rec("b2");
    expect(b2.owner_id).toBe(cfo.id);
    expect(JSON.parse(b2.data).value).toBeUndefined();
    expect(json.warnings).toContainEqual({ collection: "bookings", id: "b2", field: "value" });
    expect((await rec("f1")).dept).toBe("Finance");
    const a1 = await rec("a1");
    expect(a1).toMatchObject({ dept: "Technology", owner_id: null });
    expect(JSON.parse(a1.data).holder).toBe("CTO");
  });
  it("team and activity are skipped, never imported", async () => {
    const { admin } = await setup();
    await run(admin, { backup, ownerMap: {} });
    expect(await rec("p1")).toBeNull();
    expect(await count("users")).toBe(3);
  });
  it("does not overwrite a record that lives in another register", async () => {
    const { admin } = await setup();
    await run(admin, { backup: { finance: [{ id: "same", entry: "E", flow: "In", amount: 1 }] }, ownerMap: {} });
    const { json } = await run(admin, { backup: { bookings: [{ id: "same", guest: "G" }] }, ownerMap: {} });
    expect((await rec("same")).collection).toBe("finance");
    expect(json.created).toBe(0);
    expect(json.warnings).toContainEqual({ collection: "bookings", id: "same", field: "id" });
  });
});

describe("idempotence and writes", () => {
  it("running twice updates instead of duplicating", async () => {
    const { admin, map } = await setup();
    await run(admin, { backup, ownerMap: map });
    const { json } = await run(admin, { backup, ownerMap: map });
    expect(json).toMatchObject({ created: 0, updated: 7, skipped: 2 });
    expect(await count("tasks")).toBe(3);
    expect(await count("records")).toBe(4);
    expect((await task("t1")).version).toBe(2);
    expect((await rec("b1")).version).toBe(2);
  });
  it("writes more than 50 rows and records one audit row", async () => {
    const { admin } = await setup();
    const finance = Array.from({ length: 120 }, (_, i) => ({ id: `fin${i}`, entry: `E${i}`, flow: "In", amount: i }));
    const { json } = await run(admin, { backup: { finance }, ownerMap: {} });
    expect(json.created).toBe(120);
    expect(await count("records")).toBe(120);
    const rows = (await env.DB.prepare("SELECT user_id, detail FROM audit_log WHERE action = 'import'").all<any>()).results;
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(admin.id);
    expect(JSON.parse(rows[0].detail)).toEqual({ created: 120, updated: 0, skipped: 0, warnings: 0 });
  });
});

describe("ownerMap", () => {
  it("rejects unknown and left users", async () => {
    const { admin } = await setup();
    const left = await makeUser("employee", "Finance", { status: "left" });
    for (const v of ["no-such-user", left.id]) {
      const { res, json } = await run(admin, { backup, ownerMap: { CFO: v } });
      expect(res.status).toBe(400);
      expect(json).toEqual({ error: "invalid", field: "ownerMap" });
    }
    expect(await count("tasks")).toBe(0);
  });
});

describe("starting records", () => {
  it("loads the bundled seed with stable ids, and again as updates", async () => {
    const { admin } = await setup();
    const first = (await run(admin, { seed: true, ownerMap: {} })).json;
    expect(first.created).toBe(63);
    expect(first.updated).toBe(0);
    expect(first.skipped).toBe(9);
    expect(await task("taseed001")).toMatchObject({ status: "Blocked", assignee_id: null });
    expect(await rec("trseed001")).toMatchObject({ collection: "trips" });
    const second = (await run(admin, { seed: true, ownerMap: {} })).json;
    expect(second).toMatchObject({ created: 0, updated: first.created });
  });
  it("previews the seed", async () => {
    const { admin } = await setup();
    const j = (await (await api(admin.cookie, "POST", "/api/import/preview", { seed: true })).json()) as any;
    expect(j.owners).toContain("CFO");
    expect(j.counts.tasks).toBe(36);
  });
});
