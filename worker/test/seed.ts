import { env } from "cloudflare:workers";
import { todayIST } from "../src/lib/dates";

export const TABLES = ["audit_log", "notifications", "onboarding", "leave_requests", "task_comments", "tasks", "records", "sessions", "users"];
export const clearAll = async () => {
  for (const t of TABLES) await env.DB.prepare(`DELETE FROM ${t}`).run();
};

export const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const today = () => todayIST();

export async function seedTask(o: {
  title?: string; dept?: string; assignee?: string | null; by?: string | null; status?: string;
  due?: string | null; priority?: string; waitingOn?: string | null; comment?: { userId: string; kind: string; at?: string };
}): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO tasks (id, title, dept, assignee_id, assigned_by_id, priority, status, due, waiting_on, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  ).bind(id, o.title ?? "Task", o.dept ?? "Operations", o.assignee ?? null, o.by ?? null, o.priority ?? "Medium", o.status ?? "To do", o.due ?? null, o.waitingOn ?? null, now, now).run();
  if (o.comment) {
    await env.DB.prepare("INSERT INTO task_comments (id, task_id, user_id, body, kind, created_at) VALUES (?, ?, ?, 'x', ?, ?)")
      .bind(crypto.randomUUID(), id, o.comment.userId, o.comment.kind, o.comment.at ?? now).run();
  }
  return id;
}

export async function seedRecord(collection: string, title: string, data: Record<string, unknown>, o: { dept?: string; deleted?: boolean; owner?: string } = {}): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO records (id, collection, dept, owner_id, title, data, version, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
  ).bind(id, collection, o.dept ?? null, o.owner ?? null, title, JSON.stringify(data), now, now, o.deleted ? now : null).run();
  return id;
}

export async function seedLeave(userId: string, status = "Pending", kind = "Casual") {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO leave_requests (id, user_id, kind, start, "end", days, half_day, status) VALUES (?, ?, ?, '2030-01-07', '2030-01-07', 1, 0, ?)`,
  ).bind(id, userId, kind, status).run();
  return id;
}
