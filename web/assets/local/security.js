/* Stand-in for server/security.js when the app runs inside the browser (the trial workshop).
   Same interface, no Node. Nothing here protects anything: the data sits in this browser only,
   so passwords are kept readable – they have to be handed to the real server when the workshop
   is saved to an account. */

const enc = s => new TextEncoder().encode(String(s));
const K = new Uint32Array(64);
{
  let n = 0;
  for (let c = 2; n < 64; c++) {
    let prime = true;
    for (let d = 2; d * d <= c; d++) if (c % d === 0) { prime = false; break; }
    if (prime) K[n++] = (Math.cbrt(c) % 1) * 2 ** 32;
  }
}
function sha256(msg) {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const len = msg.length, total = Math.ceil((len + 9) / 64) * 64;
  const data = new Uint8Array(total);
  data.set(msg); data[len] = 0x80;
  const view = new DataView(data.buffer);
  view.setUint32(total - 8, Math.floor(len / 2 ** 29));
  view.setUint32(total - 4, (len << 3) >>> 0);
  const w = new Uint32Array(64);
  const rot = (x, n) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < total; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rot(w[i - 15], 7) ^ rot(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rot(w[i - 2], 17) ^ rot(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  const out = new Uint8Array(32), ov = new DataView(out.buffer);
  h.forEach((v, i) => ov.setUint32(i * 4, v));
  return out;
}
function hmacBytes(key, data) {
  let k = enc(key);
  if (k.length > 64) k = sha256(k);
  const ipad = new Uint8Array(64).fill(0x36), opad = new Uint8Array(64).fill(0x5c);
  k.forEach((b, i) => { ipad[i] ^= b; opad[i] ^= b; });
  const d = enc(data), inner = new Uint8Array(64 + d.length);
  inner.set(ipad); inner.set(d, 64);
  const outer = new Uint8Array(96);
  outer.set(opad); outer.set(sha256(inner), 64);
  return sha256(outer);
}
const b64 = bytes => { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const b64url = bytes => b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const random = n => crypto.getRandomValues(new Uint8Array(n));

export const hashPassword = pw => `local$${b64(enc(pw))}`;
export const plainPassword = stored => {
  if (typeof stored !== "string" || !stored.startsWith("local$")) return "";
  try { return new TextDecoder().decode(unb64(stored.slice(6))); } catch { return ""; }
};
export const verifyPassword = (pw, stored) => !!stored && stored === hashPassword(pw);
export const normalizePassword = pw => String(pw ?? "").trim().toLowerCase();
export const hmac = (secret, data) => b64url(hmacBytes(secret, data));
export const safeEqual = (a, b) => String(a) === String(b);

export function signToken(secret, scope, ttlSec) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  return `${exp}.${hmac(secret, `${scope}|${exp}`)}`;
}
export function checkToken(secret, scope, token) {
  if (!token || typeof token !== "string") return false;
  const [expStr, sig] = token.split(".");
  const exp = Number(expStr);
  if (!exp || exp < Date.now() / 1000) return false;
  return (sig || "") === hmac(secret, `${scope}|${exp}`);
}
export const randomId = (bytes = 9) => b64url(random(bytes));

const CONS = "bdhjklmnprstvz", VOW = "aeiou";
const word = n => Array.from(random(n * 2), (b, i) => (i % 2 ? VOW[b % VOW.length] : CONS[b % CONS.length])).join("");
export const generateCode = () => `${word(3)}-${word(3)}`;
export function normalizeCode(raw) {
  const s = String(raw ?? "").toLowerCase().replace(/[^a-z]/g, "");
  return /^[a-z]{12}$/.test(s) ? `${s.slice(0, 6)}-${s.slice(6)}` : null;
}
export const generateKey = () => b64url(random(24));
export const isKeyShaped = k => typeof k === "string" && /^[A-Za-z0-9_-]{32}$/.test(k);
export const sha256hex = s => Array.from(sha256(enc(s)), b => b.toString(16).padStart(2, "0")).join("");
export const encrypt = (secret, plain) => b64(enc(plain));
export const decrypt = (secret, data) => { try { return new TextDecoder().decode(unb64(String(data))); } catch { return null; } };
