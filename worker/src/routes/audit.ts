import { Hono } from "hono";
import type { AppEnv } from "../env";
import { auditPage, parseCursor } from "../lib/auditFeed";
import { canSeeAudit } from "../lib/policy";
import { requireUser } from "../lib/session";

export const auditRoutes = new Hono<AppEnv>();
auditRoutes.use("*", requireUser);

auditRoutes.get("/", async (c) => {
  if (!canSeeAudit(c.var.user!)) return c.json({ error: "forbidden" }, 403);
  const rawLimit = c.req.query("limit");
  let limit = 100;
  if (rawLimit !== undefined) {
    if (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1) return c.json({ error: "invalid" }, 400);
    limit = Math.min(Number(rawLimit), 200);
  }
  const raw = c.req.query("before");
  const before = raw === undefined ? undefined : parseCursor(raw);
  if (before === null) return c.json({ error: "invalid" }, 400);
  return c.json(await auditPage(c.env.DB, limit, before));
});
