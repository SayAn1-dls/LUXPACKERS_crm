/* A stand-in Google for tests: a test RSA key, a mocked JWKS endpoint and a mocked token endpoint that checks the
   PKCE verifier against the challenge the Worker sent. Nothing here is imported by production code. */
import { env } from "cloudflare:workers";
import { expect, vi } from "vitest";
import app from "../src/index";

export const ORIGIN = "https://example.com";
export const CLIENT_ID = "test-client.apps.googleusercontent.com";
export const KID = "test-kid-1";

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
const sha256url = async (s: string) => b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))));

const ALG = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
let signing: CryptoKeyPair;
let other: CryptoKeyPair;
let publicJwk: JsonWebKey;

/** Codes the mock token endpoint will accept: code -> { challenge it was issued under, claims to sign }. */
const codes = new Map<string, { challenge: string; claims: Record<string, unknown>; header?: Record<string, unknown>; key?: "other" }>();
export const tokenRequests: URLSearchParams[] = [];
export let jwksFetches = 0;

export async function installGoogle(): Promise<void> {
  signing = (await crypto.subtle.generateKey(ALG, true, ["sign", "verify"])) as CryptoKeyPair;
  other = (await crypto.subtle.generateKey(ALG, true, ["sign", "verify"])) as CryptoKeyPair;
  publicJwk = await crypto.subtle.exportKey("jwk", signing.publicKey);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === "https://www.googleapis.com/oauth2/v3/certs") {
      jwksFetches++;
      return Response.json(
        { keys: [{ kty: "RSA", alg: "RS256", use: "sig", kid: KID, n: publicJwk.n, e: publicJwk.e }] },
        { headers: { "cache-control": "public, max-age=3600" } },
      );
    }
    if (url === "https://oauth2.googleapis.com/token") {
      const body = new URLSearchParams(String(init?.body ?? ""));
      tokenRequests.push(body);
      const entry = codes.get(body.get("code") ?? "");
      codes.delete(body.get("code") ?? "");
      const pkceOk = entry && (await sha256url(body.get("code_verifier") ?? "")) === entry.challenge;
      if (
        !entry || !pkceOk || body.get("grant_type") !== "authorization_code" || body.get("client_id") !== CLIENT_ID ||
        body.get("client_secret") !== "test-only-client-secret" || body.get("redirect_uri") !== `${ORIGIN}/api/auth/google/callback`
      ) {
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      return Response.json({ id_token: await signToken(entry.claims, entry.header, entry.key), access_token: "x", token_type: "Bearer" });
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  });
}

export async function signToken(claims: Record<string, unknown>, header?: Record<string, unknown>, key?: "other"): Promise<string> {
  const h = enc(header ?? { alg: "RS256", kid: KID, typ: "JWT" });
  const p = enc(claims);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", (key === "other" ? other : signing).privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(new Uint8Array(sig))}`;
}

/** Calls the Worker in-process (so the fetch mock applies), optionally with a changed environment. */
export function call(
  cookie: string | null,
  method: string,
  path: string,
  body?: unknown,
  over: Partial<typeof env> = {},
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json", origin: ORIGIN };
  if (cookie) headers.cookie = cookie;
  const req = new Request(ORIGIN + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  return app.fetch(req, { ...env, ...over } as any, { waitUntil() {}, passThroughOnException() {}, props: {} } as any) as Promise<Response>;
}

/** name=value of each Set-Cookie, keyed by name ("" value = cleared). */
export function cookiesOf(r: Response): Record<string, { value: string; raw: string }> {
  const out: Record<string, { value: string; raw: string }> = {};
  for (const raw of r.headers.getSetCookie()) {
    const [pair] = raw.split(";");
    const i = pair.indexOf("=");
    out[pair.slice(0, i)] = { value: pair.slice(i + 1), raw };
  }
  return out;
}

export interface Flow { state: string; nonce: string; challenge: string; cookie: string; location: URL }

/** "Continue with Google": returns what the Worker sent the browser to Google with. */
export async function startFlow(query = ""): Promise<Flow> {
  const r = await call(null, "GET", `/api/auth/google/start${query}`);
  expect(r.status).toBe(302);
  const location = new URL(r.headers.get("location")!);
  const c = cookiesOf(r).lux_oauth;
  expect(c?.value).toBeTruthy();
  return {
    state: location.searchParams.get("state")!,
    nonce: location.searchParams.get("nonce")!,
    challenge: location.searchParams.get("code_challenge")!,
    cookie: `lux_oauth=${c.value}`,
    location,
  };
}

export const claimsFor = (f: Flow, sub: string, email: string, over: Record<string, unknown> = {}) => {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: "https://accounts.google.com", aud: CLIENT_ID, azp: CLIENT_ID, sub, email, email_verified: true,
    name: `Person ${sub}`, iat: now, exp: now + 3600, nonce: f.nonce, ...over,
  };
};

/** Google sends the browser back. `issue` registers the code the mock token endpoint will accept. */
export async function finishFlow(
  f: Flow,
  claims: Record<string, unknown>,
  opts: { state?: string; cookie?: string | null; header?: Record<string, unknown>; key?: "other"; extraQuery?: string; over?: Partial<typeof env> } = {},
): Promise<Response> {
  const code = `code-${crypto.randomUUID()}`;
  codes.set(code, { challenge: f.challenge, claims, header: opts.header, key: opts.key });
  const q = new URLSearchParams({ state: opts.state ?? f.state, code });
  const cookie = opts.cookie === undefined ? f.cookie : opts.cookie;
  return call(cookie, "GET", `/api/auth/google/callback?${q}${opts.extraQuery ?? ""}`, undefined, opts.over);
}

/** Start + finish as `sub` / `email`. */
export async function googleSignIn(sub: string, email: string, over: Record<string, unknown> = {}): Promise<Response> {
  const f = await startFlow();
  return finishFlow(f, claimsFor(f, sub, email, over));
}

export const redirectOf = (r: Response) => r.headers.get("location");

/** The session cookie from a callback/code response, ready for `call`. */
export function sessionOf(r: Response): string | null {
  const c = cookiesOf(r).lux_session;
  return c && c.value ? `lux_session=${c.value}` : null;
}
