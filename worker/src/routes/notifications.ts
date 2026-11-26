import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireUser } from "../lib/session";

export const notifications = new Hono<AppEnv>();
notifications.use("*", requireUser);

export const unreadCount = async (db: D1Database, userId: string) =>
  (await db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL").bind(userId).first<{ n: number }>())!.n;

notifications.get("/", async (c) => {
  const u = c.var.user!;
  const { results } = await c.env.DB.prepare(
    "SELECT id, kind, title, link, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 50",
  )
    .bind(u.id)
    .all<{ id: string; kind: string; title: string; link: string | null; read_at: string | null; created_at: string }>();
  return c.json({
    items: results.map((r) => ({ id: r.id, kind: r.kind, title: r.title, link: r.link, readAt: r.read_at, createdAt: r.created_at })),
    unread: await unreadCount(c.env.DB, u.id),
  });
});

const ReadBody = z.object({ ids: z.array(z.string().min(1).max(100)).max(200).optional() });

notifications.post("/read", async (c) => {
  const u = c.var.user!;
  const parsed = ReadBody.safeParse((await c.req.json().catch(() => ({}))) ?? {});
  if (!parsed.success) return c.json({ error: "invalid" }, 400);
  const now = new Date().toISOString();
  const ids = parsed.data.ids;
  if (ids === undefined) {
    await c.env.DB.prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL").bind(now, u.id).run();
  } else if (ids.length > 0) {
    await c.env.DB.prepare(
      `UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN (${ids.map(() => "?").join(",")})`,
    )
      .bind(now, u.id, ...ids)
      .run();
  }
  return c.json({ ok: true, unread: await unreadCount(c.env.DB, u.id) });
});
