import { ApiError } from "../api";

export const NO_PERMISSION = "You don't have permission to do that.";
const FALLBACK = "Something went wrong. Please try again.";

/** Plain-English toast text for a failed call. A 403 is always the same friendly line. */
export function errorText(e: unknown): string {
  if (!(e instanceof ApiError)) return FALLBACK;
  if (e.status === 403) return NO_PERMISSION;
  return e.message;
}
