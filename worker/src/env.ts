import type { Context } from "hono";

export type Role = "admin" | "manager" | "hr" | "employee";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  dept: string;
  managerId: string | null;
  mustChangePassword: boolean;
}

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

export type AppEnv = { Bindings: Env; Variables: { user: SessionUser | null } };

export type AppContext = Context<AppEnv>;
