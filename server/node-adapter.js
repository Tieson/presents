// Bridges Node's http (req, res) to the Web-standard handler in app.js.
// Used by the standalone server and by the Vite dev server.
import { Readable } from "node:stream";
import { getApp } from "./config.js";
import { apiPath } from "./app.js";

export async function handleApi(req, res) {
  const proto = req.headers["x-forwarded-proto"] || (req.socket.encrypted ? "https" : "http");
  const url = new URL(req.originalUrl || req.url, `${proto}://${req.headers.host || "localhost"}`);
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
}

/** Same routing the Vercel rewrites do: /admin → admin.html, /<gift-code> → index.html */
export function pageFor(pathname) {
  if (pathname === "/" ) return "/index.html";
  if (/^\/admin\/?$/.test(pathname)) return "/admin.html";
  if (/^\/[a-zA-Z-]{12,16}\/?$/.test(pathname)) return "/index.html";
  return null;
}
