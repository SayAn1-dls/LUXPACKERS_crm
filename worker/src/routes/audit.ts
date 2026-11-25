import { Hono } from "hono";
import type { AppEnv } from "../env";
import { auditFeed } from "../lib/auditFeed";
import { requireUser } from "../lib/session";

export const auditRoutes = new Hono<AppEnv>();
auditRoutes.use("*", requireUser);

auditRoutes.get("/", async (c) => {
  if (c.var.user!.role !== "admin") return c.json({ error: "forbidden" }, 403);
  const rawLimit = c.req.query("limit");
  let limit = 100;
  if (rawLimit !== undefined) {
    if (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1) return c.json({ error: "invalid" }, 400);
    limit = Math.min(Number(rawLimit), 200);
  }
  const before = c.req.query("before");
  if (before !== undefined && (Number.isNaN(Date.parse(before)) || !/^\d{4}-\d{2}-\d{2}T/.test(before))) {
    return c.json({ error: "invalid" }, 400);
  }
  const rows = await auditFeed(c.env.DB, limit + 1, before);
  const items = rows.slice(0, limit);
  return c.json({ items, next: rows.length > limit ? items[items.length - 1].at : null });
});
