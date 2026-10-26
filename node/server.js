// Standalone Node server (VPS, Docker, local dev): `node server.js`
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { getApp } from "./src/config.js";
import { apiPath } from "./src/app.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const PORT = Number(process.env.PORT || 3000);

// Minimal .env loader (no dependency)
try {
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* no .env */ }

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".webmanifest": "application/manifest+json"
};

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === "/" ) rel = "/index.html";
  else if (rel === "/admin" || rel === "/admin/") rel = "/admin.html";
  let file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  let stat = await fsp.stat(file).catch(() => null);
  if (!stat || !stat.isFile()) {
    // Unknown single-segment paths are gift codes → recipient page
    if (path.extname(rel)) { res.writeHead(404).end("Not found"); return; }
    file = path.join(root, "index.html");
    stat = await fsp.stat(file);
  }
  res.writeHead(200, {
    "content-type": TYPES[path.extname(file)] || "application/octet-stream",
    "content-length": stat.size,
    "cache-control": file.endsWith(".html") ? "no-cache" : "public, max-age=3600"
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const proto = req.headers["x-forwarded-proto"] || "http";
    const url = new URL(req.url, `${proto}://${req.headers.host || "localhost"}`);
    if (!url.pathname.startsWith("/api/")) return await serveStatic(req, res, url.pathname);

    const hasBody = !["GET", "HEAD"].includes(req.method);
    const request = new Request(url, {
      method: req.method,
      headers: req.headers,
      body: hasBody ? Readable.toWeb(req) : undefined,
      duplex: "half"
    });
    const response = await getApp()(request, apiPath(url.href));
    const headers = {};
    response.headers.forEach((v, k) => { headers[k] = v; });
    const cookies = response.headers.getSetCookie?.() || [];
    if (cookies.length) headers["set-cookie"] = cookies;
    res.writeHead(response.status, headers);
    if (response.body) Readable.fromWeb(response.body).pipe(res);
    else res.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
    res.end("Server error");
  }
});

server.listen(PORT, () => console.log(`🎁 Vánoční dárky běží na http://localhost:${PORT}  (dílna: /admin)`));
