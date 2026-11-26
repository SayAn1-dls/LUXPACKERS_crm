/* "Continue with Google": OAuth 2.0 authorization code flow with PKCE (S256), state and nonce, and full
   verification of the ID token Google returns (RS256 signature against Google's published keys, issuer, audience,
   expiry, nonce, verified email). Never log a code, a token or a claim. */
import type { Env } from "../env";
import { fromB64, sha256Hex } from "./crypto";

export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);
/** Clock skew allowed on exp / iat, in seconds. */
const SKEW_S = 60;

export interface GoogleConfig { clientId: string; clientSecret: string }

/** null when either secret is missing: every Google route fails closed. */
export function googleConfig(env: Pick<Env, "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET">): GoogleConfig | null {
  const clientId = (env.GOOGLE_CLIENT_ID ?? "").trim();
  const clientSecret = (env.GOOGLE_CLIENT_SECRET ?? "").trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export const redirectUri = (requestUrl: string) => `${new URL(requestUrl).origin}/api/auth/google/callback`;

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64Url(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("bad base64url");
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return fromB64(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
}

async function sha256B64Url(s: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))));
}

/** The PKCE verifier and the nonce are derived from the browser-binding cookie secret, so the database never
    holds anything that could finish a sign-in. Both are 43 base64url characters (RFC 7636 allows 43-128). */
export const pkceVerifier = (browserSecret: string) => sha256B64Url(`luxcrm-pkce:${browserSecret}`);
export const oauthNonce = (browserSecret: string) => sha256B64Url(`luxcrm-nonce:${browserSecret}`);
export const pkceChallenge = (verifier: string) => sha256B64Url(verifier);

export function authorizeUrl(cfg: GoogleConfig, redirect: string, state: string, nonce: string, challenge: string): string {
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirect,
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return u.toString();
}

/** Exchanges the code (server to server, with the client secret and the PKCE verifier). The raw ID token, or null. */
export async function exchangeCode(cfg: GoogleConfig, code: string, redirect: string, verifier: string): Promise<string | null> {
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: redirect,
        code_verifier: verifier,
      }).toString(),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { id_token?: unknown };
    return typeof body.id_token === "string" ? body.id_token : null;
  } catch {
    return null;
  }
}

/* ---------- Google's signing keys ---------- */

interface Jwk { kid?: string; kty?: string; alg?: string; n?: string; e?: string; use?: string }
let jwks: { keys: Jwk[]; until: number } | null = null;
const imported = new Map<string, Promise<CryptoKey>>();

async function loadJwks(force: boolean): Promise<Jwk[]> {
  if (!force && jwks && jwks.until > Date.now()) return jwks.keys;
  const res = await fetch(JWKS_URL, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error("jwks");
  const body = (await res.json()) as { keys?: unknown };
  const keys = Array.isArray(body.keys) ? (body.keys as Jwk[]) : [];
  const m = /max-age=(\d+)/i.exec(res.headers.get("cache-control") ?? "");
  // Cache for Google's max-age (capped at a day); without one, five minutes.
  const ttl = Math.min(m ? Number(m[1]) : 300, 86_400) * 1000;
  jwks = { keys, until: Date.now() + ttl };
  return keys;
}

async function keyFor(kid: string): Promise<CryptoKey | null> {
  let keys = await loadJwks(false);
  let jwk = keys.find((k) => k.kid === kid);
  // A kid we have not seen may be a freshly rotated key: fetch once more.
  if (!jwk) {
    keys = await loadJwks(true);
    jwk = keys.find((k) => k.kid === kid);
  }
  if (!jwk || jwk.kty !== "RSA" || !jwk.n || !jwk.e || (jwk.alg && jwk.alg !== "RS256")) return null;
  const cacheKey = `${kid}:${jwk.n}`;
  let p = imported.get(cacheKey);
  if (!p) {
    p = crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    imported.set(cacheKey, p);
    p.catch(() => imported.delete(cacheKey));
  }
  return p;
}

/* ---------- the ID token ---------- */

export interface GoogleIdentity { sub: string; email: string; name: string }

/** Verifies everything that matters. null on any failure; never throws. */
export async function verifyIdToken(token: string, clientId: string, expectedNonce: string): Promise<GoogleIdentity | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const dec = new TextDecoder();
    const header = JSON.parse(dec.decode(fromB64Url(parts[0]))) as { alg?: unknown; kid?: unknown };
    if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid) return null;
    const key = await keyFor(header.kid);
    if (!key) return null;
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      fromB64Url(parts[2]) as BufferSource,
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!ok) return null;

    const c = JSON.parse(dec.decode(fromB64Url(parts[1]))) as Record<string, unknown>;
    const now = Math.floor(Date.now() / 1000);
    if (typeof c.iss !== "string" || !ISSUERS.has(c.iss)) return null;
    if (c.aud !== clientId) return null;
    if (c.azp !== undefined && c.azp !== clientId) return null;
    if (typeof c.exp !== "number" || c.exp + SKEW_S <= now) return null;
    if (typeof c.iat !== "number" || c.iat - SKEW_S > now) return null;
    if (typeof c.nonce !== "string" || (await sha256Hex(c.nonce)) !== (await sha256Hex(expectedNonce))) return null;
    if (c.email_verified !== true) return null;
    if (typeof c.sub !== "string" || !c.sub || c.sub.length > 255) return null;
    if (typeof c.email !== "string" || !/^[^\s@]+@[^\s@]+$/.test(c.email) || c.email.length > 320) return null;
    const email = c.email.trim().toLowerCase();
    const name = (typeof c.name === "string" && c.name.trim()) || email.split("@")[0];
    return { sub: c.sub, email, name: name.slice(0, 200) };
  } catch {
    return null;
  }
}
