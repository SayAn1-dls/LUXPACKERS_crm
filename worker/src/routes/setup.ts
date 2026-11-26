import { Hono } from "hono";
import type { AppEnv } from "../env";

/* First-ever setup: while there are no accounts, the first person to finish "Continue with Google" becomes the Admin
   (see routes/auth.ts). This only reports whether that is still to happen. */
export const setup = new Hono<AppEnv>();

setup.get("/", async (c) => {
  const row = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
  return c.json({ needed: (row?.n ?? 0) === 0 });
});

setup.post("/", (c) => c.json({ error: "google_only" }, 410));
