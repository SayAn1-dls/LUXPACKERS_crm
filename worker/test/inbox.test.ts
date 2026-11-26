import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { api, applyMigrations, makeUser } from "./helpers";
import { clearAll } from "./seed";

beforeAll(async () => {
  await applyMigrations();
});
beforeEach(clearAll);

const addNote = async (userId: string, title: string, at = new Date().toISOString()) => {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO notifications (id, user_id, kind, title, link, read_at, created_at) VALUES (?, ?, 'x', ?, '/', NULL, ?)").bind(id, userId, title, at).run();
  return id;
};

describe("notifications", () => {
  it("lists only my newest 50 with unread count", async () => {
    const a = await makeUser("employee", "Operations");
    const b = await makeUser("employee", "Operations");
    for (let i = 0; i < 55; i++) await addNote(a.id, `n${i}`, new Date(Date.UTC(2030, 0, 1, 0, i)).toISOString());
    await addNote(b.id, "other");
    const body = (await (await api(a.cookie, "GET", "/api/notifications")).json()) as any;
    expect(body.items).toHaveLength(50);
    expect(body.items[0].title).toBe("n54");
    expect(body.unread).toBe(55);
    expect(body.items[0]).toMatchObject({ kind: "x", link: "/" });
  });

  it("read-all sets unread 0", async () => {
    const a = await makeUser("employee", "Operations");
    await addNote(a.id, "one");
    await addNote(a.id, "two");
    expect((await api(a.cookie, "POST", "/api/notifications/read", {})).status).toBe(200);
    const body = (await (await api(a.cookie, "GET", "/api/notifications")).json()) as any;
    expect(body.unread).toBe(0);
  });

  it("read with ids marks only my own rows", async () => {
    const a = await makeUser("employee", "Operations");
    const b = await makeUser("employee", "Operations");
    const mine1 = await addNote(a.id, "one");
    await addNote(a.id, "two");
    const theirs = await addNote(b.id, "theirs");
    await api(a.cookie, "POST", "/api/notifications/read", { ids: [mine1, theirs] });
    expect(((await (await api(a.cookie, "GET", "/api/notifications")).json()) as any).unread).toBe(1);
    expect(((await (await api(b.cookie, "GET", "/api/notifications")).json()) as any).unread).toBe(1);
  });
});

describe("audit", () => {
  it("as employee -> 403", async () => {
    const e = await makeUser("employee", "Operations");
    expect((await api(e.cookie, "GET", "/api/audit")).status).toBe(403);
    const hr = await makeUser("hr", "People & Interns");
    expect((await api(hr.cookie, "GET", "/api/audit")).status).toBe(403);
  });

  it("pages through rows that share a timestamp without skipping or repeating", async () => {
    const admin = await makeUser("admin", "Management");
    for (let i = 0; i < 3; i++) {
      await env.DB.prepare("INSERT INTO audit_log (id, at, user_id, action, entity, entity_id, title) VALUES (?, '2031-05-05T00:00:00.000Z', ?, 'a', 'task', ?, ?)")
        .bind(crypto.randomUUID(), admin.id, `s${i}`, `S${i}`).run();
    }
    const p1 = (await (await api(admin.cookie, "GET", "/api/audit?limit=2")).json()) as any;
    expect(p1.items).toHaveLength(2);
    const p2 = (await (await api(admin.cookie, "GET", `/api/audit?limit=2&before=${encodeURIComponent(p1.next)}`)).json()) as any;
    expect(p2.items).toHaveLength(1);
    expect(p2.next).toBeNull();
    expect(new Set([...p1.items, ...p2.items].map((x: any) => x.id)).size).toBe(3);
    expect((await api(admin.cookie, "GET", "/api/audit?before=2031-05-05T00:00:00.000Z%7Cabc")).status).toBe(400);
  });

  it("pages with before cursor, limit clamps, names included", async () => {
    const admin = await makeUser("admin", "Management");
    for (let i = 0; i < 5; i++) {
      await env.DB.prepare("INSERT INTO audit_log (id, at, user_id, action, entity, entity_id, title) VALUES (?, ?, ?, 'a', 'task', ?, ?)")
        .bind(crypto.randomUUID(), `2030-01-0${i + 1}T00:00:00.000Z`, admin.id, `e${i}`, `T${i}`).run();
    }
    const p1 = (await (await api(admin.cookie, "GET", "/api/audit?limit=2")).json()) as any;
    expect(p1.items.map((x: any) => x.title)).toEqual(["T4", "T3"]);
    expect(p1.items[0].userName).toContain("admin");
    expect(p1.next).toMatch(/^2030-01-04T00:00:00\.000Z\|\d+$/);
    const p2 = (await (await api(admin.cookie, "GET", `/api/audit?limit=2&before=${p1.next}`)).json()) as any;
    expect(p2.items.map((x: any) => x.title)).toEqual(["T2", "T1"]);
    const last = (await (await api(admin.cookie, "GET", `/api/audit?before=2030-01-02T00:00:00.000Z`)).json()) as any;
    expect(last.items.map((x: any) => x.title)).toEqual(["T0"]);
    expect(last.next).toBeNull();
    expect((await api(admin.cookie, "GET", "/api/audit?limit=0")).status).toBe(400);
    expect((await api(admin.cookie, "GET", "/api/audit?before=nope")).status).toBe(400);
    expect((await api(admin.cookie, "GET", "/api/audit?limit=9999")).status).toBe(200);
  });
});

describe("onboarding", () => {
  async function newJoiner() {
    const admin = await makeUser("admin", "Management");
    const res = await api(admin.cookie, "POST", "/api/users", { name: "Joiner", email: "j@example.com", role: "employee", dept: "Operations", kind: "Full-time", status: "onboarding" });
    return { admin, joiner: ((await res.json()) as any).user };
  }

  it("GET: hr/admin or self; others 403; unknown 404", async () => {
    const { admin, joiner } = await newJoiner();
    const hr = await makeUser("hr", "People & Interns");
    const other = await makeUser("employee", "Operations");
    const res = (await (await api(hr.cookie, "GET", `/api/onboarding/${joiner.id}`)).json()) as any;
    expect(res.steps).toHaveLength(6);
    expect(res.steps.filter((s: any) => s.done)).toHaveLength(1);
    expect((await api(admin.cookie, "GET", `/api/onboarding/${joiner.id}`)).status).toBe(200);
    expect((await api(other.cookie, "GET", `/api/onboarding/${joiner.id}`)).status).toBe(403);
    expect((await api(hr.cookie, "GET", "/api/onboarding/nope")).status).toBe(404);
    // self
    const { createSession } = await import("../src/lib/session");
    const token = await createSession(env.DB, joiner.id, "t");
    expect((await api(`lux_session=${token}`, "GET", `/api/onboarding/${joiner.id}`)).status).toBe(200);
  });

  it("PATCH: hr/admin only, validates step, stamps done_by/done_at, audits", async () => {
    const { joiner } = await newJoiner();
    const hr = await makeUser("hr", "People & Interns");
    const other = await makeUser("employee", "Operations");
    const step = "Policies read";
    expect((await api(other.cookie, "PATCH", `/api/onboarding/${joiner.id}`, { step, done: true })).status).toBe(403);
    expect((await api(hr.cookie, "PATCH", `/api/onboarding/${joiner.id}`, { step: "Made up", done: true })).status).toBe(400);
    expect((await api(hr.cookie, "PATCH", `/api/onboarding/${joiner.id}`, { step })).status).toBe(400);
    expect((await api(hr.cookie, "PATCH", "/api/onboarding/nope", { step, done: true })).status).toBe(404);
    const ok = (await (await api(hr.cookie, "PATCH", `/api/onboarding/${joiner.id}`, { step, done: true })).json()) as any;
    expect(ok.steps.find((s: any) => s.step === step)).toMatchObject({ done: true, doneBy: hr.id });
    expect(ok.steps.find((s: any) => s.step === step).doneAt).toBeTruthy();
    const un = (await (await api(hr.cookie, "PATCH", `/api/onboarding/${joiner.id}`, { step, done: false })).json()) as any;
    expect(un.steps.find((s: any) => s.step === step)).toMatchObject({ done: false, doneBy: null, doneAt: null });
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'onboarding_updated'").first<any>();
    expect(n.n).toBe(2);
  });
});
