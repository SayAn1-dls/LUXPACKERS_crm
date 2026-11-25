import { Hono } from "hono";
import { z } from "zod";
import { DEPT_NAMES, TASK_PRIORITIES, TASK_STATUSES } from "../../../shared/schema";
import type { Task, TaskComment } from "../../../shared/schema";
import type { AppEnv, SessionUser } from "../env";
import { auditStmt } from "../lib/audit";
import { todayIST } from "../lib/dates";
import { notifyStmts } from "../lib/notify";
import { canApproveTask, canAssignTo, canEditTaskStatus, canSeeTask } from "../lib/policy";
import type { AssigneeRef, TaskRef } from "../lib/policy";
import { requireUser } from "../lib/session";

const Dept = z.string().refine((d) => DEPT_NAMES.includes(d), "unknown department");
const Date10 = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Text = (n: number) => z.string().trim().max(n);
const httpUrl = (x: string) => {
  try {
    return ["http:", "https:"].includes(new URL(x).protocol);
  } catch {
    return false;
  }
};
const Links = z.array(z.string().trim().min(1).max(2000).refine(httpUrl, "http(s) links only")).max(20);

const invalid = (e: z.ZodError) =>
  e.issues.some((i) => i.path[0] === "links") ? { error: "invalid", field: "links" } : { error: "invalid" };

const CreateBody = z.object({
  title: Text(300).min(1),
  notes: Text(5000).nullish(),
  dept: Dept.optional(),
  assigneeId: z.string().min(1).optional(),
  priority: z.enum(TASK_PRIORITIES),
  due: Date10.nullish(),
  waitingOn: Text(300).nullish(),
  links: Links.optional(),
});

const PatchBody = z.object({
  version: z.number().int().min(1),
  title: Text(300).min(1).optional(),
  notes: Text(5000).nullable().optional(),
  dept: Dept.optional(),
  assigneeId: z.string().min(1).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  due: Date10.nullable().optional(),
  waitingOn: Text(300).nullable().optional(),
  links: Links.optional(),
});

const ActionBody = z.object({ version: z.number().int().min(1).optional(), comment: Text(5000).optional() });
const CommentBody = z.object({ body: Text(5000).min(1) });

interface TaskRow {
  id: string;
  title: string;
  notes: string | null;
  dept: string | null;
  assignee_id: string | null;
  assigned_by_id: string | null;
  priority: string | null;
  status: string;
  due: string | null;
  waiting_on: string | null;
  links: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  assignee_name: string | null;
  assigned_by_name: string | null;
  assignee_manager_id: string | null;
}

const SELECT = `SELECT t.*, a.name AS assignee_name, a.manager_id AS assignee_manager_id, b.name AS assigned_by_name
  FROM tasks t LEFT JOIN users a ON a.id = t.assignee_id LEFT JOIN users b ON b.id = t.assigned_by_id`;

const parseLinks = (s: string | null): string[] => {
  try {
    const v = JSON.parse(s ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
};

const toApi = (r: TaskRow, today: string): Task => ({
  id: r.id,
  title: r.title,
  notes: r.notes,
  dept: r.dept,
  assigneeId: r.assignee_id,
  assigneeName: r.assignee_name,
  assignedById: r.assigned_by_id,
  assignedByName: r.assigned_by_name,
  priority: r.priority as Task["priority"],
  status: r.status as Task["status"],
  due: r.due,
  waitingOn: r.waiting_on,
  links: parseLinks(r.links),
  version: r.version,
  late: !!r.due && r.due < today && r.status !== "Done",
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  completedAt: r.completed_at,
});

// DB dept / assigned_by_id are nullable. "" never matches a real user's dept or id.
const refOf = (r: TaskRow): TaskRef => ({ assigneeId: r.assignee_id, assignedById: r.assigned_by_id ?? "", dept: r.dept ?? "" });
const assigneeOf = (r: TaskRow): AssigneeRef | null => (r.assignee_id ? { managerId: r.assignee_manager_id } : null);

const loadTask = (db: D1Database, id: string) => db.prepare(`${SELECT} WHERE t.id = ?`).bind(id).first<TaskRow>();

const link = (id: string) => `/tasks?open=${id}`;

interface Assignee { id: string; dept: string; manager_id: string | null; status: string }
const loadAssignee = (db: D1Database, id: string) =>
  db.prepare("SELECT id, dept, manager_id, status FROM users WHERE id = ?").bind(id).first<Assignee>();

export const tasks = new Hono<AppEnv>();
tasks.use("*", requireUser);

tasks.get("/", async (c) => {
  const u = c.var.user!;
  const scope = c.req.query("scope");
  if (scope !== undefined && !["mine", "assigned", "team", "all"].includes(scope)) return c.json({ error: "invalid" }, 400);
  if (scope === "all" && u.role !== "admin") return c.json({ error: "forbidden" }, 403);
  if (scope === "team" && u.role !== "manager" && u.role !== "admin") return c.json({ error: "forbidden" }, 403);

  const where: string[] = [];
  const args: unknown[] = [];
  if (scope === "mine") {
    where.push("t.assignee_id = ?");
    args.push(u.id);
  } else if (scope === "assigned") {
    where.push("t.assigned_by_id = ?");
    args.push(u.id);
  } else if (scope === "team") {
    where.push("(t.dept = ? OR a.manager_id = ?)");
    args.push(u.dept, u.id);
  } else if (scope !== "all") {
    // Default: everything on me or assigned by me.
    where.push("(t.assignee_id = ? OR t.assigned_by_id = ?)");
    args.push(u.id, u.id);
  }
  const status = c.req.query("status");
  if (status) {
    if (!(TASK_STATUSES as readonly string[]).includes(status)) return c.json({ error: "invalid" }, 400);
    where.push("t.status = ?");
    args.push(status);
  }
  const dept = c.req.query("dept");
  if (dept) {
    where.push("t.dept = ?");
    args.push(dept);
  }
  const q = c.req.query("q")?.trim();
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    where.push("(t.title LIKE ? ESCAPE '\\' OR t.notes LIKE ? ESCAPE '\\')");
    args.push(like, like);
  }
  const sql = `${SELECT}${where.length ? ` WHERE ${where.join(" AND ")}` : ""}
    ORDER BY t.due IS NULL, t.due, t.created_at DESC LIMIT 500`;
  const { results } = await c.env.DB.prepare(sql).bind(...args).all<TaskRow>();
  const today = todayIST();
  return c.json({ tasks: results.map((r) => toApi(r, today)) });
});

/** Loads the task and enforces visibility. Invisible and missing both look like 404. */
async function visibleTask(c: { env: { DB: D1Database }; var: { user: SessionUser | null }; req: { param(k: string): string } }) {
  const row = await loadTask(c.env.DB, c.req.param("id"));
  if (!row || !canSeeTask(c.var.user!, refOf(row), assigneeOf(row))) return null;
  return row;
}

tasks.get("/:id", async (c) => {
  const row = await visibleTask(c);
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ task: toApi(row, todayIST()) });
});

tasks.post("/", async (c) => {
  const u = c.var.user!;
  const parsed = CreateBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(invalid(parsed.error), 400);
  const b = parsed.data;
  const db = c.env.DB;
  const assigneeId = b.assigneeId ?? u.id;
  const assignee = await loadAssignee(db, assigneeId);
  if (!assignee || assignee.status === "left") return c.json({ error: "invalid_assignee" }, 400);
  if (!canAssignTo(u, { id: assignee.id, dept: assignee.dept, managerId: assignee.manager_id })) {
    return c.json({ error: "forbidden" }, 403);
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const dept = b.dept ?? assignee.dept;
  const stmts = [
    db
      .prepare(
        `INSERT INTO tasks (id, title, notes, dept, assignee_id, assigned_by_id, priority, status, due, waiting_on, links,
                            version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'To do', ?, ?, ?, 1, ?, ?)`,
      )
      .bind(
        id, b.title, b.notes ?? null, dept, assigneeId, u.id, b.priority, b.due ?? null, b.waitingOn ?? null,
        JSON.stringify(b.links ?? []), now, now,
      ),
  ];
  if (assigneeId !== u.id) stmts.push(...notifyStmts(db, [assigneeId], "assigned", `New task for you: ${b.title}`, link(id)));
  stmts.push(auditStmt(db, u, "task_created", "task", id, b.title, { assigneeId, dept }));
  await db.batch(stmts);
  return c.json({ task: toApi((await loadTask(db, id))!, todayIST()) }, 201);
});

const COLUMN: Record<string, string> = {
  title: "title", notes: "notes", dept: "dept", assigneeId: "assignee_id", priority: "priority",
  status: "status", due: "due", waitingOn: "waiting_on", links: "links",
};
const CURRENT: Record<string, (r: TaskRow) => unknown> = {
  title: (r) => r.title, notes: (r) => r.notes, dept: (r) => r.dept, assigneeId: (r) => r.assignee_id,
  priority: (r) => r.priority, status: (r) => r.status, due: (r) => r.due, waitingOn: (r) => r.waiting_on,
  links: (r) => JSON.stringify(parseLinks(r.links)),
};

tasks.patch("/:id", async (c) => {
  const u = c.var.user!;
  const db = c.env.DB;
  const row = await visibleTask(c);
  if (!row) return c.json({ error: "not_found" }, 404);
  const parsed = PatchBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(invalid(parsed.error), 400);
  const { version, ...rest } = parsed.data;
  const body: Record<string, unknown> = { ...rest };
  if (body.links !== undefined) body.links = JSON.stringify(body.links);
  const fields = Object.keys(body).filter((k) => body[k] !== undefined && body[k] !== CURRENT[k](row));

  const ref = refOf(row);
  const assignee = assigneeOf(row);
  const approver = canApproveTask(u, ref, assignee);
  const assigner = u.id === row.assigned_by_id;
  const isAssignee = row.assignee_id === u.id;

  // Field edits: assigner or approvers. The assignee may only note who they are waiting on.
  for (const k of fields) {
    if (k === "status") continue;
    if (!(approver || assigner || (isAssignee && k === "waitingOn"))) return c.json({ error: "forbidden" }, 403);
  }
  if (fields.includes("status")) {
    const next = body.status as string;
    if (next === "Submitted") return c.json({ error: "use_submit" }, 400);
    if (!canEditTaskStatus(u, ref, next, assignee)) return c.json({ error: "forbidden" }, 403);
    // Approving / sending back must go through the review endpoints (comment, notification, history).
    if (row.status === "Submitted" && next === "Done") return c.json({ error: "use_approve" }, 400);
    if (row.status === "Submitted" && next === "To do") return c.json({ error: "use_send_back" }, 400);
    // Reopening a Done task assigned by someone else is approver-only.
    if (row.status === "Done" && row.assigned_by_id !== row.assignee_id && !approver) {
      return c.json({ error: "forbidden" }, 403);
    }
  }
  let newAssignee: Assignee | null = null;
  if (fields.includes("assigneeId")) {
    newAssignee = await loadAssignee(db, body.assigneeId as string);
    if (!newAssignee || newAssignee.status === "left") return c.json({ error: "invalid_assignee" }, 400);
    if (!canAssignTo(u, { id: newAssignee.id, dept: newAssignee.dept, managerId: newAssignee.manager_id })) {
      return c.json({ error: "forbidden" }, 403);
    }
  }

  if (version !== row.version) return c.json({ error: "conflict" }, 409);
  if (fields.length === 0) return c.json({ task: toApi(row, todayIST()) });

  const now = new Date().toISOString();
  const sets = fields.map((k) => `${COLUMN[k]} = ?`);
  const vals: unknown[] = fields.map((k) => body[k]);
  if (fields.includes("status")) {
    sets.push("completed_at = ?");
    vals.push(body.status === "Done" ? now : null);
  }
  const stmts = [
    db
      .prepare(`UPDATE tasks SET ${sets.join(", ")}, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`)
      .bind(...vals, now, row.id, version),
  ];
  if (newAssignee) {
    stmts.push(...notifyStmts(db, [newAssignee.id], "assigned", `New task for you: ${row.title}`, link(row.id)));
  }
  stmts.push(auditStmt(db, u, "task_updated", "task", row.id, row.title, { fields }));
  const res = await db.batch(stmts);
  if (res[0].meta.changes === 0) return c.json({ error: "conflict" }, 409);
  return c.json({ task: toApi((await loadTask(db, row.id))!, todayIST()) });
});

tasks.post("/:id/submit", async (c) => {
  const u = c.var.user!;
  const db = c.env.DB;
  const row = await visibleTask(c);
  if (!row) return c.json({ error: "not_found" }, 404);
  const parsed = ActionBody.safeParse((await c.req.json().catch(() => ({}))) ?? {});
  if (!parsed.success) return c.json({ error: "invalid" }, 400);
  if (row.assignee_id !== u.id) return c.json({ error: "forbidden" }, 403);
  if (row.assigned_by_id === row.assignee_id) return c.json({ error: "self_task" }, 400);
  if (row.status === "Submitted" || row.status === "Done") return c.json({ error: "not_submittable" }, 409);
  if (parsed.data.version !== undefined && parsed.data.version !== row.version) return c.json({ error: "conflict" }, 409);

  const now = new Date().toISOString();
  const managers = row.dept
    ? (
        await db
          .prepare("SELECT id FROM users WHERE role = 'manager' AND dept = ? AND status != 'left' AND id != ?")
          .bind(row.dept, u.id)
          .all<{ id: string }>()
      ).results.map((m) => m.id)
    : [];
  const who = row.assigned_by_id ? [row.assigned_by_id, ...managers] : managers;
  const res = await db.batch([
    db
      .prepare("UPDATE tasks SET status = 'Submitted', version = version + 1, updated_at = ? WHERE id = ? AND version = ?")
      .bind(now, row.id, row.version),
    ...notifyStmts(db, who.filter((id) => id !== u.id), "submitted", `Ready for review: ${row.title}`, link(row.id)),
    auditStmt(db, u, "task_submitted", "task", row.id, row.title),
  ]);
  if (res[0].meta.changes === 0) return c.json({ error: "conflict" }, 409);
  return c.json({ task: toApi((await loadTask(db, row.id))!, todayIST()) });
});

async function decide(c: Parameters<typeof visibleTask>[0] & { json: (o: unknown, s?: number) => Response; req: { json(): Promise<unknown> } }, kind: "approved" | "sent_back") {
  const u = c.var.user!;
  const db = c.env.DB;
  const row = await visibleTask(c);
  if (!row) return c.json({ error: "not_found" }, 404);
  if (!canApproveTask(u, refOf(row), assigneeOf(row))) return c.json({ error: "forbidden" }, 403);
  const parsed = ActionBody.safeParse((await c.req.json().catch(() => ({}))) ?? {});
  if (!parsed.success) return c.json({ error: "invalid" }, 400);
  const comment = parsed.data.comment || undefined;
  if (kind === "sent_back" && !comment) return c.json({ error: "comment_required" }, 400);
  if (row.status !== "Submitted") return c.json({ error: "not_submitted" }, 409);
  if (parsed.data.version !== undefined && parsed.data.version !== row.version) return c.json({ error: "conflict" }, 409);

  const now = new Date().toISOString();
  const approve = kind === "approved";
  const stmts = [
    db
      .prepare(
        "UPDATE tasks SET status = ?, completed_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
      )
      .bind(approve ? "Done" : "To do", approve ? now : null, now, row.id, row.version),
    db
      .prepare("INSERT INTO task_comments (id, task_id, user_id, body, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), row.id, u.id, comment ?? "Approved", kind, now),
  ];
  if (row.assignee_id && row.assignee_id !== u.id) {
    stmts.push(
      ...notifyStmts(
        db,
        [row.assignee_id],
        kind,
        approve ? `Approved: ${row.title}` : `Sent back: ${row.title}`,
        link(row.id),
      ),
    );
  }
  stmts.push(auditStmt(db, u, approve ? "task_approved" : "task_sent_back", "task", row.id, row.title));
  const res = await db.batch(stmts);
  if (res[0].meta.changes === 0) return c.json({ error: "conflict" }, 409);
  return c.json({ task: toApi((await loadTask(db, row.id))!, todayIST()) });
}

tasks.post("/:id/approve", (c) => decide(c, "approved"));
tasks.post("/:id/send-back", (c) => decide(c, "sent_back"));

tasks.get("/:id/comments", async (c) => {
  const row = await visibleTask(c);
  if (!row) return c.json({ error: "not_found" }, 404);
  const { results } = await c.env.DB.prepare(
    `SELECT k.id, k.task_id, k.user_id, k.body, k.kind, k.created_at, u.name AS user_name
     FROM task_comments k LEFT JOIN users u ON u.id = k.user_id WHERE k.task_id = ? ORDER BY k.created_at, k.rowid`,
  )
    .bind(row.id)
    .all<{ id: string; task_id: string; user_id: string; body: string; kind: TaskComment["kind"]; created_at: string; user_name: string | null }>();
  const comments: TaskComment[] = results.map((r) => ({
    id: r.id, taskId: r.task_id, userId: r.user_id, userName: r.user_name ?? "", body: r.body, kind: r.kind, createdAt: r.created_at,
  }));
  return c.json({ comments });
});

tasks.post("/:id/comments", async (c) => {
  const u = c.var.user!;
  const db = c.env.DB;
  const row = await visibleTask(c);
  if (!row) return c.json({ error: "not_found" }, 404);
  const parsed = CommentBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid" }, 400);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const who = [row.assignee_id, row.assigned_by_id].filter((x): x is string => !!x && x !== u.id);
  await db.batch([
    db
      .prepare("INSERT INTO task_comments (id, task_id, user_id, body, kind, created_at) VALUES (?, ?, ?, ?, 'comment', ?)")
      .bind(id, row.id, u.id, parsed.data.body, now),
    ...notifyStmts(db, who, "commented", `New comment on: ${row.title}`, link(row.id)),
    auditStmt(db, u, "task_commented", "task", row.id, row.title),
  ]);
  const comment: TaskComment = { id, taskId: row.id, userId: u.id, userName: u.name, body: parsed.data.body, kind: "comment", createdAt: now };
  return c.json({ comment }, 201);
});
