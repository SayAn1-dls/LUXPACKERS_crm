import type { Context } from "hono";

export type Role = "admin" | "manager" | "hr" | "employee";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  dept: string;
  manager_id: string | null;
  must_change_password: number;
}

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

export type AppContext = Context<{ Bindings: Env; Variables: { user?: SessionUser } }>;
