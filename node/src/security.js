import crypto from "node:crypto";

const ITER = 210000;

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(String(pw), salt, ITER, 32, "sha256");
  return `pbkdf2_sha256$${ITER}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(pw, stored) {
  if (!stored || typeof stored !== "string") return false;
  const [algo, iter, saltB64, hashB64] = stored.split("$");
  if (algo !== "pbkdf2_sha256") return false;
  const expected = Buffer.from(hashB64, "base64");
  const got = crypto.pbkdf2Sync(String(pw), Buffer.from(saltB64, "base64"), Number(iter), expected.length, "sha256");
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

export function normalizePassword(pw) {
  return String(pw ?? "").trim().toLowerCase();
}

const b64url = buf => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function hmac(secret, data) {
  return b64url(crypto.createHmac("sha256", secret).update(data).digest());
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** token = "<exp>.<sig>" ; sig = HMAC(secret, scope|exp) */
export function signToken(secret, scope, ttlSec) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  return `${exp}.${hmac(secret, `${scope}|${exp}`)}`;
}

export function checkToken(secret, scope, token) {
  if (!token || typeof token !== "string") return false;
  const [expStr, sig] = token.split(".");
  const exp = Number(expStr);
  if (!exp || exp < Date.now() / 1000) return false;
  return safeEqual(sig || "", hmac(secret, `${scope}|${exp}`));
}

export function randomId(bytes = 9) {
  return b64url(crypto.randomBytes(bytes));
}

/* Memorable codes built from Czech-friendly syllables: "bekalo-mitusa" */
const CONS = "bdhjklmnprstvz";
const VOW = "aeiou";
function word(n) {
  let w = "";
  for (let i = 0; i < n; i++) {
    w += CONS[crypto.randomInt(CONS.length)] + VOW[crypto.randomInt(VOW.length)];
  }
  return w;
}
export function generateCode() {
  return `${word(3)}-${word(3)}`;
}

/** Accepts "Bekalo Mitusa", "bekalomitusa", "bekalo-mitusa" → "bekalo-mitusa" */
export function normalizeCode(raw) {
  const s = String(raw ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (!/^[a-z]{12}$/.test(s)) return null;
  return `${s.slice(0, 6)}-${s.slice(6)}`;
}
