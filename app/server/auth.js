import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

export const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
export const PASS_MIN = 8, PASS_MAX = 128;

export function checkName(name) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) return 'Name must be 3-16 letters, digits or _';
  if (/^guest/i.test(name)) return 'Names starting with "guest" are reserved';
  return null;
}
export function checkPassword(p) {
  if (typeof p !== 'string' || p.length < PASS_MIN || p.length > PASS_MAX) return `Password must be ${PASS_MIN}-${PASS_MAX} characters`;
  return null;
}

const N = 16384, R = 8, P = 1, LEN = 64;
export function hashPassword(pass) {
  const salt = randomBytes(16);
  const key = scryptSync(pass, salt, LEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}
export function verifyPassword(pass, stored) {
  const [alg, n, r, p, salt, key] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const want = Buffer.from(key, 'base64');
  const got = scryptSync(String(pass), Buffer.from(salt, 'base64'), want.length, { N: +n, r: +r, p: +p });
  return timingSafeEqual(want, got);
}
// A dummy hash so a login for an unknown name costs the same time as a wrong password.
export const DUMMY_HASH = hashPassword('not-a-real-password');

export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = t => createHash('sha256').update(String(t)).digest('hex');

// Fixed-window counters, for login, signup and friend spam.
export class Limiter {
  constructor(max, windowMs) { this.max = max; this.windowMs = windowMs; this.hits = new Map(); }
  hit(key, now = Date.now()) {
    let h = this.hits.get(key);
    if (!h || now - h.start >= this.windowMs) { h = { start: now, n: 0 }; this.hits.set(key, h); }
    h.n++;
    if (this.hits.size > 10000) for (const [k, v] of this.hits) if (now - v.start >= this.windowMs) this.hits.delete(k);
    return h.n <= this.max;
  }
}
