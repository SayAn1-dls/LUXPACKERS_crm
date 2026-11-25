import { Hono } from "hono";
import type { AppEnv } from "./env";
import { csrf, mustChangeGuard, readSession, requireUser } from "./lib/session";
import { auth } from "./routes/auth";
import { people } from "./routes/people";
import { setup } from "./routes/setup";
import { users } from "./routes/users";

const app = new Hono<AppEnv>();

// Order matters: CSRF -> session -> must-change-password guard (all before route matching).
app.use("/api/*", csrf, readSession, mustChangeGuard);

app.get("/api/health", (c) => c.json({ ok: true }));
app.route("/api/setup", setup);
app.route("/api/auth", auth);
app.route("/api/users", users);
app.route("/api/people", people);
app.get("/api/me", requireUser, (c) => c.json({ user: c.var.user }));

app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

export default app;
