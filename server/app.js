import {
  hashPassword, verifyPassword, normalizePassword, signToken, checkToken,
  safeEqual, randomId, generateCode, normalizeCode, hmac,
  generateKey, isKeyShaped, sha256hex, encrypt, decrypt
} from "./security.js";

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
export const PATTERNS = ["plain", "stripes", "dots", "tartan", "stars", "snow", "trees", "baubles", "holly", "candy", "gingerbread", "deer", "hearts"];
export const INKS = ["white", "cream", "gold", "silver", "bronze", "red", "green", "navy", "brown", "black"];
export const RIBBONS = ["gold", "silver", "copper", "red", "burgundy", "pink", "green", "navy", "white", "black"];
export const RIBBON_STYLES = ["cross", "single", "none"];
export const BOWS = ["classic", "double", "rosette", "small", "none"];
export const DECOS = ["none", "holly", "pine", "candy", "bauble", "star", "bells", "orange"];
export const PHOTO_FRAMES = ["polaroid", "postcard"];
export const REVEALS = ["all", "sequential", "choice"];
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
  return { ...g, appearance: sanitizeAppearance(g.appearance), reveal: REVEALS.includes(g.reveal) ? g.reveal : "all", photo: g.photo || null };
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
    appearance: g.appearance, reveal: g.reveal,
    itemCount: g.items.length, fileCount: g.items.filter(i => i.file).length, hasPhoto: !!g.photo,
    createdAt: g.createdAt, updatedAt: g.updatedAt
  };
}

function publicGift(g) {
  return {
    code: g.code,
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
  maxGifts = 50, maxStorageBytes = 100 * 1024 * 1024, signupCode = ""
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

      if (seg.length === 2 && method === "GET") {
        return json({
          code: g.code,
          title: g.showTitle ? g.title : null,
          hasPassword: !!g.passwordHash,
          appearance: g.appearance,
          locked: isLocked(g),
          openAt: g.anytime ? null : g.openAt,
          serverNow: new Date().toISOString()
        });
      }

      const isOwner = async () => { const w = await currentWorkshop(req); return !!w && g.owner === w.id; };

      if (seg.length === 3 && seg[2] === "open" && method === "POST") {
        const body = await readJson(req);
        const preview = body.preview === true && await isOwner();
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
        return json({ gift: publicGift(g), token: signToken(SECRET, giftScope(g), GIFT_TTL), preview });
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
        return json({ workshop: await workshopView(w, key) }, 201, signIn(req, w));
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

      const w = await currentWorkshop(req);
      if (!w) return fail(401, "unauthorized", "Otevři svou dílnu tajným odkazem.");

      if (seg.length === 1 && method === "GET") return json({ workshop: await workshopView(w) });
      if (seg.length === 1 && method === "PUT") {
        const b = await readJson(req);
        const email = b.email === undefined ? w.email : cleanEmail(b.email);
        if (email === null) return fail(400, "bad_email", "Tohle nevypadá jako e-mailová adresa.");
        const next = { ...w, name: b.name === undefined ? w.name : (cleanName(b.name) || "Moje dílna"), email, updatedAt: new Date().toISOString() };
        await storage.putWorkshop(next);
        return json({ workshop: await workshopView(next) });
      }
      if (seg[1] === "rotate-key" && method === "POST") {
        const oldHash = w.keyHash;
        const next = { ...w, updatedAt: new Date().toISOString() };
        const key = await newKeyFor(next);
        await storage.putWorkshop(next);
        await storage.deleteKeyOwner(oldHash);
        return json({ workshop: await workshopView(next, key) }, 200, signIn(req, next));
      }
      if (seg.length === 1 && method === "DELETE") {
        for (const g of await storage.listGiftsByOwner(w.id)) await storage.deleteGift(g.code);
        for (const f of await storage.listFilesByOwner(w.id)) await storage.deleteFile(f.id);
        await storage.deleteKeyOwner(w.keyHash);
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
          return json({ gifts: all.map(summary), serverNow: new Date().toISOString() });
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
            openAt: defaultOpenAt(),
            manualUnlock: false,
            appearance: sanitizeAppearance(body.appearance),
            reveal: REVEALS.includes(body.reveal) ? body.reveal : "all",
            items: [],
            photo: null,
            createdAt: now,
            updatedAt: now
          };
          await storage.putGift(g);
          return json(adminView(g), 201);
        }

        const code = normalizeCode(seg[2]);
        const g = code && await storage.getGift(code);
        // someone else's box looks exactly like a missing one
        if (!g || g.owner !== w.id) return fail(404, "not_found", "Box nenalezen.");

        if (seg.length === 3 && method === "GET") return json(adminView(g));

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
          await storage.putGift(next);
          await removeOrphanFiles(w, filesOf(g), filesOf(next));
          return json(adminView(next));
        }

        if (seg.length === 3 && method === "DELETE") {
          await storage.deleteGift(g.code);
          await removeOrphanFiles(w, filesOf(g), []);
          return json({ ok: true });
        }

        if (seg.length === 4 && seg[3] === "regenerate-code" && method === "POST") {
          const next = { ...g, code: await uniqueCode(), updatedAt: new Date().toISOString() };
          await storage.deleteGift(g.code);
          await storage.putGift(next);
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
