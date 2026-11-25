import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { auditStmt } from "../lib/audit";
import { isRealDate, leaveDays, todayIST } from "../lib/dates";
import { notifyStmts } from "../lib/notify";
import { canDecideLeave } from "../lib/policy";
import { requireUser } from "../lib/session";
import { loadSettings } from "./settings";

const KINDS = ["Casual", "Sick", "Earned", "Unpaid"] as const;
const LIMITED = ["Casual", "Sick", "Earned"] as const;
type Kind = (typeof KINDS)[number];

const Day = z.string().refine(isRealDate, "invalid date");
const CreateBody = z.object({
  kind: z.enum(KINDS),
  start: Day,
  end: Day,
  halfDay: z.boolean().optional().default(false),
  reason: z.string().trim().max(2000).nullish(),
});
const DecideBody = z.object({ note: z.string().trim().max(2000).nullish() });

interface Row {
  id: string;
  user_id: string;
  kind: Kind;
  start: string;
  end: string;
  days: number;
  half_day: number;
  reason: string | null;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  note: string | null;
  user_name: string;
  user_manager_id: string | null;
}

const SELECT = `SELECT l.*, u.name AS user_name, u.manager_id AS user_manager_id
  FROM leave_requests l JOIN users u ON u.id = l.user_id`;

const toApi = (r: Row) => ({
  id: r.id,
  userId: r.user_id,
  userName: r.user_name,
  kind: r.kind,
  start: r.start,
  end: r.end,
  days: r.days,
  halfDay: r.half_day === 1,
  reason: r.reason,
  status: r.status,
  decidedBy: r.decided_by,
  decidedAt: r.decided_at,
  note: r.note,
});

const load = (db: D1Database, id: string) => db.prepare(`${SELECT} WHERE l.id = ?`).bind(id).first<Row>();

/** Days already taken or pending, per kind, in a calendar year. */
async function usedByKind(db: D1Database, userId: string, year: string): Promise<Record<string, number>> {
  const { results } = await db
    .prepare(
      `SELECT kind, SUM(days) AS used FROM leave_requests
       WHERE user_id = ? AND status IN ('Pending','Approved') AND substr(start, 1, 4) = ? GROUP BY kind`,
    )
    .bind(userId, year)
    .all<{ kind: string; used: number }>();
  return Object.fromEntries(results.map((r) => [r.kind, r.used]));
}

/** Allowed / used / left per limited leave kind, for the current IST year. */
export async function leaveBalance(db: D1Database, userId: string) {
  const [{ leaveAllowances }, used] = await Promise.all([loadSettings(db), usedByKind(db, userId, todayIST().slice(0, 4))]);
  const balance: Record<string, { allowed: number; used: number; left: number }> = {};
  for (const k of LIMITED) {
    const allowed = leaveAllowances[k];
    const taken = used[k] ?? 0;
    balance[k] = { allowed, used: taken, left: allowed - taken };
  }
  return balance;
}

const link = "/leave";

export const leave = new Hono<AppEnv>();
leave.use("*", requireUser);

leave.get("/", async (c) => {
  const u = c.var.user!;
  const db = c.env.DB;
  const scope = c.req.query("scope") ?? "mine";
  if (!["mine", "team", "all"].includes(scope)) return c.json({ error: "invalid" }, 400);
  if (scope === "team" && u.role !== "manager") return c.json({ error: "forbidden" }, 403);
  if (scope === "all" && u.role !== "hr" && u.role !== "admin") return c.json({ error: "forbidden" }, 403);

  const where = scope === "mine" ? "WHERE l.user_id = ?" : scope === "team" ? "WHERE u.manager_id = ?" : "";
  const stmt = db.prepare(`${SELECT} ${where} ORDER BY l.start DESC, l.id LIMIT 500`);
  const { results } = await (scope === "all" ? stmt : stmt.bind(u.id)).all<Row>();
  const requests = results.map(toApi);
  if (scope !== "mine") return c.json({ requests });

  const balance = await leaveBalance(db, u.id);
  return c.json({ requests, balance });
});

leave.post("/", async (c) => {
  const u = c.var.user!;
  const db = c.env.DB;
  const parsed = CreateBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid" }, 400);
  const b = parsed.data;
  const bad = (message: string) => c.json({ error: "invalid", message }, 400);

  if (b.start > b.end) return bad("The end date can't be before the start date.");
  if (b.halfDay && b.start !== b.end) return bad("A half day must start and end on the same date.");
  if (b.start.slice(0, 4) !== b.end.slice(0, 4)) return bad("Leave can't cross into a new year. Split it into two requests.");

  const settings = await loadSettings(db);
  const days = leaveDays(b.start, b.end, b.halfDay, settings.holidays);
  if (days === 0) return bad("Those dates are all weekends or holidays.");

  const clash = await db
    .prepare(
      "SELECT 1 AS x FROM leave_requests WHERE user_id = ? AND status IN ('Pending','Approved') AND start <= ? AND \"end\" >= ? LIMIT 1",
    )
    .bind(u.id, b.end, b.start)
    .first();
  if (clash) return c.json({ error: "overlap", message: "You already have leave on some of those dates." }, 409);

  if (b.kind !== "Unpaid") {
    const used = (await usedByKind(db, u.id, b.start.slice(0, 4)))[b.kind] ?? 0;
    const left = settings.leaveAllowances[b.kind] - used;
    if (days > left) {
      return c.json({ error: "insufficient", message: `Not enough ${b.kind} leave left (${Math.max(left, 0)} days).` }, 400);
    }
  }

  const managerId = (
    await db.prepare("SELECT id FROM users WHERE id = ? AND role = 'manager' AND status != 'left'").bind(u.managerId ?? "").first<{ id: string }>()
  )?.id;
  const hrIds = (await db.prepare("SELECT id FROM users WHERE role = 'hr' AND status != 'left'").all<{ id: string }>()).results.map((r) => r.id);
  const who = [...(managerId ? [managerId] : []), ...hrIds].filter((id) => id !== u.id);

  const id = crypto.randomUUID();
  const title = `${u.name} requested ${b.kind} leave (${b.start === b.end ? b.start : `${b.start} to ${b.end}`})`;
  await db.batch([
    db
      .prepare(
        `INSERT INTO leave_requests (id, user_id, kind, start, "end", days, half_day, reason, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending')`,
      )
      .bind(id, u.id, b.kind, b.start, b.end, days, b.halfDay ? 1 : 0, b.reason ?? null),
    ...notifyStmts(db, who, "leave_requested", title, link),
    auditStmt(db, u, "leave_requested", "leave", id, title, { kind: b.kind, start: b.start, end: b.end, days }),
  ]);
  return c.json({ request: toApi((await load(db, id))!) }, 201);
});

async function decide(
  c: { env: { DB: D1Database }; var: { user: AppEnv["Variables"]["user"] }; req: { param(k: string): string; json(): Promise<unknown> }; json: (o: unknown, s?: 400 | 403 | 404 | 409) => Response },
  outcome: "Approved" | "Rejected",
) {
  const u = c.var.user!;
  const db = c.env.DB;
  const row = await load(db, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  if (!canDecideLeave(u, { id: row.user_id, managerId: row.user_manager_id })) return c.json({ error: "forbidden" }, 403);
  const parsed = DecideBody.safeParse((await c.req.json().catch(() => ({}))) ?? {});
  if (!parsed.success) return c.json({ error: "invalid" }, 400);
  if (row.status !== "Pending") return c.json({ error: "not_pending" }, 409);

  const now = new Date().toISOString();
  const verb = outcome === "Approved" ? "approved" : "rejected";
  const title = `Your ${row.kind} leave (${row.start === row.end ? row.start : `${row.start} to ${row.end}`}) was ${verb}`;
  const res = await db.batch([
    db
      .prepare("UPDATE leave_requests SET status = ?, decided_by = ?, decided_at = ?, note = ? WHERE id = ? AND status = 'Pending'")
      .bind(outcome, u.id, now, parsed.data.note ?? null, row.id),
    ...notifyStmts(db, [row.user_id], `leave_${verb}`, title, link),
    auditStmt(db, u, `leave_${verb}`, "leave", row.id, title, { requester: row.user_id }),
  ]);
  if (res[0].meta.changes === 0) return c.json({ error: "not_pending" }, 409);
  return c.json({ request: toApi((await load(db, row.id))!) });
}

leave.post("/:id/approve", (c) => decide(c as never, "Approved"));
leave.post("/:id/reject", (c) => decide(c as never, "Rejected"));

leave.post("/:id/cancel", async (c) => {
  const u = c.var.user!;
  const db = c.env.DB;
  const row = await load(db, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.user_id !== u.id) return c.json({ error: "forbidden" }, 403);
  if (row.status !== "Pending") return c.json({ error: "not_pending" }, 409);
  const title = `${row.kind} leave ${row.start} to ${row.end} cancelled`;
  const res = await db.batch([
    db.prepare("UPDATE leave_requests SET status = 'Cancelled' WHERE id = ? AND status = 'Pending'").bind(row.id),
    auditStmt(db, u, "leave_cancelled", "leave", row.id, title),
  ]);
  if (res[0].meta.changes === 0) return c.json({ error: "not_pending" }, 409);
  return c.json({ request: toApi((await load(db, row.id))!) });
});
