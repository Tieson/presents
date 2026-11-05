// E-mail tests shared by the Node and PHP backends. Needs a backend configured with
// SMTP → the sink below, APP_URL = MAIL_APP_URL and a 1 s gap between e-mails per workshop.
import net from "node:net";

export const MAIL_APP_URL = "https://darky.example.cz";

/** Tiny SMTP server that accepts everything and keeps the messages */
export function smtpSink(port = 0) {
  const messages = [];
  const srv = net.createServer(sock => {
    let buf = "", data = false, msg = null, auth = 0;
    const say = l => sock.write(l + "\r\n");
    say("220 sink ESMTP");
    sock.on("data", chunk => {
      buf += chunk.toString("latin1");
      for (;;) {
        if (data) {
          const end = buf.indexOf("\r\n.\r\n");
          if (end < 0) return;
          msg.raw = Buffer.from(buf.slice(0, end), "latin1").toString("utf8");
          messages.push(msg); buf = buf.slice(end + 5); data = false; say("250 OK queued");
          continue;
        }
        const i = buf.indexOf("\r\n");
        if (i < 0) return;
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === "EHLO") { sock.write("250-sink\r\n250-AUTH LOGIN PLAIN\r\n250 8BITMIME\r\n"); }
        else if (cmd === "HELO") say("250 sink");
        else if (auth) { auth--; say(auth ? "334 UGFzc3dvcmQ6" : "235 ok"); }
        else if (cmd === "AUTH") { if (/PLAIN \S+/i.test(line)) say("235 ok"); else { auth = /PLAIN/i.test(line) ? 1 : 2; say("334 VXNlcm5hbWU6"); } }
        else if (cmd === "MAIL") { msg = { from: line, to: [] }; say("250 OK"); }
        else if (cmd === "RCPT") { msg.to.push(line.replace(/^RCPT TO:\s*<?|>?$/gi, "")); say("250 OK"); }
        else if (cmd === "DATA") { data = true; say("354 go"); }
        else if (cmd === "QUIT") { say("221 bye"); sock.end(); return; }
        else if (cmd === "RSET" || cmd === "NOOP") say("250 OK");
        else say("250 OK");
      }
    });
    sock.on("error", () => {});
  });
  return new Promise(r => srv.listen(port, "127.0.0.1", () => r({ port: srv.address().port, messages, close: () => srv.close() })));
}

/** All text of a message, with quoted-printable and base64 parts decoded */
export function mailText(raw) {
  const qp = raw.replace(/=\r?\n/g, "").replace(/(=[0-9A-F]{2})+/g, m => Buffer.from(m.replace(/=/g, ""), "hex").toString("utf8"));
  const b64 = (raw.match(/^[A-Za-z0-9+/=]{40,}$(?:\r?\n^[A-Za-z0-9+/=]+$)*/gm) || [])
    .map(b => Buffer.from(b.replace(/\s+/g, ""), "base64").toString("utf8")).join("\n");
  return qp + "\n" + b64;
}
const subjectOf = raw => {
  const m = raw.match(/^Subject: (.*(?:\r?\n[ \t].*)*)/m);
  if (!m) return "";
  return m[1].replace(/\r?\n[ \t]/g, " ").replace(/=\?UTF-8\?([BQ])\?([^?]*)\?=\s*/gi, (_, enc, t) =>
    enc.toUpperCase() === "B" ? Buffer.from(t, "base64").toString("utf8")
      : Buffer.from(t.replace(/_/g, " ").replace(/=([0-9A-F]{2})/gi, (__, h) => String.fromCharCode(parseInt(h, 16))), "latin1").toString("utf8"));
};

export async function runMail(base, sink) {
  let passed = 0, failed = 0;
  const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); c ? passed++ : failed++; };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  function client() {
    let cookie = "";
    return async (method, path, body) => {
      const h = { "X-Admin": "1", ...(cookie ? { cookie } : {}) };
      if (body !== undefined) h["content-type"] = "application/json";
      const r = await fetch(base + "/api/" + path, { method, headers: { ...h, "x-forwarded-host": "evil.example" }, body: body === undefined ? undefined : JSON.stringify(body) });
      const sc = r.headers.get("set-cookie");
      if (sc) { const v = sc.split(";")[0]; cookie = /=$/.test(v) ? "" : v; }
      return { s: r.status, d: await r.json().catch(() => null) };
    };
  }
  const newMail = async n => { for (let i = 0; i < 40 && sink.messages.length < n; i++) await wait(50); return sink.messages[n - 1]; };
  const keyIn = m => (mailText(m?.raw || "").match(/\/dilna#klic=([A-Za-z0-9_-]{32})/) || [])[1];
  const linkOk = m => mailText(m?.raw || "").includes(`${MAIL_APP_URL}/dilna#klic=`) && !/evil\.example/.test(m?.raw || "");
  let n = sink.messages.length;
  const A = client(), anon = client();

  let r = await anon("GET", "info"); ok(r.s === 200 && r.d.mail === true, "info: e-maily zapnuté");

  r = await A("POST", "workshop", { name: "Dílna s e-mailem", email: "Mail.Test@Example.com" });
  const key1 = r.d?.workshop?.key;
  let m = await newMail(++n);
  ok(r.s === 201 && r.d.mailed === true && m?.to.some(t => t.toLowerCase() === "mail.test@example.com"), "po založení odešle uvítací e-mail");
  ok(keyIn(m) === key1 && linkOk(m), "e-mail obsahuje tajný odkaz s adresou z APP_URL (ne z hlavičky Host)");
  ok(/Ježíškova dílna/.test(subjectOf(m.raw)) && /Dílna s e-mailem/.test(subjectOf(m.raw)), "předmět s názvem dílny (UTF-8)");

  r = await A("POST", "workshop/send-link"); ok(r.s === 429, "další e-mail hned po prvním → 429");
  await wait(1100);
  r = await A("POST", "workshop/send-link"); m = await newMail(++n);
  ok(r.s === 200 && keyIn(m) === key1, "„poslat odkaz“ z dílny");

  await wait(1100);
  r = await anon("POST", "workshop/recover", { email: "nikdo@example.com" });
  await wait(300);
  ok(r.s === 200 && r.d.ok && sink.messages.length === n, "obnova pro neznámou adresu: stejná odpověď, nic neodejde");
  r = await anon("POST", "workshop/recover", { email: "nepatri" }); ok(r.s === 400, "obnova: neplatná adresa → 400");
  r = await anon("POST", "workshop/recover", { email: "  mail.test@EXAMPLE.com " }); m = await newMail(++n);
  ok(r.s === 200 && keyIn(m) === key1, "obnova ztraceného odkazu (velikost písmen nevadí)");

  await wait(1100);
  r = await A("PUT", "workshop", { email: "nova@example.com" }); ok(r.s === 200, "změna e-mailu");
  r = await anon("POST", "workshop/recover", { email: "mail.test@example.com" }); await wait(300);
  ok(sink.messages.length === n, "stará adresa už odkaz nedostane");
  r = await anon("POST", "workshop/recover", { email: "nova@example.com" }); m = await newMail(++n);
  ok(m?.to.includes("nova@example.com") && keyIn(m) === key1, "nová adresa ano");

  r = await A("POST", "workshop/rotate-key"); const key2 = r.d?.workshop?.key; m = await newMail(++n);
  ok(r.s === 200 && r.d.mailed === true && key2 !== key1 && keyIn(m) === key2, "výměna odkazu pošle nový odkaz");

  const B = client();
  r = await B("POST", "workshop", { name: "Bez e-mailu" }); await wait(300);
  ok(r.s === 201 && r.d.mailed === false && sink.messages.length === n, "dílna bez e-mailu nic neposílá");
  r = await B("POST", "workshop/send-link"); ok(r.s === 400, "„poslat odkaz“ bez e-mailu → 400");

  await wait(1100);
  r = await A("DELETE", "workshop"); ok(r.s === 200, "smazání dílny");
  r = await anon("POST", "workshop/recover", { email: "nova@example.com" }); await wait(300);
  ok(sink.messages.length === n, "po smazání dílny obnova nic nepošle");
  await B("DELETE", "workshop");
  return { passed, failed };
}
