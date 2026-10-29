// npm test           → runs tests/api.mjs against the Node API twice:
//                      1) file storage, 2) Vercel storage (Redis + Blob) backed by in-memory fakes
// npm test -- <url>  → runs the same tests against any running backend (e.g. PHP)
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "../tests/api.mjs";

const [url] = process.argv.slice(2);
let failedTotal = 0;

async function suite(label, base) {
  console.log(`\n${label} – ${base}\n`);
  const { passed, failed } = await run(base);
  console.log(`\n${passed} prošlo, ${failed} selhalo`);
  failedTotal += failed;
}
const listen = srv => new Promise(r => srv.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${srv.address().port}`)));

if (url) {
  await suite("API testy", url);
} else {
  process.env.APP_SECRET = "test-secret-0123456789";
  const { createApp, apiPath } = await import("../server/app.js");
  const { fsStorage } = await import("../server/storage/fs.js");
  const { vercelStorage } = await import("../server/storage/vercel.js");
  const { Readable } = await import("node:stream");

  // minimal Node http → Web handler bridge for an explicit app instance
  const serve = app => http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://localhost");
    const r = await app(new Request(u, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Readable.toWeb(req), duplex: "half" }), apiPath(u.href));
    const h = {}; r.headers.forEach((v, k) => { h[k] = v; });
    res.writeHead(r.status, h);
    if (r.body) Readable.fromWeb(r.body).pipe(res); else res.end();
  });

  // 1) file storage
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xd-test-"));
  const s1 = serve(createApp({ storage: fsStorage(tmp), secret: process.env.APP_SECRET }));
  await suite("Node + souborové úložiště", await listen(s1));
  s1.close(); fs.rmSync(tmp, { recursive: true, force: true });

  // 2) Vercel storage against a fake Upstash REST endpoint + fake Blob
  const hashes = new Map(), sets = new Map();
  const H = k => hashes.get(k) ?? hashes.set(k, new Map()).get(k);
  const S = k => sets.get(k) ?? sets.set(k, new Set()).get(k);
  const redisSrv = http.createServer((req, res) => {
    let body = ""; req.on("data", c => body += c); req.on("end", () => {
      const [cmd, key, ...a] = JSON.parse(body);
      let result = null;
      switch (cmd) {
        case "HGET": result = H(key).get(a[0]) ?? null; break;
        case "HSET": H(key).set(a[0], a[1]); result = 1; break;
        case "HDEL": result = H(key).delete(a[0]) ? 1 : 0; break;
        case "HMGET": result = a.map(f => H(key).get(f) ?? null); break;
        case "SADD": S(key).add(a[0]); result = 1; break;
        case "SREM": result = S(key).delete(a[0]) ? 1 : 0; break;
        case "SMEMBERS": result = [...S(key)]; break;
        case "SCARD": result = S(key).size; break;
        case "DEL": for (const k of [key, ...a]) { hashes.delete(k); sets.delete(k); } result = 1; break;
        default: res.end(JSON.stringify({ error: `unsupported ${cmd}` })); return;
      }
      res.end(JSON.stringify({ result }));
    });
  });
  const redisUrl = await listen(redisSrv);
  const blobs = new Map();
  const blobImpl = {
    put: async (p, buf) => { const url = `blob://${p}-${Math.random().toString(36).slice(2)}`; blobs.set(url, Buffer.from(buf)); return { url }; },
    get: async url => blobs.has(url) ? { statusCode: 200, stream: Readable.toWeb(Readable.from([blobs.get(url)])) } : null,
    del: async url => { blobs.delete(url); }
  };
  const check = (ok, msg) => { console.log((ok ? "  ✓ " : "  ✗ ") + msg); if (!ok) failedTotal++; };
  const s2 = serve(createApp({ storage: vercelStorage({ redisUrl, redisToken: "t", blobImpl, keyPrefix: "present:" }), secret: process.env.APP_SECRET }));
  // record every key the app touches, to prove it stays inside its namespace in a shared database
  const touched = new Set();
  redisSrv.prependListener("request", req => { let b = ""; req.on("data", c => b += c); req.on("end", () => { try { const [, k, ...rest] = JSON.parse(b); touched.add(k); if (JSON.parse(b)[0] === "DEL") rest.forEach(x => touched.add(x)); } catch {} }); });
  await suite("Node + Vercel úložiště (Redis/Blob v paměti, prefix klíčů present:)", await listen(s2));
  const leftovers = [...hashes.values()].reduce((n, m) => n + m.size, 0) + [...sets.values()].reduce((n, s) => n + s.size, 0) + blobs.size;
  check(leftovers === 0, leftovers === 0 ? "po smazání dílen nezůstala v Redisu ani Blobu žádná data" : `v úložišti zůstalo ${leftovers} záznamů`);
  const outside = [...touched].filter(k => !String(k).startsWith("present:"));
  check(touched.size > 0 && outside.length === 0, outside.length ? `klíče mimo prefix: ${outside.join(", ")}` : `všech ${touched.size} použitých klíčů v Redisu začíná na present:`);
  s2.close();

  // 3) the real config path: Redis credentials only under a Vercel integration prefix
  const { redisFromEnv } = await import("../server/storage/env-detect.js");
  const det = redisFromEnv({ present_KV_REST_API_URL: redisUrl, present_KV_REST_API_TOKEN: "t", present_KV_REST_API_READ_ONLY_TOKEN: "ro" });
  check(det?.url === redisUrl && det.prefix === "present_", "najde Redis z proměnných present_KV_REST_API_*");
  let amb = null; try { redisFromEnv({ a_KV_REST_API_URL: "x", a_KV_REST_API_TOKEN: "y", b_KV_REST_API_URL: "z", b_KV_REST_API_TOKEN: "w" }); } catch (e) { amb = e.message; }
  check(/STORAGE_ENV_PREFIX/.test(amb || ""), "dvě databáze s různým prefixem → srozumitelná chyba");
  for (const k of Object.keys(process.env)) if (/KV_REST_API|UPSTASH_REDIS|^STORAGE$|^DATA_DIR$/.test(k)) delete process.env[k];
  Object.assign(process.env, { VERCEL: "1", present_KV_REST_API_URL: redisUrl, present_KV_REST_API_TOKEN: "t", REDIS_KEY_PREFIX: "present:" });
  const { getApp } = await import("../server/config.js");
  const r = await getApp()(new Request("http://h/api/workshop", { method: "POST", headers: { "x-admin": "1", "content-type": "application/json" }, body: JSON.stringify({ name: "Přes prefix" }) }), "workshop");
  const body = await r.json();
  check(r.status === 201 && body.workshop?.name === "Přes prefix" && [...hashes.keys()].includes("present:workshops"), "getApp na Vercelu s proměnnými present_… založí dílnu v Redisu");
  redisSrv.close();
}

process.exit(failedTotal ? 1 : 0);
