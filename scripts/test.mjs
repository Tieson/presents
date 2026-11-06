// npm test           → runs tests/api.mjs against the Node API twice:
//                      1) file storage, 2) Vercel storage (Redis + Blob) backed by in-memory fakes
// npm test -- <url>  → runs the same tests against any running backend (e.g. PHP)
// npm test -- <url> --mail 2525  → also the e-mail tests; the backend must send SMTP to 127.0.0.1:2525,
//                      have APP_URL=https://darky.example.cz and a 1 s gap between e-mails (MAIL_GAP_SECONDS=1)
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "../tests/api.mjs";
import { runMail, smtpSink, MAIL_APP_URL } from "../tests/mail.mjs";
import { runNotify, pushSink } from "../tests/notify.mjs";

const args = process.argv.slice(2);
const url = args.find(a => /^https?:/.test(a));
const mailPort = args.includes("--mail") ? Number(args[args.indexOf("--mail") + 1] || 2525) : 0;
// --notify <smtpPort>:<pushPort>:<VAPID public key>  (backend: SMTP → smtpPort, PUSH_TEST_SINK=http://127.0.0.1:<pushPort>/, CRON_SECRET=cron-test)
const notifyArg = args.includes("--notify") ? args[args.indexOf("--notify") + 1].split(":") : null;
let failedTotal = 0;

async function suite(label, base, fn = run) {
  console.log(`\n${label} – ${base}\n`);
  const { passed, failed } = await fn(base);
  console.log(`\n${passed} prošlo, ${failed} selhalo`);
  failedTotal += failed;
}
const listen = srv => new Promise(r => srv.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${srv.address().port}`)));

if (url) {
  await suite("API testy", url);
  if (mailPort) {
    const sink = await smtpSink(mailPort);
    await suite(`E-maily (SMTP sink na portu ${mailPort})`, url, b => runMail(b, sink));
    sink.close();
  }
  if (notifyArg) {
    const [mp, pp, publicKey] = notifyArg;
    const mail = await smtpSink(Number(mp)), push = await pushSink(Number(pp));
    await suite("Upozornění (e-mail + Web Push)", url, b => runNotify(b, { mail, push, publicKey }));
    mail.close(); push.close();
  }
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
  const zsets = new Map();
  const Z = k => zsets.get(k) ?? zsets.set(k, new Map()).get(k);
  function exec([cmd, key, ...a]) {
    switch (cmd) {
      case "HGET": return H(key).get(a[0]) ?? null;
      case "HSET": H(key).set(a[0], String(a[1])); return 1;
      case "HSETNX": if (H(key).has(a[0])) return 0; H(key).set(a[0], String(a[1])); return 1;
      case "HINCRBY": { const v = Number(H(key).get(a[0]) || 0) + Number(a[1]); H(key).set(a[0], String(v)); return v; }
      case "HGETALL": return [...(hashes.get(key) || new Map())].flat();
      case "HDEL": return H(key).delete(a[0]) ? 1 : 0;
      case "HMGET": return a.map(f => H(key).get(f) ?? null);
      case "SADD": S(key).add(a[0]); return 1;
      case "SREM": return S(key).delete(a[0]) ? 1 : 0;
      case "SMEMBERS": return [...S(key)];
      case "SCARD": return S(key).size;
      case "ZADD": { const z = Z(key); z.set(a[1], Number(a[0])); return 1; }
      case "ZREM": return Z(key).delete(a[0]) ? 1 : 0;
      case "ZRANGEBYSCORE": { const max = a[1] === "+inf" ? Infinity : Number(a[1]); return [...Z(key)].filter(([, sc]) => sc >= Number(a[0] === "-inf" ? -Infinity : a[0]) && sc <= max).sort((x, y) => x[1] - y[1]).map(([m]) => m); }
      case "DEL": for (const k of [key, ...a]) { hashes.delete(k); sets.delete(k); zsets.delete(k); } return 1;
      default: throw new Error(`unsupported ${cmd}`);
    }
  }
  // drop empty hashes/sets, like Redis does
  const tidy = () => { for (const m of [hashes, sets, zsets]) for (const [k, v] of m) if (!v.size) m.delete(k); };
  const redisSrv = http.createServer((req, res) => {
    let body = ""; req.on("data", c => body += c); req.on("end", () => {
      const parsed = JSON.parse(body);
      try {
        if (req.url.endsWith("/pipeline")) res.end(JSON.stringify(parsed.map(c => ({ result: exec(c) }))));
        else res.end(JSON.stringify({ result: exec(parsed) }));
      } catch (e) { res.end(JSON.stringify({ error: e.message })); }
      tidy();
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
  redisSrv.prependListener("request", req => { let b = ""; req.on("data", c => b += c); req.on("end", () => { try {
    const p = JSON.parse(b);
    for (const [cmd, k, ...rest] of req.url.endsWith("/pipeline") ? p : [p]) { touched.add(k); if (cmd === "DEL") rest.forEach(x => touched.add(x)); }
  } catch {} }); });
  await suite("Node + Vercel úložiště (Redis/Blob v paměti, prefix klíčů present:)", await listen(s2));
  const leftovers = [...hashes.values()].reduce((n, m) => n + m.size, 0) + [...sets.values()].reduce((n, s) => n + s.size, 0) + [...zsets.values()].reduce((n, z) => n + z.size, 0) + blobs.size;
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
  // Redis storage: notification schedule, subscriptions, inbox, stats
  const vs = vercelStorage({ redisUrl, redisToken: "t", blobImpl, keyPrefix: "present:" });
  await vs.setDue("aaa-bbb", 1000); await vs.setDue("ccc-ddd", Date.now() + 1e6);
  const due = await vs.dueCodes(Date.now());
  const c1 = await vs.claimDue("aaa-bbb"), c2 = await vs.claimDue("aaa-bbb");
  check(due.length === 1 && due[0] === "aaa-bbb" && c1 && !c2, "Redis: plán upozornění, jen jeden si ho převezme");
  await vs.addSub("g:aaa-bbb", "h1", { endpoint: "https://fcm.googleapis.com/x" }); await vs.putInbox("h1", { title: "T" });
  const subs = await vs.listSubs("g:aaa-bbb"), inbox = await vs.getInbox("h1");
  await vs.deleteSubs("g:aaa-bbb"); await vs.setDue("ccc-ddd", null);
  check(subs.length === 1 && subs[0].endpoint && inbox?.title === "T" && !(await vs.getInbox("h1")) && !(await vs.listSubs("g:aaa-bbb")).length, "Redis: odběry a schránka upozornění");
  const n1 = await vs.bumpStats("aaa-bbb", "open", "2026-01-01T00:00:00.000Z"), n2 = await vs.bumpStats("aaa-bbb", "open", "2026-01-02T00:00:00.000Z");
  const st = await vs.getStats("aaa-bbb");
  check(n1 === 1 && n2 === 2 && st.opens === 2 && st.firstOpenAt === "2026-01-01T00:00:00.000Z" && st.lastOpenAt === "2026-01-02T00:00:00.000Z", "Redis: statistiky (první/poslední)");
  await vs.deleteGift("aaa-bbb");
  const left4 = [...hashes.keys(), ...sets.keys(), ...zsets.keys()].filter(k => !/^present:(workshops|keys|emails)$/.test(k));
  check(!(await vs.getStats("aaa-bbb")).opens && !left4.some(k => /due|subs|inbox|stats/.test(k)), "Redis: po úklidu nic nezůstalo");
  redisSrv.close();

  // 4) e-mails: real nodemailer → local SMTP sink
  const { createMailer, mailConfigFromEnv } = await import("../server/mail.js");
  const sink = await smtpSink();
  const mcfg = mailConfigFromEnv({ SMTP_HOST: "127.0.0.1", SMTP_PORT: String(sink.port), SMTP_SECURE: "none", SMTP_USER: "dilna", SMTP_PASS: "heslo", MAIL_FROM: "Ježíškova dílna <dilna@example.cz>", APP_URL: MAIL_APP_URL + "/" });
  check(mailConfigFromEnv({ SMTP_HOST: "x", MAIL_FROM: "a@b.cz" }) === null, "bez APP_URL zůstanou e-maily vypnuté");
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "xd-mail-"));
  const s3 = serve(createApp({ storage: fsStorage(tmp2), secret: process.env.APP_SECRET, mailer: createMailer(mcfg), mailGapMs: 1000 }));
  await suite("Node + e-maily (nodemailer → SMTP sink)", await listen(s3), b => runMail(b, sink));
  check(sink.messages.length >= 5, `SMTP sink přijal ${sink.messages.length} e-mailů`);
  const left = ["workshops", "keys", "emails"].map(d => fs.readdirSync(path.join(tmp2, d)).length).reduce((a, b) => a + b, 0);
  check(left === 0, left ? `po smazání zůstalo ${left} souborů` : "po smazání dílen nezůstal žádný index e-mailů");
  s3.close(); sink.close(); fs.rmSync(tmp2, { recursive: true, force: true });

  // 5) notifications: cron e-mail at unlock, ring, Web Push (VAPID) to recipient + creator
  const { createPusher, generateVapidKeys } = await import("../server/push.js");
  const vapid = generateVapidKeys();
  const nmail = await smtpSink(), npush = await pushSink();
  const tmp3 = fs.mkdtempSync(path.join(os.tmpdir(), "xd-notify-"));
  const ncfg = mailConfigFromEnv({ SMTP_HOST: "127.0.0.1", SMTP_PORT: String(nmail.port), SMTP_SECURE: "none", MAIL_FROM: "Dílna <dilna@example.cz>", APP_URL: MAIL_APP_URL });
  const s4 = serve(createApp({
    storage: fsStorage(tmp3), secret: process.env.APP_SECRET, mailer: createMailer(ncfg), cronSecret: "cron-test",
    pusher: createPusher({ publicKey: vapid.publicKey, privateKey: vapid.privateKey, subject: "mailto:dilna@example.cz", testSink: npush.url })
  }));
  await suite("Node + upozornění (cron, zvonek, Web Push)", await listen(s4), b => runNotify(b, { mail: nmail, push: npush, publicKey: vapid.publicKey }));
  const left3 = ["workshops", "keys", "emails", "gifts", "stats", "due", "subs", "inbox"].map(d => { try { return fs.readdirSync(path.join(tmp3, d)).length; } catch { return 0; } }).reduce((a, b) => a + b, 0);
  check(left3 === 0, left3 ? `po smazání zůstalo ${left3} souborů (plány, odběry…)` : "po smazání dílny nezůstaly plány, odběry ani schránky");
  s4.close(); nmail.close(); npush.close(); fs.rmSync(tmp3, { recursive: true, force: true });
}

process.exit(failedTotal ? 1 : 0);
