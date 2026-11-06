/**
 * Web Push without a payload: the server only "knocks" (an empty push with a VAPID signature),
 * the service worker then asks GET api/push/inbox for the text. No payload encryption needed,
 * which keeps the Node and PHP versions small and identical.
 *
 *   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY  base64url (generate: npm run vapid)
 *   VAPID_SUBJECT                         mailto:you@example.cz or https://your-site
 */
import crypto from "node:crypto";

/** Only real push services, so a stored "subscription" can never make the server call anything else */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^push\.services\.mozilla\.com$/,
  /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/, /^android\.googleapis\.com$/, /^web\.push\.apple\.com$/];

export function cleanEndpoint(v) {
  if (typeof v !== "string" || v.length > 800) return null;
  let u;
  try { u = new URL(v); } catch { return null; }
  if (u.protocol !== "https:" || u.port || u.username || u.password) return null;
  return PUSH_HOSTS.some(re => re.test(u.hostname)) ? u.href : null;
}

const b64u = buf => Buffer.from(buf).toString("base64url");

export function pushConfigFromEnv(env = process.env) {
  const pub = (env.VAPID_PUBLIC_KEY || "").trim(), priv = (env.VAPID_PRIVATE_KEY || "").trim();
  if (!pub || !priv) return null;
  const raw = Buffer.from(pub, "base64url");
  if (raw.length !== 65 || raw[0] !== 4) throw new Error("VAPID_PUBLIC_KEY musí být nekomprimovaný P-256 klíč (65 bajtů, base64url).");
  return {
    publicKey: pub, privateKey: priv, subject: (env.VAPID_SUBJECT || "mailto:dilna@example.cz").trim(),
    testSink: (env.PUSH_TEST_SINK || "").trim()       // tests only: knock here instead of the real push service
  };
}

/** transport: optional (endpoint, headers) => status – tests only */
export function createPusher(cfg, transport = null) {
  if (!cfg) return { enabled: false, publicKey: null, async knock() { return "off"; } };
  if (!transport && cfg.testSink) {
    transport = async (url, headers) => (await fetch(cfg.testSink, { method: "POST", headers: { ...headers, "X-Push-Endpoint": url } })).status;
  }
  const raw = Buffer.from(cfg.publicKey, "base64url");
  const key = crypto.createPrivateKey({
    key: { kty: "EC", crv: "P-256", d: cfg.privateKey, x: b64u(raw.subarray(1, 33)), y: b64u(raw.subarray(33, 65)) },
    format: "jwk"
  });
  const jwtCache = new Map();
  function vapidJwt(aud) {
    const hit = jwtCache.get(aud);
    const now = Math.floor(Date.now() / 1000);
    if (hit && hit.exp - now > 3600) return hit.jwt;
    const exp = now + 12 * 3600;
    const head = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
    const body = b64u(JSON.stringify({ aud, exp, sub: cfg.subject }));
    const sig = crypto.sign("sha256", Buffer.from(`${head}.${body}`), { key, dsaEncoding: "ieee-p1363" });
    const jwt = `${head}.${body}.${b64u(sig)}`;
    jwtCache.set(aud, { jwt, exp });
    return jwt;
  }
  return {
    enabled: true,
    publicKey: cfg.publicKey,
    vapidJwt,
    /** "ok" | "gone" (subscription expired, drop it) | "error" */
    async knock(endpoint) {
      const url = cleanEndpoint(endpoint);
      if (!url) return "gone";
      const headers = {
        TTL: "86400", Urgency: "high", "Content-Length": "0",
        Authorization: `vapid t=${vapidJwt(new URL(url).origin)}, k=${cfg.publicKey}`
      };
      try {
        const status = transport ? await transport(url, headers)
          : (await fetch(url, { method: "POST", headers, signal: AbortSignal.timeout(8000) })).status;
        if (status === 404 || status === 410) return "gone";
        return status >= 200 && status < 300 ? "ok" : "error";
      } catch { return "error"; }
    }
  };
}

/** For `npm run vapid` */
export function generateVapidKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const pub = publicKey.export({ format: "jwk" }), priv = privateKey.export({ format: "jwk" });
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, "base64url"), Buffer.from(pub.y, "base64url")]);
  return { publicKey: b64u(raw), privateKey: priv.d };
}
