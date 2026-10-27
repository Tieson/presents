// Standalone Node server (VPS, Docker): `npm run build && npm start`
// Serves the built frontend from dist/ and the API from the same process.
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./env.js";
import { handleApi, pageFor } from "./node-adapter.js";

loadEnv();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const PORT = Number(process.env.PORT || 3000);

if (!fs.existsSync(path.join(root, "index.html"))) {
  console.error("Chybí dist/. Nejdřív spusť `npm run build`.");
  process.exit(1);
}

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".woff2": "font/woff2"
};

async function serveStatic(res, pathname) {
  const rel = pageFor(pathname) || decodeURIComponent(pathname);
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  const stat = await fsp.stat(file).catch(() => null);
  if (!stat?.isFile()) { res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Nenalezeno"); return; }
  const hashed = rel.startsWith("/assets/");
  res.writeHead(200, {
    "content-type": TYPES[path.extname(file)] || "application/octet-stream",
    "content-length": stat.size,
    "cache-control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
    "x-content-type-options": "nosniff"
  });
  fs.createReadStream(file).pipe(res);
}

http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, "http://x");
    if (pathname.startsWith("/api/")) await handleApi(req, res);
    else await serveStatic(res, pathname);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
    res.end("Server error");
  }
}).listen(PORT, () => console.log(`🎁 Vánoční dárky: http://localhost:${PORT}  (dílna: /admin)`));
