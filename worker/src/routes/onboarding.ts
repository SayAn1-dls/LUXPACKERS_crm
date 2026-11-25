import { Hono } from "hono";
import { z } from "zod";
import { ONBOARDING_STEPS } from "../../../shared/schema";
import type { AppEnv } from "../env";
import { auditStmt } from "../lib/audit";
import { requireUser } from "../lib/session";

export const onboarding = new Hono<AppEnv>();
onboarding.use("*", requireUser);

interface Row { step: string; done: number; done_by: string | null; done_at: string | null }

async function steps(db: D1Database, userId: string) {
  const { results } = await db.prepare("SELECT step, done, done_by, done_at FROM onboarding WHERE user_id = ?").bind(userId).all<Row>();
  const by = new Map(results.map((r) => [r.step, r]));
  return ONBOARDING_STEPS.map((step) => {
    const r = by.get(step);
    return { step, done: r?.done === 1, doneBy: r?.done_by ?? null, doneAt: r?.done_at ?? null };
  });
}

const target = (db: D1Database, id: string) =>
  db.prepare("SELECT id, name FROM users WHERE id = ?").bind(id).first<{ id: string; name: string }>();

onboarding.get("/:userId", async (c) => {
  const u = c.var.user!;
  const id = c.req.param("userId");
  if (u.role !== "hr" && u.role !== "admin" && u.id !== id) return c.json({ error: "forbidden" }, 403);
  if (!(await target(c.env.DB, id))) return c.json({ error: "not_found" }, 404);
  return c.json({ steps: await steps(c.env.DB, id) });
});

const PatchBody = z.object({ step: z.string(), done: z.boolean() });

onboarding.patch("/:userId", async (c) => {
  const u = c.var.user!;
  if (u.role !== "hr" && u.role !== "admin") return c.json({ error: "forbidden" }, 403);
  const db = c.env.DB;
  const id = c.req.param("userId");
  const person = await target(db, id);
  if (!person) return c.json({ error: "not_found" }, 404);
  const parsed = PatchBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success || !(ONBOARDING_STEPS as readonly string[]).includes(parsed.data.step)) return c.json({ error: "invalid" }, 400);
  const { step, done } = parsed.data;
  const now = new Date().toISOString();
  const existing = await db.prepare("SELECT id FROM onboarding WHERE user_id = ? AND step = ?").bind(id, step).first<{ id: string }>();
  const write = existing
    ? db.prepare("UPDATE onboarding SET done = ?, done_by = ?, done_at = ? WHERE id = ?").bind(done ? 1 : 0, done ? u.id : null, done ? now : null, existing.id)
    : db
        .prepare("INSERT INTO onboarding (id, user_id, step, done, done_by, done_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), id, step, done ? 1 : 0, done ? u.id : null, done ? now : null);
  await db.batch([write, auditStmt(db, u, "onboarding_updated", "user", id, person.name, { step, done })]);
  return c.json({ steps: await steps(db, id) });
});
