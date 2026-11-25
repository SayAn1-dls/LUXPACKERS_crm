/** Returns the link only if it is an in-app path: one leading slash, no scheme, not protocol-relative, no backslash tricks. */
export function safeInternal(link: string | null | undefined): string | null {
  if (typeof link !== "string") return null;
  return /^\/(?![/\\])/.test(link) && !/[\\\u0000-\u001f]/.test(link) ? link : null;
}
