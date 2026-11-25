import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { api, applyMigrations, makeUser } from "./helpers";

beforeAll(async () => {
  await applyMigrations();
});

beforeEach(async () => {
  for (const t of ["audit_log", "notifications", "records", "sessions", "users"]) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
});

type U = Awaited<ReturnType<typeof makeUser>>;
const SALES = "Sales & Reservations";
const FIN = "Finance";

const auditRows = async () =>
  (await env.DB.prepare("SELECT action, entity, detail FROM audit_log ORDER BY at, rowid").all<{ action: string; entity: string; detail: string | null }>()).results;

async function mkBooking(u: U, data: Record<string, unknown> = {}, extra: Record<string, unknown> = {}, expectStatus = 201) {
  const res = await api(u.cookie, "POST", "/api/records/bookings", { data: { guest: "Asha Rao", ...data }, ...extra });
  expect(res.status).toBe(expectStatus);
  return (await res.json()) as any;
}

describe("department scoping", () => {
  it("Sales employee reads bookings ok, finance 403", async () => {
    const e = await makeUser("employee", SALES);
    expect((await api(e.cookie, "GET", "/api/records/bookings")).status).toBe(200);
    const res = await api(e.cookie, "GET", "/api/records/finance");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect((await api(e.cookie, "POST", "/api/records/finance", { data: { entry: "x", flow: "In", amount: 1 } })).status).toBe(403);
  });
  it("Finance employee reads finance ok", async () => {
    const e = await makeUser("employee", FIN);
    const res = await api(e.cookie, "GET", "/api/records/finance");
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).rows).toEqual([]);
  });
  it("unknown collection is 404; unauthenticated is 401", async () => {
    const e = await makeUser("admin", "Management");
    const res = await api(e.cookie, "GET", "/api/records/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect((await api(null, "GET", "/api/records/bookings")).status).toBe(401);
  });
  it("record in another register is not reachable through this collection (404)", async () => {
    const admin = await makeUser("admin", "Management");
    const fin = await api(admin.cookie, "POST", "/api/records/finance", { data: { entry: "Rent", flow: "Out", amount: 5 } });
    const id = ((await fin.json()) as any).record.id;
    const e = await makeUser("employee", SALES);
    expect((await api(e.cookie, "PATCH", `/api/records/bookings/${id}`, { version: 1, data: { guest: "x" } })).status).toBe(404);
  });
});

describe("create and validation", () => {
  it("creates with title from titleKey, default status, default dept, server-set fields", async () => {
    const e = await makeUser("employee", SALES);
    const { record } = await mkBooking(e, { value: 1000, received: 400 });
    expect(record).toMatchObject({
      collection: "bookings", title: "Asha Rao", version: 1, dept: SALES, ownerId: null, ownerName: null,
    });
    expect(record.data.payStatus).toBe("Token paid");
    expect(record.data.balance).toBeUndefined();
    expect(record.updatedByName).toMatch(/^employee /);
    const row = await env.DB.prepare("SELECT created_by, updated_by FROM records WHERE id = ?").bind(record.id).first<any>();
    expect(row).toEqual({ created_by: e.id, updated_by: e.id });
    expect((await auditRows()).map((a) => [a.action, a.entity])).toEqual([["record_created", "bookings"]]);
  });
  it("dept defaults to the single owning department else the caller's", async () => {
    const e = await makeUser("employee", FIN);
    const res = await api(e.cookie, "POST", "/api/records/finance", { data: { entry: "Fuel", flow: "Out", amount: 10 } });
    expect(((await res.json()) as any).record.dept).toBe(FIN);
    const admin = await makeUser("admin", "Management");
    const lead = await api(admin.cookie, "POST", "/api/records/leads", { data: { name: "Ravi" } });
    expect(((await lead.json()) as any).record.dept).toBe(SALES);
    const b = await mkBooking(admin);
    expect(b.record.dept).toBe("Management");
  });
  it("dept must be a department name", async () => {
    const e = await makeUser("employee", SALES);
    await mkBooking(e, {}, { dept: "Narnia" }, 400);
    const { record } = await mkBooking(e, {}, { dept: "Operations" });
    expect(record.dept).toBe("Operations");
  });
  it("missing required field → 400 {error:invalid, field:guest}", async () => {
    const e = await makeUser("employee", SALES);
    const res = await api(e.cookie, "POST", "/api/records/bookings", { data: { trip: "Bali" } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid", field: "guest" });
    const blank = await api(e.cookie, "POST", "/api/records/bookings", { data: { guest: "  " } });
    expect(blank.status).toBe(400);
  });
  it("link javascript: → 400; http(s) links accepted", async () => {
    const e = await makeUser("employee", SALES);
    const bad = await api(e.cookie, "POST", "/api/records/bookings", { data: { guest: "A", links: [{ label: "x", url: "javascript:alert(1)" }] } });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid", field: "links" });
    const notUrl = await api(e.cookie, "POST", "/api/records/bookings", { data: { guest: "A", links: [{ label: "x", url: "nope" }] } });
    expect(notUrl.status).toBe(400);
    const { record } = await mkBooking(e, { links: [{ label: "Voucher", url: "https://drive.google.com/x" }] });
    expect(record.data.links).toEqual([{ label: "Voucher", url: "https://drive.google.com/x" }]);
  });
  it("unknown data keys, computed fields and person fields are dropped", async () => {
    const e = await makeUser("employee", SALES);
    const other = await makeUser("employee", SALES);
    const { record } = await mkBooking(e, { hack: "x", balance: 99999, owner_id: other.id });
    expect(record.data.hack).toBeUndefined();
    expect(record.data.balance).toBeUndefined();
    expect(record.data.owner_id).toBeUndefined();
    expect(record.ownerId).toBeNull();
  });
  it("validates field types", async () => {
    const e = await makeUser("employee", SALES);
    const bad: Array<[Record<string, unknown>, string]> = [
      [{ value: -1 }, "value"],
      [{ value: "100" }, "value"],
      [{ pax: "3" }, "pax"],
      [{ start: "2026-13-45x" }, "start"],
      [{ start: "26-01-01" }, "start"],
      [{ tripStatus: "Lost at sea" }, "tripStatus"],
      [{ payStatus: "Maybe" }, "payStatus"],
      [{ guest: 5 }, "guest"],
    ];
    for (const [d, field] of bad) {
      const res = await api(e.cookie, "POST", "/api/records/bookings", { data: { guest: "A", ...d } });
      expect(res.status, JSON.stringify(d)).toBe(400);
      expect(((await res.json()) as any).field).toBe(field);
    }
    const lead = await api(e.cookie, "POST", "/api/records/leads", { data: { name: "A", email: "not-an-email" } });
    expect(((await lead.json()) as any).field).toBe("email");
    const trip = await makeUser("employee", "Trips & Content");
    for (const steps of [["Nope"], ["Price set", "Price set"], "Price set"]) {
      const r = await api(trip.cookie, "POST", "/api/records/trips", { data: { name: "T", steps } });
      expect(r.status).toBe(400);
      expect(((await r.json()) as any).field).toBe("steps");
    }
    const ok = await api(trip.cookie, "POST", "/api/records/trips", { data: { name: "T", steps: ["Price set"], kind: "Group" } });
    expect(ok.status).toBe(201);
  });
  it("empty string or null clears optional values (they are not stored)", async () => {
    const e = await makeUser("employee", SALES);
    const { record } = await mkBooking(e, { value: "", pax: null });
    expect(record.data.value).toBeUndefined();
    expect(record.data.pax).toBeUndefined();
  });
  it("ownerId must be an existing user who has not left; ownerName comes from the join", async () => {
    const e = await makeUser("employee", SALES);
    const owner = await makeUser("employee", SALES);
    const gone = await makeUser("employee", SALES, { status: "left" });
    await mkBooking(e, {}, { ownerId: "missing" }, 400);
    await mkBooking(e, {}, { ownerId: gone.id }, 400);
    const { record } = await mkBooking(e, {}, { ownerId: owner.id });
    expect(record.ownerId).toBe(owner.id);
    expect(record.ownerName).toMatch(/^employee /);
  });
});

describe("list", () => {
  it("returns rows, supports q (escaped) and status filter; hides deleted", async () => {
    const e = await makeUser("employee", SALES);
    await mkBooking(e, { guest: "Asha Rao", trip: "Bali" });
    await mkBooking(e, { guest: "100% Match", payStatus: "Fully paid" });
    await mkBooking(e, { guest: "Zed", trip: "Goa" });
    const all = ((await (await api(e.cookie, "GET", "/api/records/bookings")).json()) as any).rows;
    expect(all).toHaveLength(3);
    const q1 = ((await (await api(e.cookie, "GET", "/api/records/bookings?q=bali")).json()) as any).rows;
    expect(q1.map((r: any) => r.title)).toEqual(["Asha Rao"]);
    const pct = ((await (await api(e.cookie, "GET", "/api/records/bookings?q=%25")).json()) as any).rows;
    expect(pct.map((r: any) => r.title)).toEqual(["100% Match"]);
    const st = ((await (await api(e.cookie, "GET", "/api/records/bookings?status=Fully%20paid")).json()) as any).rows;
    expect(st.map((r: any) => r.title)).toEqual(["100% Match"]);
    expect((await api(e.cookie, "GET", "/api/records/bookings?status=Bogus")).status).toBe(400);
  });
  it("trash=1 is admin only", async () => {
    const mgr = await makeUser("manager", SALES);
    expect((await api(mgr.cookie, "GET", "/api/records/bookings?trash=1")).status).toBe(403);
  });
});

describe("update", () => {
  it("merges partial data, audits only changed keys, bumps version", async () => {
    const e = await makeUser("employee", SALES);
    const { record } = await mkBooking(e, { trip: "Bali", value: 100 });
    const res = await api(e.cookie, "PATCH", `/api/records/bookings/${record.id}`, {
      version: 1, data: { trip: "Goa", value: 100, notes: "vip" },
    });
    expect(res.status).toBe(200);
    const r = ((await res.json()) as any).record;
    expect(r.version).toBe(2);
    expect(r.data).toMatchObject({ guest: "Asha Rao", trip: "Goa", value: 100, notes: "vip" });
    const rows = await auditRows();
    const upd = rows.filter((a) => a.action === "record_updated");
    expect(upd).toHaveLength(1);
    expect(JSON.parse(upd[0].detail!).fields.sort()).toEqual(["notes", "trip"]);
  });
  it("title follows titleKey; ownerId and dept are updatable and audited", async () => {
    const e = await makeUser("employee", SALES);
    const owner = await makeUser("employee", SALES);
    const { record } = await mkBooking(e);
    const res = await api(e.cookie, "PATCH", `/api/records/bookings/${record.id}`, {
      version: 1, ownerId: owner.id, dept: "Finance", data: { guest: "Bina" },
    });
    const r = ((await res.json()) as any).record;
    expect(r).toMatchObject({ title: "Bina", ownerId: owner.id, dept: "Finance" });
    const d = JSON.parse((await auditRows()).find((a) => a.action === "record_updated")!.detail!);
    expect(d.fields.sort()).toEqual(["dept", "guest", "ownerId"]);
  });
  it("nothing changed → 200 no-op, no audit, no version bump", async () => {
    const e = await makeUser("employee", SALES);
    const { record } = await mkBooking(e, { trip: "Bali" });
    const res = await api(e.cookie, "PATCH", `/api/records/bookings/${record.id}`, { version: 1, data: { trip: "Bali" } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).record.version).toBe(1);
    expect((await auditRows()).map((a) => a.action)).toEqual(["record_created"]);
  });
  it("stale version → 409", async () => {
    const e = await makeUser("employee", SALES);
    const { record } = await mkBooking(e);
    await api(e.cookie, "PATCH", `/api/records/bookings/${record.id}`, { version: 1, data: { trip: "A" } });
    const res = await api(e.cookie, "PATCH", `/api/records/bookings/${record.id}`, { version: 1, data: { trip: "B" } });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "conflict" });
  });
  it("required fields: partial patch that omits them is fine, clearing them is 400", async () => {
    const e = await makeUser("employee", SALES);
    const { record } = await mkBooking(e);
    expect((await api(e.cookie, "PATCH", `/api/records/bookings/${record.id}`, { version: 1, data: { guest: "" } })).status).toBe(400);
    const nul = await api(e.cookie, "PATCH", `/api/records/bookings/${record.id}`, { version: 1, data: { guest: null } });
    expect(((await nul.json()) as any).field).toBe("guest");
    const ok = await api(e.cookie, "PATCH", `/api/records/bookings/${record.id}`, { version: 1, data: { trip: "x" } });
    expect(ok.status).toBe(200);
  });
  it("a legacy row already missing a required field can still be patched", async () => {
    const e = await makeUser("employee", SALES);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO records (id, collection, dept, title, data, version, created_at, updated_at) VALUES (?, 'bookings', ?, '', '{}', 1, ?, ?)",
    ).bind(id, SALES, now, now).run();
    const res = await api(e.cookie, "PATCH", `/api/records/bookings/${id}`, { version: 1, data: { trip: "X" } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).record.data.trip).toBe("X");
    const clear = await api(e.cookie, "PATCH", `/api/records/bookings/${id}`, { version: 2, data: { guest: "" } });
    expect(clear.status).toBe(400);
  });
  it("clearing an optional value with null removes it", async () => {
    const e = await makeUser("employee", SALES);
    const { record } = await mkBooking(e, { trip: "Bali" });
    const res = await api(e.cookie, "PATCH", `/api/records/bookings/${record.id}`, { version: 1, data: { trip: null } });
    expect(((await res.json()) as any).record.data.trip).toBeUndefined();
  });
  it("missing or deleted record → 404; no register access → 403", async () => {
    const e = await makeUser("employee", SALES);
    expect((await api(e.cookie, "PATCH", "/api/records/bookings/nope", { version: 1, data: {} })).status).toBe(404);
    const fin = await makeUser("employee", FIN);
    const { record } = await mkBooking(e);
    expect((await api(fin.cookie, "PATCH", `/api/records/bookings/${record.id}`, { version: 1, data: { trip: "x" } })).status).toBe(200);
    const sales2 = await makeUser("employee", SALES);
    const frec = await api(fin.cookie, "POST", "/api/records/finance", { data: { entry: "R", flow: "In", amount: 1 } });
    const fid = ((await frec.json()) as any).record.id;
    expect((await api(sales2.cookie, "PATCH", `/api/records/finance/${fid}`, { version: 1, data: { amount: 2 } })).status).toBe(403);
  });
});

describe("delete and restore", () => {
  it("employee DELETE → 403, manager DELETE → soft (hidden; admin sees in trash)", async () => {
    const e = await makeUser("employee", SALES);
    const mgr = await makeUser("manager", SALES);
    const admin = await makeUser("admin", "Management");
    const { record } = await mkBooking(e);
    expect((await api(e.cookie, "DELETE", `/api/records/bookings/${record.id}`)).status).toBe(403);
    const del = await api(mgr.cookie, "DELETE", `/api/records/bookings/${record.id}`);
    expect(del.status).toBe(200);
    expect(((await (await api(e.cookie, "GET", "/api/records/bookings")).json()) as any).rows).toHaveLength(0);
    const trash = ((await (await api(admin.cookie, "GET", "/api/records/bookings?trash=1")).json()) as any).rows;
    expect(trash.map((r: any) => r.id)).toEqual([record.id]);
    expect((await api(mgr.cookie, "DELETE", `/api/records/bookings/${record.id}`)).status).toBe(404);
    expect((await api(e.cookie, "PATCH", `/api/records/bookings/${record.id}`, { version: 2, data: { trip: "x" } })).status).toBe(404);
    expect((await auditRows()).map((a) => a.action)).toContain("record_deleted");
  });
  it("manager of another department cannot delete", async () => {
    const e = await makeUser("employee", SALES);
    const other = await makeUser("manager", "Marketing");
    const { record } = await mkBooking(e);
    expect((await api(other.cookie, "DELETE", `/api/records/bookings/${record.id}`)).status).toBe(403);
  });
  it("restore is admin only and 404 if not deleted", async () => {
    const e = await makeUser("employee", SALES);
    const mgr = await makeUser("manager", SALES);
    const admin = await makeUser("admin", "Management");
    const { record } = await mkBooking(e);
    expect((await api(admin.cookie, "POST", `/api/records/bookings/${record.id}/restore`)).status).toBe(404);
    await api(mgr.cookie, "DELETE", `/api/records/bookings/${record.id}`);
    expect((await api(mgr.cookie, "POST", `/api/records/bookings/${record.id}/restore`)).status).toBe(403);
    const res = await api(admin.cookie, "POST", `/api/records/bookings/${record.id}/restore`);
    expect(res.status).toBe(200);
    expect(((await (await api(e.cookie, "GET", "/api/records/bookings")).json()) as any).rows).toHaveLength(1);
    expect((await auditRows()).map((a) => a.action)).toContain("record_restored");
  });
});
