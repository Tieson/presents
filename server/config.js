import path from "node:path";
import { createApp } from "./app.js";
import { fsStorage } from "./storage/fs.js";
import { vercelStorage } from "./storage/vercel.js";

let app;

/** Picks storage from the environment and builds the request handler once. */
export function getApp() {
  if (app) return app;
  const env = process.env;
  const redisUrl = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const redisToken = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  const useCloud = env.STORAGE === "vercel" || (env.STORAGE !== "fs" && redisUrl && redisToken);

  if (env.VERCEL && !useCloud) {
    throw new Error("Na Vercelu chybí úložiště: připoj Upstash for Redis (Storage → Marketplace) a proveď Redeploy.");
  }
  if (!env.APP_SECRET || env.APP_SECRET.length < 16) {
    throw new Error("Chybí proměnná APP_SECRET (aspoň 16 znaků, třeba z `openssl rand -base64 32`). Podepisuje přihlášení a šifruje odkazy do dílen.");
  }
  const storage = useCloud
    ? vercelStorage({ redisUrl, redisToken, blobToken: env.BLOB_READ_WRITE_TOKEN, blobAccess: env.BLOB_ACCESS || "private" })
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
