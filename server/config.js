import path from "node:path";
import { createApp } from "./app.js";
import { fsStorage } from "./storage/fs.js";
import { vercelStorage } from "./storage/vercel.js";
import { redisFromEnv, blobTokenFromEnv } from "./storage/env-detect.js";

let app;

/** Picks storage from the environment and builds the request handler once. */
export function getApp() {
  if (app) return app;
  const env = process.env;
  const redis = env.STORAGE === "fs" ? null : redisFromEnv(env);
  const useCloud = !!redis;

  if (env.STORAGE === "vercel" && !redis) {
    throw new Error("STORAGE=vercel, ale nenašel jsem přístup k Redisu (KV_REST_API_URL + KV_REST_API_TOKEN nebo UPSTASH_REDIS_REST_URL + _TOKEN, případně s prefixem).");
  }
  if (env.VERCEL && !useCloud) {
    throw new Error("Na Vercelu chybí úložiště: připoj Upstash for Redis (Storage → Marketplace) a proveď Redeploy. Pokud má proměnné s prefixem, nastav STORAGE_ENV_PREFIX.");
  }
  if (!env.APP_SECRET || env.APP_SECRET.length < 16) {
    throw new Error("Chybí proměnná APP_SECRET (aspoň 16 znaků, třeba z `openssl rand -base64 32`). Podepisuje přihlášení a šifruje odkazy do dílen.");
  }
  const storage = useCloud
    ? vercelStorage({
        redisUrl: redis.url,
        redisToken: redis.token,
        blobToken: blobTokenFromEnv(env, redis.prefix),
        blobAccess: env.BLOB_ACCESS || "private",
        keyPrefix: env.REDIS_KEY_PREFIX || "xd:"
      })
    : fsStorage(path.resolve(env.DATA_DIR || "./data"));

  // Vercel functions accept at most ~4.5 MB request bodies
  const defaultMax = env.VERCEL ? 4 : 15;
  app = createApp({
    storage,
    secret: env.APP_SECRET,
    maxUploadBytes: Number(env.MAX_UPLOAD_MB || defaultMax) * 1024 * 1024,
    maxGifts: Number(env.MAX_GIFTS || 50),
    maxStorageBytes: Number(env.MAX_STORAGE_MB || 100) * 1024 * 1024,
    signupCode: (env.SIGNUP_CODE || "").trim()
  });
  return app;
}
