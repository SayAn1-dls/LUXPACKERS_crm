/* TOTP (RFC 6238 over RFC 4226 HOTP) with WebCrypto HMAC-SHA1: 30-second steps, 6 digits, one step of drift either side.
   Pure: no DB. Replay protection (the last accepted step) is the caller's job, via `lastStep`. */
import { timingSafeEqual } from "./crypto";

export const PERIOD_S = 30;
export const DIGITS = 6;
export const ISSUER = "Luxpackers";
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** Case-insensitive; ignores spaces, dashes and "=" padding. null for anything else. */
export function base32Decode(input: string): Uint8Array | null {
  const s = input.toUpperCase().replace(/[\s=-]/g, "");
  if (!s || !/^[A-Z2-7]+$/.test(s)) return null;
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of s) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** A new 20-byte (160-bit) secret, base32 encoded. */
export function generateSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

export function otpauthUri(email: string, secret: string): string {
  return `otpauth://totp/${ISSUER}:${encodeURIComponent(email)}?secret=${secret}&issuer=${ISSUER}&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD_S}`;
}

export const stepAt = (nowMs: number) => Math.floor(nowMs / 1000 / PERIOD_S);

/** RFC 4226 HOTP with dynamic truncation. */
export async function hotp(key: Uint8Array, counter: number, digits = DIGITS): Promise<string> {
  const msg = new Uint8Array(8);
  // 64-bit big-endian counter (steps fit comfortably in 53 bits).
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c % 256;
    c = Math.floor(c / 256);
  }
  const k = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, msg));
  const off = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

/** The 6-digit code for `secret` (base32) at `nowMs`. Throws on a malformed secret. */
export async function totpAt(secret: string, nowMs: number): Promise<string> {
  const key = base32Decode(secret);
  if (!key) throw new Error("bad secret");
  return hotp(key, stepAt(nowMs));
}

/**
 * Checks `code` against the steps now-1, now and now+1, skipping any step at or before `lastStep`.
 * Returns the matching step (store it as the new lastStep) or null. Every candidate is computed and compared in
 * constant time, so timing does not reveal which step matched.
 */
export async function verifyTotp(secret: string, code: string, nowMs: number, lastStep: number | null): Promise<number | null> {
  const key = base32Decode(secret);
  if (!key || !/^\d{6}$/.test(code)) return null;
  const given = new TextEncoder().encode(code);
  const now = stepAt(nowMs);
  let match: number | null = null;
  for (const step of [now - 1, now, now + 1]) {
    const ok = timingSafeEqual(new TextEncoder().encode(await hotp(key, step)), given);
    if (ok && (lastStep === null || step > lastStep) && match === null) match = step;
  }
  return match;
}
