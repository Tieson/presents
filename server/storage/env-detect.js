/**
 * Finds Upstash Redis / Vercel Blob credentials in the environment.
 *
 * Vercel's Storage integrations can add a custom prefix to the variables they create
 * (e.g. prefix "present" → present_KV_REST_API_URL), which is common when one database
 * is shared by several projects. We accept:
 *   1. STORAGE_ENV_PREFIX=present   → present_KV_REST_API_URL / present_UPSTASH_REDIS_REST_URL …
 *   2. no prefix                     → KV_REST_API_URL / UPSTASH_REDIS_REST_URL …
 *   3. exactly one prefixed pair     → <anything>_KV_REST_API_URL + <same>_KV_REST_API_TOKEN
 * URL and token always come from the same prefix and the same family (KV_… or UPSTASH_…).
 */
const FAMILIES = [
  ["KV_REST_API_URL", "KV_REST_API_TOKEN"],
  ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]
];

function lookup(env, name) {
  if (env[name]) return env[name];
  const hit = Object.keys(env).find(k => k.toUpperCase() === name.toUpperCase() && env[k]);
  return hit ? env[hit] : undefined;
}

export function redisFromEnv(env = process.env) {
  const prefixes = [];
  const explicit = (env.STORAGE_ENV_PREFIX || "").trim().replace(/_+$/, "");
  if (explicit) prefixes.push(`${explicit}_`);
  prefixes.push("");

  for (const p of prefixes) {
    for (const [u, t] of FAMILIES) {
      const url = lookup(env, p + u), token = lookup(env, p + t);
      if (url && token) return { url, token, prefix: p, source: p + u };
    }
  }

  // auto-detect a single prefixed pair
  const found = [];
  for (const k of Object.keys(env)) {
    for (const [u, t] of FAMILIES) {
      if (k.length > u.length && k.toUpperCase().endsWith(`_${u}`) && env[k]) {
        const p = k.slice(0, k.length - u.length);
        const token = lookup(env, p + t);
        if (token) found.push({ url: env[k], token, prefix: p, source: k });
      }
    }
  }
  const distinct = [...new Map(found.map(f => [f.url + "|" + f.token, f])).values()];
  if (distinct.length === 1) return distinct[0];
  if (distinct.length > 1) {
    const names = distinct.map(f => f.source).join(", ");
    throw new Error(`Našel jsem víc Redis databází (${names}). Nastav STORAGE_ENV_PREFIX na prefix té, kterou má aplikace používat.`);
  }
  return null;
}

/** Blob token: unprefixed, with STORAGE_ENV_PREFIX / the Redis prefix, or a single prefixed one */
export function blobTokenFromEnv(env = process.env, redisPrefix = "") {
  const explicit = (env.STORAGE_ENV_PREFIX || "").trim().replace(/_+$/, "");
  for (const p of [explicit && `${explicit}_`, redisPrefix, ""].filter(v => v !== false && v !== undefined)) {
    const v = lookup(env, `${p}BLOB_READ_WRITE_TOKEN`);
    if (v) return v;
  }
  const hits = Object.keys(env).filter(k => k.toUpperCase().endsWith("_BLOB_READ_WRITE_TOKEN") && env[k]);
  return hits.length === 1 ? env[hits[0]] : undefined;
}
