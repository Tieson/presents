import {
  hashPassword, verifyPassword, normalizePassword, signToken, checkToken,
  safeEqual, randomId, generateCode, normalizeCode, hmac,
  generateKey, isKeyShaped, sha256hex, encrypt, decrypt
} from "./security.js";
import { linkMessage, giftMessage, PUSH_TEXT } from "./mail.js";
import { cleanEndpoint } from "./push.js";

const WS_COOKIE = "xd_ws";
const WS_TTL = 60 * 60 * 24 * 365;     // stays signed in on this device for a year
const GIFT_TTL = 60 * 60 * 24 * 60;    // 60 days
const MAX_ITEMS = 50;

/* ---------- helpers ---------- */

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }
  });
}
const fail = (status, error, message, extra = {}) => json({ error, message, ...extra }, status);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

async function readJson(req) {
  try { return await req.json(); } catch { return {}; }
}

function str(v, max) {
  return String(v ?? "").replace(/\r\n/g, "\n").slice(0, max);
}

/** Christmas Eve 18:00 Prague time (CET = UTC+1) of the upcoming Christmas */
export function defaultOpenAt(now = new Date()) {
  let y = now.getUTCFullYear();
  if (now > new Date(Date.UTC(y, 11, 26, 23, 0))) y++;
  return new Date(Date.UTC(y, 11, 24, 17, 0)).toISOString();
}

/* ---------- appearance & reveal (whitelists shared with web/assets/wrap.js) ---------- */
export const PAPERS = ["burgundy", "scarlet", "emerald", "fir", "midnight", "plum", "charcoal", "ivory", "frost", "champagne", "gold", "blush", "silver", "kraft"];
export const PATTERNS = ["plain", "stripes", "dots", "tartan", "stars", "snow", "trees", "baubles", "holly", "candy", "gingerbread", "deer", "hearts", "chevron", "waves", "confetti", "balloons", "cupcakes", "streamers", "rings", "flowers", "lace"];
export const INKS = ["white", "cream", "gold", "silver", "bronze", "red", "green", "navy", "brown", "black", "paper", "pink", "sky", "mint", "lilac"];
export const RIBBONS = ["gold", "silver", "copper", "red", "burgundy", "pink", "green", "navy", "white", "black"];
export const RIBBON_STYLES = ["cross", "single", "none"];
export const BOWS = ["classic", "double", "rosette", "small", "none"];
export const DECOS = ["none", "holly", "pine", "candy", "bauble", "star", "bells", "orange", "tag", "balloons", "candle", "partyhat", "rings", "rose", "heart"];
export const PHOTO_FRAMES = ["polaroid", "postcard"];
export const REVEALS = ["all", "sequential", "choice"];
export const THEMES = ["christmas", "birthday", "wedding", "general"];   // occasion of a box (and the workshop's current one)
/** unknown / not chosen → "general" (neutral); boxes saved before occasions existed were Christmas boxes */
const theme = (v, fallback = "general") => (THEMES.includes(v) ? v : fallback);
export const DEFAULT_APPEARANCE = {
  paper: "burgundy", pattern: "stripes", patternColor: null, patternOpacity: null,
  ribbon: "gold", ribbonStyle: "cross", bow: "classic", deco: "none", seal: "V"
};

export function sanitizeAppearance(a) {
  const src = a && typeof a === "object" ? a : {};
  const pick = (list, v, d) => (list.includes(v) ? v : d);
  const seal = typeof src.seal === "string" ? [...src.seal.trim()].slice(0, 2).join("") : DEFAULT_APPEARANCE.seal;
  const op = Number(src.patternOpacity);
  return {
    paper: pick(PAPERS, src.paper, DEFAULT_APPEARANCE.paper),
    pattern: pick(PATTERNS, src.pattern, DEFAULT_APPEARANCE.pattern),
    patternColor: pick(INKS, src.patternColor, null),                      // null = the paper's default
    patternOpacity: src.patternOpacity == null || src.patternOpacity === "" || !Number.isFinite(op)
      ? null : Math.min(90, Math.max(5, Math.round(op))),                  // %, null = the paper's default
    ribbon: pick(RIBBONS, src.ribbon, DEFAULT_APPEARANCE.ribbon),
    ribbonStyle: pick(RIBBON_STYLES, src.ribbonStyle, DEFAULT_APPEARANCE.ribbonStyle),
    bow: pick(BOWS, src.bow, DEFAULT_APPEARANCE.bow),
    deco: pick(DECOS, src.deco, DEFAULT_APPEARANCE.deco),
    seal
  };
}

/* ---------- uploads: PDF vouchers and one photo per box ---------- */
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
/** Content type from the first bytes (never trust the browser's word) */
export function sniffType(buf) {
  const head = buf.subarray(0, 12);
  if (head.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}
const fileType = meta => meta?.type || "application/pdf";               // files from before photos were PDFs
const isPdf = meta => fileType(meta) === "application/pdf";
const isImage = meta => IMAGE_TYPES.includes(fileType(meta));

/** Boxes saved before these options existed get the defaults */
function withDefaults(g) {
  if (!g) return g;
  return { ...g, appearance: sanitizeAppearance(g.appearance), reveal: REVEALS.includes(g.reveal) ? g.reveal : "all", photo: g.photo || null, theme: theme(g.theme, "christmas") };
}
const filesOf = g => [...g.items.filter(i => i.file).map(i => i.file), ...(g.photo?.file ? [g.photo.file] : [])];

export function isLocked(g, now = Date.now()) {
  if (g.manualUnlock || g.anytime) return false;
  const t = Date.parse(g.openAt);
  return Number.isFinite(t) ? now < t : false;
}

function adminView(g) {
  const { passwordHash, ...rest } = g;
  return { ...rest, hasPassword: !!passwordHash, locked: isLocked(g) };
}

function summary(g) {
  return {
    code: g.code, title: g.title, showTitle: g.showTitle, hasPassword: !!g.passwordHash,
    anytime: g.anytime, openAt: g.openAt, manualUnlock: g.manualUnlock, locked: isLocked(g),
    appearance: g.appearance, reveal: g.reveal, theme: g.theme,
    itemCount: g.items.length, fileCount: g.items.filter(i => i.file).length, hasPhoto: !!g.photo,
    createdAt: g.createdAt, updatedAt: g.updatedAt
  };
}

function publicGift(g) {
  return {
    code: g.code,
    theme: g.theme,
    title: g.showTitle ? g.title : null,
    message: g.message,
    signature: g.signature,
    reveal: g.reveal,
    appearance: g.appearance,
    items: g.items.map(i => ({
      id: i.id, name: i.name, description: i.description,
      file: i.file ? { name: i.file.name, size: i.file.size } : null
    })),
    // the image itself comes from gifts/<code>/photo?t=<token>
    photo: g.photo ? { caption: g.photo.caption, frame: g.photo.frame, w: g.photo.file.w || null, h: g.photo.file.h || null } : null
  };
}

const giftScope = g => `gift|${g.code}|${g.passwordHash ? g.passwordHash.slice(-16) : "none"}`;

function contentDisposition(name, download) {
  const safe = String(name || "poukaz.pdf").replace(/[\r\n"]/g, "");
  const ascii = safe.normalize("NFD").replace(/[^\x20-\x7e]/g, "");
  return `${download ? "attachment" : "inline"}; filename="${ascii || "poukaz.pdf"}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

function imageResponse(file, meta) {
  return new Response(file, {
    headers: {
      "content-type": fileType(meta),
      "content-disposition": "inline",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox"
    }
  });
}

function pdfResponse(file, meta, download) {
  return new Response(file, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": contentDisposition(meta.name, download),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

/* ---------- app ---------- */

/**
 * Accounts are "workshops" (dílny) without passwords. Creating one returns a random secret
 * key; the link /dilna#klic=<key> is the only way in, and anyone holding it has access
 * (so it can be shared). The server keeps sha256(key) to look the workshop up and an
 * AES-GCM copy so the owner can see the link again. Rotating the key kills the old link
 * and signs out every other device.
 */
export function createApp({
  storage, secret, maxUploadBytes = 4 * 1024 * 1024,
  maxGifts = 50, maxStorageBytes = 100 * 1024 * 1024, signupCode = "",
  mailer = { enabled: false }, mailGapMs = 60 * 1000, log = console,
  pusher = { enabled: false, publicKey: null, async knock() { return "off"; } }, cronSecret = "", ringGapMs = 60 * 1000
}) {
  if (!secret) throw new Error("APP_SECRET is not set");
  const SECRET = secret;
  const raw = storage;
  storage = {
    ...raw,
    getGift: async code => withDefaults(await raw.getGift(code)),
    listGiftsByOwner: async owner => (await raw.listGiftsByOwner(owner)).map(withDefaults)
  };

  /* ----- sessions ----- */
  const wsScope = (w, exp) => `ws|${w.id}|${w.keyHash.slice(0, 16)}|${exp}`;
  function sessionToken(w) {
    const exp = Math.floor(Date.now() / 1000) + WS_TTL;
    return `${w.id}.${exp}.${hmac(SECRET, wsScope(w, exp))}`;
  }
  async function currentWorkshop(req) {
    const c = parseCookies(req.headers.get("cookie"))[WS_COOKIE];
    if (!c) return null;
    const [id, expStr, sig] = c.split(".");
    const exp = Number(expStr);
    if (!id || !exp || exp < Date.now() / 1000) return null;
    const w = await storage.getWorkshop(id);
    if (!w || !safeEqual(sig || "", hmac(SECRET, wsScope(w, exp)))) return null;
    return w;
  }
  function cookie(req, value, maxAge) {
    const secure = new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
    return `${WS_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
  }
  const signIn = (req, w) => ({ "set-cookie": cookie(req, sessionToken(w), WS_TTL) });
  const signOut = req => ({ "set-cookie": cookie(req, "", 0) });

  const MB = n => Math.round(n / 1048576);
  async function workshopView(w, key) {
    return {
      id: w.id,
      name: w.name,
      email: w.email,
      theme: theme(w.theme),
      notifyOpen: w.notifyOpen !== false,
      key: key || decrypt(SECRET, w.keyEnc),
      createdAt: w.createdAt,
      giftCount: await storage.countGiftsByOwner(w.id),
      usedBytes: w.usedBytes || 0,
      limits: { gifts: maxGifts, storageBytes: maxStorageBytes, uploadBytes: maxUploadBytes }
    };
  }
  const cleanName = v => str(v, 80).replace(/\s+/g, " ").trim();
  function cleanEmail(v) {
    const e = str(v, 200).trim();
    return e === "" ? "" : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
  }
  /* ----- e-mail: index (address → workshops) and sending the link ----- */
  const emailHash = e => sha256hex(`email|${String(e).trim().toLowerCase()}`);
  async function indexEmail(id, oldEmail, newEmail) {
    if (oldEmail && (!newEmail || emailHash(oldEmail) !== emailHash(newEmail))) {
      const h = emailHash(oldEmail);
      await storage.setEmailOwners(h, (await storage.getEmailOwners(h)).filter(x => x !== id));
    }
    if (newEmail) {
      const h = emailHash(newEmail), ids = await storage.getEmailOwners(h);
      if (!ids.includes(id)) await storage.setEmailOwners(h, [...ids, id].slice(-20));
    }
  }
  const MAIL_GAP = mailGapMs;              // one e-mail per workshop per minute
  /** Sends the secret link; returns true when it went out. Never throws. */
  async function mailLink(w, kind, key) {
    if (!mailer.enabled || !w.email) return false;
    if (w.mailedAt && Date.now() - Date.parse(w.mailedAt) < MAIL_GAP) return false;
    const k = key || decrypt(SECRET, w.keyEnc);
    if (!k) return false;
    try {
      await mailer.send({ to: w.email, ...linkMessage(kind, { name: w.name, link: mailer.linkFor(k) }) });
    } catch (err) {
      log.error?.(`E-mail (${kind}) se nepodařilo odeslat: ${err.message}`);
      return false;
    }
    const fresh = await storage.getWorkshop(w.id);
    if (fresh) await storage.putWorkshop({ ...fresh, mailedAt: new Date().toISOString() });
    return true;
  }

  /* ----- who looked: page views and unwraps (the creator's own visits don't count) ----- */
  async function track(g, kind) {
    let n = 0;
    try { n = await storage.bumpStats(g.code, kind, new Date().toISOString()); } catch (err) { log.error?.(`Statistiky: ${err.message}`); return; }
    if (n !== 1) return;                          // tell the creator only about the first view / unwrap
    const title = g.title || "Dárek";
    await pushAll(`w:${g.owner}`, { ...PUSH_TEXT[kind === "open" ? "opened" : "viewed"](g.theme, title), url: "dilna", tag: `stat-${g.code}` });
    if (kind === "open" && mailer.enabled) {
      const w = await storage.getWorkshop(g.owner);
      if (w?.email && w.notifyOpen !== false) {
        try { await mailer.send({ to: w.email, ...giftMessage("opened", g.theme, { title, link: `${mailer.appUrl}/dilna` }) }); }
        catch (err) { log.error?.(`E-mail tvůrci se nepodařilo odeslat: ${err.message}`); }
      }
    }
  }

  /* ----- notifications: e-mail + Web Push ----- */
  /** Sends a system notification to every browser subscribed to `scope`; returns how many got it */
  async function pushAll(scope, msg) {
    if (!pusher.enabled) return 0;
    let ok = 0;
    for (const sub of await storage.listSubs(scope)) {
      await storage.putInbox(sub.hash, { ...msg, at: new Date().toISOString() });
      const r = await pusher.knock(sub.endpoint);
      if (r === "gone") await storage.removeSub(scope, sub.hash);
      else if (r === "ok") ok++;
    }
    return ok;
  }
  /** kind "unlocked" | "ring": e-mail (if the box has the recipient's address) + push to the recipient's browsers */
  async function notifyRecipient(g, kind) {
    const title = g.showTitle ? g.title : "";
    let mailed = false;
    if (g.recipientEmail && mailer.enabled) {
      try {
        await mailer.send({ to: g.recipientEmail, ...giftMessage(kind, g.theme, { title, link: `${mailer.appUrl}/${g.code}`, hasPassword: !!g.passwordHash }) });
        mailed = true;
      } catch (err) { log.error?.(`E-mail příjemci (${kind}) se nepodařilo odeslat: ${err.message}`); }
    }
    const pushed = await pushAll(`g:${g.code}`, { ...PUSH_TEXT[kind](g.theme, title), url: g.code, tag: `gift-${g.code}` });
    return { mailed, pushed };
  }
  /** Keeps the "notify at unlock" schedule in step with the box (call after every save) */
  async function syncDue(prev, next) {
    if (isLocked(next)) { await storage.setDue(next.code, Date.parse(next.openAt)); return next; }
    await storage.setDue(next.code, null);
    // unlocked just now by hand (or the time moved into the past): tell the recipient right away
    if (prev && isLocked(prev) && !next.anytime && !next.notifiedAt) {
      await notifyRecipient(next, "unlocked");
      const done = { ...next, notifiedAt: new Date().toISOString() };
      await storage.putGift(done);
      return done;
    }
    return next;
  }
  /** Boxes whose time has come: notify once. Run by the cron endpoint and, at most once a minute, by any request. */
  async function processDue(limit = 25) {
    let sent = 0;
    for (const code of (await storage.dueCodes(Date.now())).slice(0, limit)) {
      const g = await storage.getGift(code);
      if (g && isLocked(g)) continue;                      // moved later meanwhile
      if (!(await storage.claimDue(code))) continue;      // someone else is on it
      if (!g || g.notifiedAt) continue;
      await notifyRecipient(g, "unlocked");
      const fresh = await storage.getGift(code);
      if (fresh) await storage.putGift({ ...fresh, notifiedAt: new Date().toISOString() });
      sent++;
    }
    return sent;
  }
  let lastDue = 0;
  async function maybeProcessDue() {
    if (Date.now() - lastDue < 60 * 1000) return;
    lastDue = Date.now();
    try { await processDue(); } catch (err) { log.error?.(`Upozornění: ${err.message}`); }
  }
  async function dropGiftExtras(code) {
    await storage.setDue(code, null);
    await storage.deleteSubs(`g:${code}`);
  }

  async function newKeyFor(w) {
    const key = generateKey();
    w.keyHash = sha256hex(key);
    w.keyEnc = encrypt(SECRET, key);
    await storage.setKeyOwner(w.keyHash, w.id);
    return key;
  }
  async function adjustUsage(w, delta) {
    const fresh = await storage.getWorkshop(w.id);
    if (!fresh) return;
    fresh.usedBytes = Math.max(0, (fresh.usedBytes || 0) + delta);
    await storage.putWorkshop(fresh);
  }

  async function uniqueCode() {
    for (let i = 0; i < 20; i++) {
      const c = generateCode();
      if (!(await storage.getGift(c))) return c;
    }
    throw new Error("Could not generate a unique code");
  }

  async function sanitizeItems(rawItems, previous, owner) {
    const prevFiles = new Map(previous.filter(i => i.file).map(i => [i.file.id, i.file]));
    const items = [];
    for (const raw of (Array.isArray(rawItems) ? rawItems : []).slice(0, MAX_ITEMS)) {
      let file = null;
      const fid = raw?.file?.id;
      if (fid) {
        file = prevFiles.get(fid) || null;
        if (!file) {
          const meta = await storage.getFileMeta(fid);
          if (meta && meta.owner === owner && isPdf(meta)) file = { id: meta.id, name: meta.name, size: meta.size };
        }
      }
      items.push({
        id: typeof raw?.id === "string" && /^[\w-]{4,40}$/.test(raw.id) ? raw.id : randomId(6),
        name: str(raw?.name, 160),
        description: str(raw?.description, 4000),
        file
      });
    }
    return items;
  }

  /** The box photo: an image this workshop uploaded, a short caption and a frame */
  async function sanitizePhoto(raw, previous, owner) {
    if (!raw || typeof raw !== "object" || !raw.file?.id) return null;
    let file = previous?.file?.id === raw.file.id ? previous.file : null;
    if (!file) {
      const meta = await storage.getFileMeta(String(raw.file.id));
      if (!meta || meta.owner !== owner || !isImage(meta)) return null;
      file = { id: meta.id, name: meta.name, size: meta.size, type: meta.type, w: meta.w || null, h: meta.h || null };
    }
    return {
      file,
      caption: str(raw.caption, 200).replace(/\s+/g, " ").trim(),
      frame: PHOTO_FRAMES.includes(raw.frame) ? raw.frame : "polaroid"
    };
  }

  /** before/after: lists of { id, size } still referenced by a box */
  async function removeOrphanFiles(w, before, after) {
    const keep = new Set(after.map(f => f.id));
    let freed = 0;
    for (const f of before) {
      if (!keep.has(f.id)) {
        try { await storage.deleteFile(f.id); freed += f.size || 0; } catch { /* ignore */ }
      }
    }
    if (freed) await adjustUsage(w, -freed);
  }

  async function route(req, path) {
    const method = req.method.toUpperCase();
    const seg = path.split("/").filter(Boolean).map(decodeURIComponent);

    if (seg[0] !== "cron") await maybeProcessDue();

    // CSRF guard: every state-changing call must come from our own pages (custom header)
    if (method !== "GET" && seg[0] !== "gifts" && req.headers.get("x-admin") !== "1") {
      return fail(403, "forbidden", "Chybí hlavička X-Admin.");
    }

    /* ----- public: recipients ----- */
    if (seg[0] === "gifts") {
      const code = normalizeCode(seg[1]);
      if (!code) return fail(404, "not_found", "Dárek s tímto kódem neexistuje.");
      const g = await storage.getGift(code);
      if (!g) return fail(404, "not_found", "Dárek s tímto kódem neexistuje.");
      const isOwner = async () => { const w = await currentWorkshop(req); return !!w && g.owner === w.id; };

      if (seg.length === 2 && method === "GET") {
        // ?poll=1: the waiting page checking for a ring – not a new visit
        const owner = await isOwner();
        if (!new URL(req.url).searchParams.has("poll") && !owner) await track(g, "view");
        return json({
          code: g.code,
          title: g.showTitle ? g.title : null,
          hasPassword: !!g.passwordHash,
          appearance: g.appearance,
          theme: g.theme,
          locked: isLocked(g),
          openAt: g.anytime ? null : g.openAt,
          ringAt: g.ringAt || null,
          owner,                                   // only the signed-in creator may preview a locked box
          serverNow: new Date().toISOString()
        });
      }


      if (seg.length === 3 && seg[2] === "open" && method === "POST") {
        const body = await readJson(req);
        const preview = body.preview === true && await isOwner();
        if (body.preview === true && !preview) return fail(403, "not_owner", "Náhled může zobrazit jen autor dárku přihlášený ve své dílně.");
        if (!preview) {
          const viaToken = typeof body.token === "string" && checkToken(SECRET, giftScope(g), body.token);
          if (g.passwordHash && !viaToken && !verifyPassword(normalizePassword(body.password), g.passwordHash)) {
            await sleep(600);
            return fail(401, "bad_password", "Tohle heslo dárek neotevře.");
          }
          if (isLocked(g)) {
            return fail(423, "locked", "Dárek ještě nejde rozbalit.", { openAt: g.openAt, serverNow: new Date().toISOString() });
          }
        }
        if (!preview && !(await isOwner())) await track(g, "open");
        // a preview hands out no token: it would let the creator's browser skip the password later
        return json({ gift: publicGift(g), token: preview ? null : signToken(SECRET, giftScope(g), GIFT_TTL), preview });
      }

      // the recipient's browser wants a system notification when the box unlocks or the creator rings
      if (seg.length === 3 && seg[2] === "subscribe" && (method === "POST" || method === "DELETE")) {
        const endpoint = cleanEndpoint((await readJson(req)).endpoint);
        if (!endpoint) return fail(400, "bad_endpoint", "Tenhle prohlížeč upozornění neumí.");
        const h = sha256hex(endpoint);
        if (method === "DELETE") { await storage.removeSub(`g:${g.code}`, h); return json({ ok: true }); }
        if (!pusher.enabled) return fail(503, "push_off", "Upozornění tady nejsou zapnutá.");
        const subs = await storage.listSubs(`g:${g.code}`);
        if (subs.length >= 20 && !subs.some(x => x.hash === h)) await storage.removeSub(`g:${g.code}`, subs[0].hash);
        await storage.addSub(`g:${g.code}`, h, { endpoint, at: new Date().toISOString() });
        return json({ ok: true });
      }

      if (seg.length === 3 && seg[2] === "photo" && method === "GET") {
        if (!(await isOwner())) {
          if (!checkToken(SECRET, giftScope(g), new URL(req.url).searchParams.get("t"))) {
            return fail(401, "bad_token", "Platnost odkazu vypršela. Otevři dárek znovu.");
          }
          if (isLocked(g)) return fail(423, "locked", "Dárek ještě nejde rozbalit.");
        }
        if (!g.photo?.file) return fail(404, "not_found", "Fotka nenalezena.");
        const file = await storage.readFile(g.photo.file.id);
        if (!file) return fail(404, "not_found", "Fotka nenalezena.");
        return imageResponse(file.body, file.meta);
      }

      if (seg.length === 5 && seg[2] === "items" && seg[4] === "file" && method === "GET") {
        const url = new URL(req.url);
        if (!(await isOwner())) {
          if (!checkToken(SECRET, giftScope(g), url.searchParams.get("t"))) {
            return fail(401, "bad_token", "Platnost odkazu vypršela. Otevři dárek znovu.");
          }
          if (isLocked(g)) return fail(423, "locked", "Dárek ještě nejde rozbalit.");
        }
        const item = g.items.find(i => i.id === seg[3]);
        if (!item?.file) return fail(404, "not_found", "Soubor nenalezen.");
        const file = await storage.readFile(item.file.id);
        if (!file) return fail(404, "not_found", "Soubor nenalezen.");
        return pdfResponse(file.body, item.file, url.searchParams.get("dl") === "1");
      }
      return fail(404, "not_found", "Neznámá cesta.");
    }

    /* ----- what this installation can do ----- */
    if (seg[0] === "info" && seg.length === 1 && method === "GET") {
      return json({ mail: !!mailer.enabled, signupCode: !!signupCode, push: pusher.enabled ? pusher.publicKey : null });
    }

    /* ----- the service worker asks what the last (empty) push was about ----- */
    if (seg[0] === "push" && seg[1] === "inbox" && method === "GET") {
      const endpoint = cleanEndpoint(new URL(req.url).searchParams.get("e"));
      const msg = endpoint ? await storage.getInbox(sha256hex(endpoint)) : null;
      return json(msg || { title: "Dárky", body: "Máš nové upozornění.", url: "" }, 200, { "cache-control": "no-store" });
    }

    /* ----- cron: notify boxes that just unlocked (Vercel Cron, cron-job.org, hosting cron) ----- */
    if (seg[0] === "cron" && seg.length === 1 && (method === "GET" || method === "POST")) {
      if (cronSecret) {
        const auth = req.headers.get("authorization") || "", key = new URL(req.url).searchParams.get("key") || "";
        if (!safeEqual(auth, `Bearer ${cronSecret}`) && !safeEqual(key, cronSecret)) return fail(401, "unauthorized", "Špatný klíč pro cron.");
      }
      lastDue = Date.now();
      return json({ ok: true, sent: await processDue(100) });
    }

    /* ----- workshop (account) ----- */
    if (seg[0] === "workshop") {
      // create a new workshop
      if (seg.length === 1 && method === "POST") {
        const b = await readJson(req);
        if (signupCode && !safeEqual(String(b.signupCode ?? "").trim(), signupCode)) {
          await sleep(600);
          return fail(403, "bad_signup_code", "Kód pro založení dílny nesedí.");
        }
        const email = cleanEmail(b.email);
        if (email === null) return fail(400, "bad_email", "Tohle nevypadá jako e-mailová adresa.");
        const now = new Date().toISOString();
        const w = { id: randomId(9), name: cleanName(b.name) || "Moje dílna", email, keyHash: "", keyEnc: "", usedBytes: 0, createdAt: now, updatedAt: now };
        const key = await newKeyFor(w);
        await storage.putWorkshop(w);
        await indexEmail(w.id, "", email);
        const mailed = await mailLink(w, "welcome", key);
        return json({ workshop: await workshopView(w, key), mailed }, 201, signIn(req, w));
      }
      // sign in with the secret key from the link
      if (seg[1] === "login" && method === "POST") {
        const b = await readJson(req);
        const key = String(b.key ?? "").trim();
        const id = isKeyShaped(key) ? await storage.getKeyOwner(sha256hex(key)) : null;
        const w = id && await storage.getWorkshop(id);
        if (!w || w.keyHash !== sha256hex(key)) {
          await sleep(600);
          return fail(401, "bad_key", "Tenhle odkaz do dílny neplatí. Možná byl vyměněn za nový.");
        }
        return json({ workshop: await workshopView(w, key) }, 200, signIn(req, w));
      }
      if (seg[1] === "logout" && method === "POST") return json({ ok: true }, 200, signOut(req));
      // lost link: e-mail it to every workshop saved with this address. The answer is always
      // the same, so nobody can find out which addresses have a workshop.
      if (seg[1] === "recover" && method === "POST") {
        if (!mailer.enabled) return fail(503, "mail_off", "Posílání e-mailů tady není zapnuté.");
        const email = cleanEmail((await readJson(req)).email);
        if (!email) return fail(400, "bad_email", "Napiš e-mailovou adresu, kterou máš u dílny uloženou.");
        const started = Date.now();
        for (const id of (await storage.getEmailOwners(emailHash(email))).slice(0, 5)) {
          const w = await storage.getWorkshop(id);
          if (w?.email && emailHash(w.email) === emailHash(email)) await mailLink(w, "recover");
        }
        await sleep(Math.max(0, 700 - (Date.now() - started)));
        return json({ ok: true });
      }

      const w = await currentWorkshop(req);
      if (!w) return fail(401, "unauthorized", "Otevři svou dílnu tajným odkazem.");

      if (seg.length === 1 && method === "GET") return json({ workshop: await workshopView(w) });
      if (seg.length === 1 && method === "PUT") {
        const b = await readJson(req);
        const email = b.email === undefined ? w.email : cleanEmail(b.email);
        if (email === null) return fail(400, "bad_email", "Tohle nevypadá jako e-mailová adresa.");
        const next = {
          ...w, name: b.name === undefined ? w.name : (cleanName(b.name) || "Moje dílna"), email,
          theme: b.theme === undefined ? theme(w.theme) : theme(b.theme),
          notifyOpen: b.notifyOpen === undefined ? w.notifyOpen !== false : !!b.notifyOpen,
          updatedAt: new Date().toISOString()
        };
        await storage.putWorkshop(next);
        await indexEmail(w.id, w.email, email);
        return json({ workshop: await workshopView(next) });
      }
      // the creator's browser: "someone opened / unwrapped my box"
      if (seg[1] === "subscribe" && (method === "POST" || method === "DELETE")) {
        const endpoint = cleanEndpoint((await readJson(req)).endpoint);
        if (!endpoint) return fail(400, "bad_endpoint", "Tenhle prohlížeč upozornění neumí.");
        const h = sha256hex(endpoint);
        if (method === "DELETE") { await storage.removeSub(`w:${w.id}`, h); return json({ ok: true }); }
        if (!pusher.enabled) return fail(503, "push_off", "Upozornění tady nejsou zapnutá.");
        await storage.addSub(`w:${w.id}`, h, { endpoint, at: new Date().toISOString() });
        return json({ ok: true });
      }
      if (seg[1] === "send-link" && method === "POST") {
        if (!mailer.enabled) return fail(503, "mail_off", "Posílání e-mailů tady není zapnuté.");
        if (!w.email) return fail(400, "no_email", "Nejdřív ulož e-mail, na který odkaz poslat.");
        if (w.mailedAt && Date.now() - Date.parse(w.mailedAt) < MAIL_GAP) {
          return fail(429, "too_soon", "E-mail jsme poslali před chvílí. Zkus to zase za minutu.");
        }
        if (!(await mailLink(w, "link"))) return fail(502, "mail_failed", "E-mail se nepodařilo odeslat. Zkus to prosím později.");
        return json({ ok: true, email: w.email });
      }
      if (seg[1] === "rotate-key" && method === "POST") {
        const oldHash = w.keyHash;
        const next = { ...w, updatedAt: new Date().toISOString() };
        const key = await newKeyFor(next);
        await storage.putWorkshop(next);
        await storage.deleteKeyOwner(oldHash);
        const mailed = await mailLink({ ...next, mailedAt: null }, "rotated", key);
        return json({ workshop: await workshopView(next, key), mailed }, 200, signIn(req, next));
      }
      if (seg.length === 1 && method === "DELETE") {
        for (const g of await storage.listGiftsByOwner(w.id)) { await storage.deleteGift(g.code); await dropGiftExtras(g.code); }
        await storage.deleteSubs(`w:${w.id}`);
        for (const f of await storage.listFilesByOwner(w.id)) await storage.deleteFile(f.id);
        await storage.deleteKeyOwner(w.keyHash);
        await indexEmail(w.id, w.email, "");
        await storage.deleteWorkshop(w.id);
        return json({ ok: true }, 200, signOut(req));
      }
      return fail(404, "not_found", "Neznámá cesta.");
    }

    /* ----- the workshop's boxes and files ----- */
    if (seg[0] === "admin") {
      const w = await currentWorkshop(req);
      if (!w) return fail(401, "unauthorized", "Otevři svou dílnu tajným odkazem.");

      if (seg[1] === "files") {
        if (seg.length === 2 && method === "POST") {
          const tooBig = () => fail(413, "too_large", `Soubor je větší než ${MB(maxUploadBytes)} MB.`);
          const len = Number(req.headers.get("content-length") || 0);
          if (len > maxUploadBytes) return tooBig();
          const buf = Buffer.from(await req.arrayBuffer());
          if (buf.length > maxUploadBytes) return tooBig();
          const type = sniffType(buf);
          if (!type) return fail(415, "bad_type", "Nahrát jde PDF poukaz nebo fotka (JPEG, PNG, WebP).");
          const fresh = await storage.getWorkshop(w.id);
          if ((fresh.usedBytes || 0) + buf.length > maxStorageBytes) {
            return fail(413, "quota", `Dílna má místo na ${MB(maxStorageBytes)} MB souborů a je plná. Smaž nepotřebné poukazy nebo fotky.`);
          }
          const fallback = type === "application/pdf" ? "poukaz.pdf" : "fotka";
          let name = fallback;
          try { name = decodeURIComponent(req.headers.get("x-file-name") || name); } catch { /* keep default */ }
          name = name.replace(/[\\/\r\n]/g, "_").slice(0, 120) || fallback;
          const dim = v => { const n = Math.round(Number(v)); return n > 0 && n < 20000 ? n : null; };
          const meta = { id: randomId(12), owner: w.id, name, size: buf.length, type, createdAt: new Date().toISOString() };
          if (type !== "application/pdf") { meta.w = dim(req.headers.get("x-image-width")); meta.h = dim(req.headers.get("x-image-height")); }
          await storage.saveFile(meta, buf);
          await adjustUsage(w, buf.length);
          return json({ id: meta.id, name: meta.name, size: meta.size, type, w: meta.w ?? null, h: meta.h ?? null }, 201);
        }
        if (seg.length === 3 && method === "GET") {
          const file = await storage.readFile(seg[2]);
          if (!file || file.meta.owner !== w.id) return fail(404, "not_found", "Soubor nenalezen.");
          return isImage(file.meta) ? imageResponse(file.body, file.meta) : pdfResponse(file.body, file.meta, false);
        }
      }

      if (seg[1] === "gifts") {
        if (seg.length === 2 && method === "GET") {
          const all = await storage.listGiftsByOwner(w.id);
          all.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
          const stats = await storage.getStatsMany(all.map(g => g.code));
          return json({ gifts: all.map((g, i) => ({ ...summary(g), stats: stats[i] })), serverNow: new Date().toISOString() });
        }
        if (seg.length === 2 && method === "POST") {
          if (await storage.countGiftsByOwner(w.id) >= maxGifts) {
            return fail(409, "limit", `V jedné dílně může být nejvýš ${maxGifts} boxů.`);
          }
          const body = await readJson(req);
          const now = new Date().toISOString();
          const g = {
            code: await uniqueCode(),
            owner: w.id,
            title: str(body.title, 120) || "Nový dárek",
            showTitle: true,
            message: "",
            signature: "",
            passwordHash: null,
            anytime: false,
            openAt: Number.isFinite(Date.parse(body.openAt)) ? new Date(body.openAt).toISOString() : defaultOpenAt(),
            manualUnlock: false,
            theme: theme(body.theme ?? w.theme),
            appearance: sanitizeAppearance(body.appearance),
            reveal: REVEALS.includes(body.reveal) ? body.reveal : "all",
            items: [],
            photo: null,
            createdAt: now,
            updatedAt: now
          };
          await storage.putGift(g);
          await syncDue(null, g);
          return json(adminView(g), 201);
        }

        const code = normalizeCode(seg[2]);
        const g = code && await storage.getGift(code);
        // someone else's box looks exactly like a missing one
        if (!g || g.owner !== w.id) return fail(404, "not_found", "Box nenalezen.");

        if (seg.length === 3 && method === "GET") return json({ ...adminView(g), stats: await storage.getStats(g.code) });

        if (seg.length === 3 && method === "PUT") {
          const b = await readJson(req);
          const items = await sanitizeItems(b.items, g.items, w.id);
          const photo = b.photo === undefined ? g.photo : await sanitizePhoto(b.photo, g.photo, w.id);
          const next = {
            ...g,
            title: str(b.title, 120).trim() || g.title,
            showTitle: !!b.showTitle,
            message: str(b.message, 4000),
            signature: str(b.signature, 200),
            anytime: !!b.anytime,
            manualUnlock: !!b.manualUnlock,
            openAt: Number.isFinite(Date.parse(b.openAt)) ? new Date(b.openAt).toISOString() : g.openAt,
            appearance: b.appearance === undefined ? g.appearance : sanitizeAppearance(b.appearance),
            reveal: REVEALS.includes(b.reveal) ? b.reveal : g.reveal,
            theme: b.theme === undefined ? g.theme : theme(b.theme),
            items,
            photo,
            updatedAt: new Date().toISOString()
          };
          if (b.password === null) next.passwordHash = null;
          else if (typeof b.password === "string") {
            const pw = normalizePassword(b.password);
            if (!pw) return fail(400, "empty_password", "Heslo nesmí být prázdné. Pro dárek bez hesla vypni heslo.");
            next.passwordHash = hashPassword(pw);
          }
          if (b.recipientEmail !== undefined) {
            const re = cleanEmail(b.recipientEmail);
            if (re === null) return fail(400, "bad_email", "E-mail obdarovaného nevypadá jako e-mailová adresa.");
            next.recipientEmail = re;
          }
          // locked again (a new unlock time): the recipient should hear about it when that time comes
          next.notifiedAt = isLocked(next) ? null : g.notifiedAt || null;
          await storage.putGift(next);
          await removeOrphanFiles(w, filesOf(g), filesOf(next));
          const saved = await syncDue(g, next);
          return json({ ...adminView(saved), stats: await storage.getStats(g.code) });
        }

        // "Zazvonit zvonečkem": nudge the recipient now (e-mail, system notification, and the open page rings)
        if (seg.length === 4 && seg[3] === "ring" && method === "POST") {
          if (g.ringAt && Date.now() - Date.parse(g.ringAt) < ringGapMs) {
            return fail(429, "too_soon", "Zvonilo se před chvílí. Zkus to zase za minutu.");
          }
          const ringAt = new Date().toISOString();
          await storage.putGift({ ...g, ringAt });
          const r = await notifyRecipient(g, "ring");
          return json({ ok: true, ringAt, ...r });
        }

        if (seg.length === 3 && method === "DELETE") {
          await storage.deleteGift(g.code);
          await dropGiftExtras(g.code);
          await removeOrphanFiles(w, filesOf(g), []);
          return json({ ok: true });
        }

        if (seg.length === 4 && seg[3] === "regenerate-code" && method === "POST") {
          const next = { ...g, code: await uniqueCode(), updatedAt: new Date().toISOString() };
          await storage.deleteGift(g.code);
          await dropGiftExtras(g.code);          // the old link is dead, so are its subscriptions
          await storage.putGift(next);
          await syncDue(null, next);
          return json(adminView(next));
        }
      }
      return fail(404, "not_found", "Neznámá cesta.");
    }
    return fail(404, "not_found", "Neznámá cesta.");
  }

  /** Web-standard handler. `path` is the part after /api/ */
  return async function handle(req, path) {
    try {
      return await route(req, path);
    } catch (err) {
      console.error(err);
      return fail(500, "server_error", "Na serveru se něco pokazilo. Zkus to prosím znovu.");
    }
  };
}

/** Extracts the API sub-path from a request URL (supports /api/x/y and /api?path=x/y) */
export function apiPath(url) {
  const u = new URL(url);
  const m = u.pathname.match(/\/api\/(.+)$/);
  if (m) return m[1];
  return u.searchParams.get("path") || "";
}
