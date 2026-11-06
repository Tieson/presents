// Notifications: e-mail at unlock time (cron), ring, Web Push to the recipient and the creator.
// The backend needs: SMTP → mail sink, APP_URL = MAIL_APP_URL, VAPID keys, PUSH_TEST_SINK → push sink, CRON_SECRET = "cron-test".
import http from "node:http";
import crypto from "node:crypto";
import { mailText, MAIL_APP_URL } from "./mail.mjs";

/** Fake push service: records every knock (the backend sends it here instead of the real endpoint) */
export function pushSink(port = 0) {
  const knocks = [];
  const srv = http.createServer((req, res) => {
    const endpoint = req.headers["x-push-endpoint"] || "";
    knocks.push({ endpoint, auth: req.headers.authorization || "", ttl: req.headers.ttl });
    res.statusCode = /gone/.test(endpoint) ? 410 : 201;
    res.end();
  });
  return new Promise(r => srv.listen(port, "127.0.0.1", () => r({ port: srv.address().port, url: `http://127.0.0.1:${srv.address().port}/`, knocks, close: () => srv.close() })));
}

/** Checks the VAPID header: ES256 JWT for the endpoint's origin, signed by the public key */
export function vapidOk(auth, endpoint, publicKey) {
  const m = auth.match(/^vapid t=([^,]+), k=(.+)$/);
  if (!m || m[2] !== publicKey) return false;
  const [h, b, sig] = m[1].split(".");
  const body = JSON.parse(Buffer.from(b, "base64url"));
  const raw = Buffer.from(publicKey, "base64url");
  const key = crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: raw.subarray(1, 33).toString("base64url"), y: raw.subarray(33).toString("base64url") }, format: "jwk" });
  return body.aud === new URL(endpoint).origin && body.exp > Date.now() / 1000 && /^(mailto:|https:)/.test(body.sub)
    && crypto.verify("sha256", Buffer.from(`${h}.${b}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url"));
}

export async function runNotify(base, { mail, push, publicKey }) {
  let passed = 0, failed = 0;
  const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); c ? passed++ : failed++; };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  function client() {
    let cookie = "";
    return async (method, path, body) => {
      const h = { "X-Admin": "1", ...(cookie ? { cookie } : {}) };
      if (body !== undefined) h["content-type"] = "application/json";
      const r = await fetch(base + "/api/" + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
      const sc = r.headers.get("set-cookie");
      if (sc) { const v = sc.split(";")[0]; cookie = /=$/.test(v) ? "" : v; }
      return { s: r.status, d: await r.json().catch(() => null) };
    };
  }
  const subj = m => { const s = (m?.raw || "").match(/^Subject: (.*(?:\r?\n[ \t].*)*)/m)?.[1] || ""; return s.replace(/\r?\n[ \t]/g, " ").replace(/=\?UTF-8\?([BQ])\?([^?]*)\?=\s*/gi, (_, e, t) => e.toUpperCase() === "B" ? Buffer.from(t, "base64").toString("utf8") : Buffer.from(t.replace(/_/g, " ").replace(/=([0-9A-F]{2})/gi, (__, x) => String.fromCharCode(parseInt(x, 16))), "latin1").toString("utf8")); };
  const mailsTo = addr => mail.messages.filter(m => m.to.some(t => t.toLowerCase() === addr));
  const knocksTo = ep => push.knocks.filter(k => k.endpoint === ep);
  const unwrapMails = () => mailsTo("tvurce@example.com").filter(m => /je rozbalený/.test(subj(m)));
  const until = async (fn, ms = 2500) => { for (let t = 0; t < ms && !fn(); t += 50) await wait(50); return fn(); };

  const A = client(), anon = client();
  const R_EP = "https://fcm.googleapis.com/fcm/send/recipient-" + Date.now();
  const C_EP = "https://updates.push.services.mozilla.com/wpush/v2/creator-" + Date.now();

  let r = await anon("GET", "info"); ok(r.d.push === publicKey, "info: push on, public VAPID key");
  r = await A("POST", "workshop", { name: "Upozornění", email: "tvurce@example.com" });
  r = await A("POST", "admin/gifts", { theme: "christmas" }); const code = r.d.code;
  const soon = new Date(Date.now() + 1500).toISOString();
  r = await A("PUT", `admin/gifts/${code}`, { title: "Pro Káťu", showTitle: true, password: "vanoce", openAt: soon, items: [], recipientEmail: "Obdarovana@Example.com" });
  ok(r.s === 200 && r.d.recipientEmail === "Obdarovana@Example.com" && r.d.locked && !r.d.notifiedAt, "recipient's e-mail saved, box locked");
  r = await A("PUT", `admin/gifts/${code}`, { title: "Pro Káťu", openAt: soon, items: [], recipientEmail: "nope" }); ok(r.s === 400, "bad recipient e-mail → 400");

  r = await anon("POST", `gifts/${code}/subscribe`, { endpoint: "http://127.0.0.1:9/x" }); ok(r.s === 400, "subscription to a non-push URL refused (no SSRF)");
  r = await anon("POST", `gifts/${code}/subscribe`, { endpoint: "https://evil.example/push" }); ok(r.s === 400, "unknown push host refused");
  r = await anon("POST", `gifts/${code}/subscribe`, { endpoint: R_EP }); ok(r.s === 200, "recipient subscribes in the browser");
  r = await anon("POST", `gifts/${code}/subscribe`, { endpoint: R_EP + "-gone" }); ok(r.s === 200, "second (expired) browser subscribes");
  r = await A("POST", "workshop/subscribe", { endpoint: C_EP }); ok(r.s === 200, "creator subscribes in the workshop");

  r = await anon("GET", "cron"); ok(r.s === 401, "cron without the key → 401");
  r = await anon("GET", "cron?key=cron-test"); ok(r.s === 200 && r.d.sent === 0, "cron before the time: nothing to send");
  await wait(1700);
  r = await anon("GET", "cron?key=cron-test"); ok(r.s === 200 && r.d.sent === 1, "cron after the time sends once");
  await until(() => mailsTo("obdarovana@example.com").length && knocksTo(R_EP).length);
  const unl = mailsTo("obdarovana@example.com")[0];
  ok(/Ježíšek ti nadělil dárek/.test(subj(unl)) && /Pro Káťu/.test(subj(unl)) && mailText(unl.raw).includes(`${MAIL_APP_URL}/${code}`) && /heslem/.test(mailText(unl.raw)), "recipient gets the Christmas e-mail with the box link (password hint)");
  const k1 = knocksTo(R_EP)[0];
  ok(k1 && vapidOk(k1.auth, R_EP, publicKey), "recipient's browser gets a push with a valid VAPID signature");
  r = await anon("GET", `push/inbox?e=${encodeURIComponent(R_EP)}`); ok(/Ježíšek ti nadělil dárek/.test(r.d.title) && r.d.url === code, "service worker reads the text from the inbox");
  ok(knocksTo(R_EP + "-gone").length === 1, "expired subscription knocked once");
  r = await A("GET", `admin/gifts/${code}`); ok(!!r.d.notifiedAt && r.d.locked === false, "box marked as notified");
  r = await anon("GET", "cron?key=cron-test"); ok(r.d.sent === 0 && mailsTo("obdarovana@example.com").length === 1, "no second e-mail");

  /* ring */
  const before = knocksTo(R_EP).length;
  r = await A("POST", `admin/gifts/${code}/ring`); ok(r.s === 200 && r.d.mailed === true && r.d.pushed === 1, "ring: e-mail + push (expired browser dropped)");
  await until(() => mailsTo("obdarovana@example.com").length === 2);
  ok(/Cinkylink/.test(subj(mailsTo("obdarovana@example.com")[1])), "ring e-mail");
  ok(knocksTo(R_EP).length === before + 1 && knocksTo(R_EP + "-gone").length === 1, "expired subscription not knocked again");
  r = await A("POST", `admin/gifts/${code}/ring`); ok(r.s === 429, "ringing again right away → 429");
  r = await anon("GET", `gifts/${code}?poll=1`); ok(!!r.d.ringAt, "waiting page sees the ring");

  /* the creator hears about the first view and unwrap */
  r = await A("GET", `admin/gifts/${code}`); const v0 = r.d.stats.views;
  ok(v0 === 0, "polling didn't count as a visit");
  await anon("GET", `gifts/${code}`);
  await until(() => knocksTo(C_EP).length === 1);
  r = await A("GET", `push/inbox?e=${encodeURIComponent(C_EP)}`); ok(knocksTo(C_EP).length === 1 && /otevřel/.test(r.d.title), "creator: push on the first view");
  await anon("GET", `gifts/${code}`); await wait(200); ok(knocksTo(C_EP).length === 1, "…but not on the second");
  r = await anon("POST", `gifts/${code}/open`, { password: "vanoce" }); ok(r.s === 200, "recipient unwraps");
  await until(() => knocksTo(C_EP).length === 2 && unwrapMails().length === 1);
  r = await A("GET", `push/inbox?e=${encodeURIComponent(C_EP)}`);
  ok(/rozbalený/.test(r.d.title) && unwrapMails().length === 1, "creator: push + e-mail on the first unwrap");
  ok(!mailText(unwrapMails()[0]?.raw || "klic=").includes("klic="), "creator's e-mail has no secret link");
  await anon("POST", `gifts/${code}/open`, { password: "vanoce" }); await wait(300);
  ok(unwrapMails().length === 1, "no e-mail for the second unwrap");

  /* unlock by hand → recipient hears right away */
  r = await A("POST", "admin/gifts", { theme: "birthday" }); const code2 = r.d.code;
  r = await A("PUT", `admin/gifts/${code2}`, { title: "Oslava", showTitle: true, openAt: "2031-01-01T10:00:00.000Z", items: [], recipientEmail: "oslavenec@example.com" });
  r = await A("PUT", `admin/gifts/${code2}`, { title: "Oslava", showTitle: true, openAt: "2031-01-01T10:00:00.000Z", manualUnlock: true, items: [] });
  await until(() => mailsTo("oslavenec@example.com").length === 1);
  ok(r.d.notifiedAt && /narozeninový dárek/i.test(subj(mailsTo("oslavenec@example.com")[0])), "manual unlock: birthday e-mail at once");
  r = await A("PUT", "workshop", { notifyOpen: false }); ok(r.d.workshop.notifyOpen === false, "creator can turn off unwrap e-mails");
  await anon("POST", `gifts/${code2}/open`, {}); await wait(300);
  ok(unwrapMails().length === 1, "…and then gets none");

  r = await A("DELETE", "workshop/subscribe", { endpoint: C_EP }); ok(r.s === 200, "creator unsubscribes");
  r = await A("DELETE", "workshop"); ok(r.s === 200, "delete workshop (boxes, schedules, subscriptions)");
  return { passed, failed };
}
