import { env, exports } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";

export async function applyMigrations(e: typeof env = env): Promise<void> {
  await applyD1Migrations(e.DB, e.TEST_MIGRATIONS);
}

export function api(
  cookie: string | null,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const origin = "https://example.com";
  const headers: Record<string, string> = { "content-type": "application/json", origin };
  if (cookie) headers.cookie = cookie;
  return exports.default.fetch(
    new Request(origin + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}
