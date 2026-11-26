import type { Context } from "hono";
import type { Perms, RoleName } from "../../shared/schema";

/** Display label only (derived from the position). Permissions come from isAdmin / perms via lib/policy.ts. */
export type Role = RoleName;

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  dept: string;
  managerId: string | null;
  mustChangePassword: boolean;
  positionId: string | null;
  positionName: string | null;
  isAdmin: boolean;
  /** Effective permissions: ADMIN_PERMS for an admin, NO_PERMS when the position is missing or unreadable. */
  perms: Perms;
}

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

export type AppEnv = { Bindings: Env; Variables: { user: SessionUser | null } };

export type AppContext = Context<AppEnv>;
