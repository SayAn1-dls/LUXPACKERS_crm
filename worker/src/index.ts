import { Hono } from "hono";
import type { AppEnv } from "./env";
import { approvalGuard, csrf, mfaGuard, readSession, requireUser } from "./lib/session";
import { auth } from "./routes/auth";
import { auditRoutes } from "./routes/audit";
import { dashboard } from "./routes/dashboard";
import { importRoutes } from "./routes/import";
import { leave } from "./routes/leave";
import { notifications } from "./routes/notifications";
import { onboarding } from "./routes/onboarding";
import { people } from "./routes/people";
import { positions } from "./routes/positions";
import { records } from "./routes/records";
import { tasks } from "./routes/tasks";
import { search } from "./routes/search";
import { settings } from "./routes/settings";
import { setup } from "./routes/setup";
import { users } from "./routes/users";

const app = new Hono<AppEnv>();

// Order matters: CSRF -> session -> waiting-for-approval guard -> admin two-step guard (all before route matching).
app.use("/api/*", csrf, readSession, approvalGuard, mfaGuard);

app.get("/api/health", (c) => c.json({ ok: true }));
app.route("/api/setup", setup);
app.route("/api/auth", auth);
app.route("/api/users", users);
app.route("/api/people", people);
app.route("/api/positions", positions);
app.route("/api/tasks", tasks);
app.route("/api/records", records);
app.route("/api/leave", leave);
app.route("/api/settings", settings);
app.route("/api/onboarding", onboarding);
app.route("/api/notifications", notifications);
app.route("/api/dashboard", dashboard);
app.route("/api/search", search);
app.route("/api/audit", auditRoutes);
app.route("/api/import", importRoutes);
app.get("/api/me", requireUser, (c) => c.json({ user: c.var.user }));

app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

export default app;
