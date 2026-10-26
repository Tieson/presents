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

  const storage = useCloud
    ? vercelStorage({ redisUrl, redisToken, blobToken: env.BLOB_READ_WRITE_TOKEN, blobAccess: env.BLOB_ACCESS || "private" })
    : fsStorage(path.resolve(env.DATA_DIR || "./data"));

  // Vercel functions accept at most ~4.5 MB request bodies
  const defaultMax = env.VERCEL ? 4 : 15;
  app = createApp({
    storage,
    adminPassword: env.ADMIN_PASSWORD,
    secret: env.APP_SECRET,
    maxUploadBytes: Number(env.MAX_UPLOAD_MB || defaultMax) * 1024 * 1024
  });
  return app;
}
