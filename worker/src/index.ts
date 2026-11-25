import { Hono } from "hono";
import type { Env, SessionUser } from "./env";

const app = new Hono<{ Bindings: Env; Variables: { user?: SessionUser } }>();

app.get("/api/health", (c) => c.json({ ok: true }));

app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

export default app;
