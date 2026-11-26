const ITERATIONS = 100_000;

export function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toB64Url(bytes: Uint8Array): string {
  return toB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

const SCHEME = "pbkdf2-sha256";

/**
 * hash is the versioned string `pbkdf2-sha256$<iterations>$<saltB64>$<hashB64>`; verifyPassword reads the
 * iteration count back from it. salt (raw, base64) is returned only because the legacy password_salt
 * column is NOT NULL: callers still write it, nothing reads it.
 */
export async function hashPassword(pw: string): Promise<{ hash: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltB64 = toB64(salt);
  const derived = toB64(await derive(pw, salt, ITERATIONS));
  return { hash: `${SCHEME}$${ITERATIONS}$${saltB64}$${derived}`, salt: saltB64 };
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split("$");
    if (parts.length !== 4 || parts[0] !== SCHEME || !/^[0-9]{1,7}$/.test(parts[1])) return false;
    const iterations = Number(parts[1]);
    if (iterations < 1) return false;
    const salt = fromB64(parts[2]);
    const expected = fromB64(parts[3]);
    if (salt.length === 0 || expected.length === 0) return false;
    return timingSafeEqual(await derive(pw, salt, iterations), expected);
  } catch {
    return false;
  }
}

export function randomToken(): string {
  return toB64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
