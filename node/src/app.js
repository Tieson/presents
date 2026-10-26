import {
  hashPassword, verifyPassword, normalizePassword, signToken, checkToken,
  safeEqual, randomId, generateCode, normalizeCode, hmac
} from "./security.js";

const ADMIN_COOKIE = "xd_admin";
const ADMIN_TTL = 60 * 60 * 24 * 14;   // 14 days
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
export const PAPERS = ["burgundy", "emerald", "midnight", "ivory", "champagne", "blush", "charcoal", "silver"];
export const PATTERNS = ["plain", "stripes", "dots", "stars", "snow", "tartan"];
export const RIBBONS = ["gold", "silver", "red", "green", "white", "black"];
export const RIBBON_STYLES = ["cross", "single"];
export const REVEALS = ["all", "sequential", "choice"];
export const DEFAULT_APPEARANCE = { paper: "burgundy", pattern: "stripes", ribbon: "gold", ribbonStyle: "cross", seal: "V" };

export function sanitizeAppearance(a) {
  const src = a && typeof a === "object" ? a : {};
  const pick = (list, v, d) => (list.includes(v) ? v : d);
  const seal = typeof src.seal === "string" ? [...src.seal.trim()].slice(0, 2).join("") : DEFAULT_APPEARANCE.seal;
  return {
    paper: pick(PAPERS, src.paper, DEFAULT_APPEARANCE.paper),
    pattern: pick(PATTERNS, src.pattern, DEFAULT_APPEARANCE.pattern),
    ribbon: pick(RIBBONS, src.ribbon, DEFAULT_APPEARANCE.ribbon),
    ribbonStyle: pick(RIBBON_STYLES, src.ribbonStyle, DEFAULT_APPEARANCE.ribbonStyle),
    seal
  };
}

/** Boxes saved before these options existed get the defaults */
function withDefaults(g) {
  if (!g) return g;
  return { ...g, appearance: sanitizeAppearance(g.appearance), reveal: REVEALS.includes(g.reveal) ? g.reveal : "all" };
}

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
    itemCount: g.items.length, fileCount: g.items.filter(i => i.file).length,
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
    }))
  };
}

const giftScope = g => `gift|${g.code}|${g.passwordHash ? g.passwordHash.slice(-16) : "none"}`;

function contentDisposition(name, download) {
  const safe = String(name || "poukaz.pdf").replace(/[\r\n"]/g, "");
  const ascii = safe.normalize("NFD").replace(/[^\x20-\x7e]/g, "");
  return `${download ? "attachment" : "inline"}; filename="${ascii || "poukaz.pdf"}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
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

export function createApp({ storage, adminPassword, secret, maxUploadBytes = 4 * 1024 * 1024 }) {
  if (!adminPassword) throw new Error("ADMIN_PASSWORD is not set");
  const raw = storage;
  storage = {
    ...raw,
    getGift: async code => withDefaults(await raw.getGift(code)),
    listGifts: async () => (await raw.listGifts()).map(withDefaults)
  };
  const SECRET = secret || hmac("xd-derived-secret", adminPassword);

  function isAdmin(req) {
    const c = parseCookies(req.headers.get("cookie"))[ADMIN_COOKIE];
    return checkToken(SECRET, "admin", c);
  }

  function adminCookie(req, value, maxAge) {
    const secure = new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
    return `${ADMIN_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
  }

  async function uniqueCode() {
    for (let i = 0; i < 20; i++) {
      const c = generateCode();
      if (!(await storage.getGift(c))) return c;
    }
    throw new Error("Could not generate a unique code");
  }

  async function sanitizeItems(rawItems, previous) {
    const prevFiles = new Map(previous.filter(i => i.file).map(i => [i.file.id, i.file]));
    const items = [];
    for (const raw of (Array.isArray(rawItems) ? rawItems : []).slice(0, MAX_ITEMS)) {
      let file = null;
      const fid = raw?.file?.id;
      if (fid) {
        file = prevFiles.get(fid) || null;
        if (!file) {
          const meta = await storage.getFileMeta(fid);
          if (meta) file = { id: meta.id, name: meta.name, size: meta.size };
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

  async function removeOrphanFiles(before, after) {
    const keep = new Set(after.filter(i => i.file).map(i => i.file.id));
    for (const i of before) {
      if (i.file && !keep.has(i.file.id)) {
        try { await storage.deleteFile(i.file.id); } catch { /* ignore */ }
      }
    }
  }

  async function route(req, path) {
    const method = req.method.toUpperCase();
    const seg = path.split("/").filter(Boolean).map(decodeURIComponent);

    /* ----- public ----- */
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

      if (seg.length === 3 && seg[2] === "open" && method === "POST") {
        const body = await readJson(req);
        const preview = body.preview === true && isAdmin(req);
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

      if (seg.length === 5 && seg[2] === "items" && seg[4] === "file" && method === "GET") {
        const url = new URL(req.url);
        const admin = isAdmin(req);
        if (!admin) {
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

    /* ----- admin ----- */
    if (seg[0] === "admin") {
      if (seg[1] === "login" && method === "POST") {
        const body = await readJson(req);
        if (!safeEqual(String(body.password ?? ""), adminPassword)) {
          await sleep(800);
          return fail(401, "bad_password", "Nesprávné heslo do dílny.");
        }
        return json({ ok: true }, 200, { "set-cookie": adminCookie(req, signToken(SECRET, "admin", ADMIN_TTL), ADMIN_TTL) });
      }
      if (seg[1] === "logout" && method === "POST") {
        return json({ ok: true }, 200, { "set-cookie": adminCookie(req, "", 0) });
      }

      if (!isAdmin(req)) return fail(401, "unauthorized", "Přihlas se do dílny.");
      // CSRF guard for anything that changes state
      if (method !== "GET" && req.headers.get("x-admin") !== "1") return fail(403, "forbidden", "Chybí hlavička X-Admin.");

      if (seg[1] === "me" && method === "GET") return json({ ok: true });

      if (seg[1] === "files") {
        if (seg.length === 2 && method === "POST") {
          const len = Number(req.headers.get("content-length") || 0);
          if (len > maxUploadBytes) return fail(413, "too_large", `Soubor je větší než ${Math.round(maxUploadBytes / 1048576)} MB.`);
          const buf = Buffer.from(await req.arrayBuffer());
          if (buf.length > maxUploadBytes) return fail(413, "too_large", `Soubor je větší než ${Math.round(maxUploadBytes / 1048576)} MB.`);
          if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") return fail(415, "not_pdf", "Nahrát jde jen PDF soubor.");
          let name = "poukaz.pdf";
          try { name = decodeURIComponent(req.headers.get("x-file-name") || name); } catch { /* keep default */ }
          name = name.replace(/[\\/\r\n]/g, "_").slice(0, 120) || "poukaz.pdf";
          const meta = { id: randomId(12), name, size: buf.length, createdAt: new Date().toISOString() };
          await storage.saveFile(meta, buf);
          return json({ id: meta.id, name: meta.name, size: meta.size }, 201);
        }
        if (seg.length === 3 && method === "GET") {
          const file = await storage.readFile(seg[2]);
          if (!file) return fail(404, "not_found", "Soubor nenalezen.");
          return pdfResponse(file.body, file.meta, false);
        }
      }

      if (seg[1] === "gifts") {
        if (seg.length === 2 && method === "GET") {
          const all = await storage.listGifts();
          all.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
          return json({ gifts: all.map(summary), serverNow: new Date().toISOString() });
        }
        if (seg.length === 2 && method === "POST") {
          const body = await readJson(req);
          const now = new Date().toISOString();
          const g = {
            code: await uniqueCode(),
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
            createdAt: now,
            updatedAt: now
          };
          await storage.putGift(g);
          return json(adminView(g), 201);
        }

        const code = normalizeCode(seg[2]);
        const g = code && await storage.getGift(code);
        if (!g) return fail(404, "not_found", "Box nenalezen.");

        if (seg.length === 3 && method === "GET") return json(adminView(g));

        if (seg.length === 3 && method === "PUT") {
          const b = await readJson(req);
          const items = await sanitizeItems(b.items, g.items);
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
            updatedAt: new Date().toISOString()
          };
          if (b.password === null) next.passwordHash = null;
          else if (typeof b.password === "string") {
            const pw = normalizePassword(b.password);
            if (!pw) return fail(400, "empty_password", "Heslo nesmí být prázdné. Pro dárek bez hesla vypni heslo.");
            next.passwordHash = hashPassword(pw);
          }
          await storage.putGift(next);
          await removeOrphanFiles(g.items, items);
          return json(adminView(next));
        }

        if (seg.length === 3 && method === "DELETE") {
          await storage.deleteGift(g.code);
          await removeOrphanFiles(g.items, []);
          return json({ ok: true });
        }

        if (seg.length === 4 && seg[3] === "regenerate-code" && method === "POST") {
          const next = { ...g, code: await uniqueCode(), updatedAt: new Date().toISOString() };
          await storage.putGift(next);
          await storage.deleteGift(g.code);
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
