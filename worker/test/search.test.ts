import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { api, applyMigrations, makeUser } from "./helpers";
import { clearAll, seedRecord, seedTask } from "./seed";

beforeAll(async () => {
  await applyMigrations();
});
beforeEach(clearAll);

const search = async (u: { cookie: string }, q: string) => api(u.cookie, "GET", `/api/search?q=${encodeURIComponent(q)}`);

describe("search", () => {
  it("rejects short queries", async () => {
    const e = await makeUser("employee", "Operations");
    expect((await search(e, "a")).status).toBe(400);
    expect((await search(e, "  a ")).status).toBe(400);
    expect((await api(e.cookie, "GET", "/api/search")).status).toBe(400);
    expect((await api(null, "GET", "/api/search?q=abc")).status).toBe(401);
  });

  it("as employee never returns finance records", async () => {
    const e = await makeUser("employee", "Operations");
    await seedRecord("finance", "Zebra invoice", { status: "Pending" });
    await seedRecord("partners", "Zebra hotel", { status: "Active" });
    const body = (await (await search(e, "zebra")).json()) as any;
    expect(body.results.map((r: any) => r.title)).toEqual(["Zebra hotel"]);
    const f = await makeUser("employee", "Finance");
    const fb = (await (await search(f, "zebra")).json()) as any;
    expect(fb.results.map((r: any) => r.title)).toEqual(["Zebra invoice"]);
  });

  it("skips deleted records; link formats", async () => {
    const admin = await makeUser("admin", "Management");
    const rec = await seedRecord("partners", "Yak lodge", { status: "Active" });
    await seedRecord("partners", "Yak gone", { status: "Active" }, { deleted: true });
    const task = await seedTask({ title: "Yak task", assignee: admin.id, by: admin.id });
    const body = (await (await search(admin, "yak")).json()) as any;
    const by = Object.fromEntries(body.results.map((r: any) => [r.kind, r]));
    expect(body.results).toHaveLength(2 + body.results.filter((r: any) => r.kind === "person").length);
    expect(by.record.link).toBe(`/registers/partners?open=${rec}`);
    expect(by.task.link).toBe(`/tasks?open=${task}`);
    expect(by.task).toHaveProperty("sub");
  });

  it("tasks follow the default scope for non-admin and everything for admin", async () => {
    const admin = await makeUser("admin", "Management");
    const e = await makeUser("employee", "Operations");
    const o = await makeUser("employee", "Operations");
    const mine = await seedTask({ title: "Quokka mine", assignee: e.id, by: admin.id });
    await seedTask({ title: "Quokka theirs", assignee: o.id, by: admin.id });
    const eb = (await (await search(e, "quokka")).json()) as any;
    expect(eb.results.map((r: any) => r.id)).toEqual([mine]);
    const ab = (await (await search(admin, "quokka")).json()) as any;
    expect(ab.results).toHaveLength(2);
  });

  it("manager finds reports' and dept tasks; employee cannot find a stranger's", async () => {
    const mgr = await makeUser("manager", "Operations");
    const rep = await makeUser("employee", "Finance", { managerId: mgr.id });
    const peer = await makeUser("employee", "Operations");
    const stranger = await makeUser("employee", "Finance");
    const a = await seedTask({ title: "Lemur report", dept: "Finance", assignee: rep.id, by: rep.id });
    const b = await seedTask({ title: "Lemur dept", dept: "Operations", assignee: peer.id, by: peer.id });
    await seedTask({ title: "Lemur stranger", dept: "Finance", assignee: stranger.id, by: stranger.id });
    const mb = (await (await search(mgr, "lemur")).json()) as any;
    expect(mb.results.map((r: any) => r.id).sort()).toEqual([a, b].sort());
    const eb = (await (await search(peer, "lemur")).json()) as any;
    expect(eb.results.map((r: any) => r.id)).toEqual([b]);
  });

  it("people by name; left people only for hr/admin", async () => {
    const e = await makeUser("employee", "Operations");
    const hr = await makeUser("hr", "People & Interns");
    const gone = await makeUser("employee", "Operations", { status: "left" });
    const { env } = await import("cloudflare:workers");
    await env.DB.prepare("UPDATE users SET name = 'Wombat Gone' WHERE id = ?").bind(gone.id).run();
    expect(((await (await search(e, "wombat")).json()) as any).results).toEqual([]);
    const h = ((await (await search(hr, "wombat")).json()) as any).results;
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ kind: "person", id: gone.id, title: "Wombat Gone", link: `/people?open=${gone.id}` });
  });

  it("escapes LIKE wildcards and caps at 12", async () => {
    const admin = await makeUser("admin", "Management");
    await seedRecord("partners", "100% sure", { status: "Active" });
    await seedRecord("partners", "100 sure", { status: "Active" });
    const r = ((await (await search(admin, "0%")).json()) as any).results.filter((x: any) => x.kind === "record");
    expect(r.map((x: any) => x.title)).toEqual(["100% sure"]);
    for (let i = 0; i < 20; i++) await seedRecord("partners", `Okapi ${i}`, { status: "Active" });
    expect(((await (await search(admin, "okapi")).json()) as any).results).toHaveLength(12);
  });
});
