/* One fetch wrapper for the whole app. Paths may be written "/notifications" or "/api/notifications". */

export class ApiError extends Error {
  status: number;
  code: string;
  /** Set when the server names the field that failed validation. */
  field?: string;
  constructor(status: number, code: string, message: string, field?: string) {
    super(message);
    this.field = field;
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export interface ApiHooks {
  /** Called on any 401 (the session is gone). */
  onUnauthorized?: () => void;
  /** Called on 403 must_change_password. */
  onMustChangePassword?: () => void;
}

const hooks: ApiHooks = {};
export function setApiHooks(next: ApiHooks) {
  hooks.onUnauthorized = next.onUnauthorized;
  hooks.onMustChangePassword = next.onMustChangePassword;
}

const FALLBACK = "Something went wrong. Please try again.";

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = path.startsWith("/api/") ? path : `/api${path.startsWith("/") ? "" : "/"}${path}`;
  const init: RequestInit = { method, credentials: "same-origin" };
  if (method !== "GET") {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body ?? {});
  }

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError(0, "network", "Could not reach the server. Check the internet connection and try again.");
  }

  const data: unknown = await res.json().catch(() => null);
  if (res.ok) return data as T;

  const obj = (data && typeof data === "object" ? data : {}) as { error?: unknown; message?: unknown; field?: unknown };
  const code = typeof obj.error === "string" ? obj.error : "error";
  const message = typeof obj.message === "string" ? obj.message : FALLBACK;

  if (res.status === 401) {
    const p = window.location.pathname;
    if (p !== "/login" && p !== "/setup") hooks.onUnauthorized?.();
  } else if (res.status === 403 && code === "must_change_password") {
    hooks.onMustChangePassword?.();
  }
  throw new ApiError(res.status, code, message, typeof obj.field === "string" ? obj.field : undefined);
}
