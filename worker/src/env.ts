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
  /** "pending": signed in with Google but not let in by an admin yet (may only reach /api/me and sign-out). */
  approval: "approved" | "pending";
  positionId: string | null;
  positionName: string | null;
  isAdmin: boolean;
  /** Effective permissions: ADMIN_PERMS for an admin, NO_PERMS when the position is missing or unreadable. */
  perms: Perms;
  /** Two-step sign-in is on for this person. */
  mfaEnabled: boolean;
  /** Two-step sign-in is compulsory (admins). */
  mfaRequired: boolean;
}

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Worker secret: base64 of 32 random bytes. Encrypts TOTP secrets at rest. Missing = two-step sign-in fails closed. */
  MFA_KEY?: string;
  /** Worker secrets for "Continue with Google". Missing = Google sign-in fails closed. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

export type AppEnv = { Bindings: Env; Variables: { user: SessionUser | null; /** When the current session was created (its sign-in time). */ sessionCreatedAt: string | null } };

export type AppContext = Context<AppEnv>;
