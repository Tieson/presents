/* The trial workshop: the whole backend (server/app.js) running inside the browser, with
   IndexedDB instead of a database. Nothing leaves the device until the owner saves the
   workshop to an account; then the boxes and files are replayed against the real API. */
import "./shim.js";
import { createApp } from "../../../server/app.js";
import { plainPassword } from "./security.js";

const DB = "xd-local";
const EMPTY_STATS = { views: 0, opens: 0, firstViewAt: null, lastViewAt: null, firstOpenAt: null, lastOpenAt: null };

/* ---------- IndexedDB: "kv" (JSON by key) and "blobs" (file bodies by id) ---------- */
let dbP = null;
function db() {
  return (dbP ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore("kv"); r.result.createObjectStore("blobs"); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => { dbP = null; reject(r.error); };
  }));
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = t.onabort = () => reject(t.error || new Error("Úložiště prohlížeče odmítlo zápis."));
  });
}
const kv = {
  get: async k => (await tx("kv", "readonly", s => s.get(k))) ?? null,
  set: (k, v) => tx("kv", "readwrite", s => s.put(v, k)),
  del: k => tx("kv", "readwrite", s => s.delete(k)),
  list: async prefix => (await tx("kv", "readonly", s => s.getAll(IDBKeyRange.bound(prefix, `${prefix}￿`)))) || []
};

/* ---------- the storage interface of server/storage/*.js ---------- */
const storage = {
  getWorkshop: id => kv.get(`ws:${id}`),
  putWorkshop: w => kv.set(`ws:${w.id}`, w),
  deleteWorkshop: id => kv.del(`ws:${id}`),
  getKeyOwner: hash => kv.get(`key:${hash}`),
  setKeyOwner: (hash, id) => kv.set(`key:${hash}`, id),
  deleteKeyOwner: hash => kv.del(`key:${hash}`),
  getEmailOwners: async hash => (await kv.get(`email:${hash}`)) || [],
  setEmailOwners: (hash, ids) => (ids.length ? kv.set(`email:${hash}`, ids) : kv.del(`email:${hash}`)),

  listGiftsByOwner: async owner => (await kv.list("gift:")).filter(g => g.owner === owner),
  async countGiftsByOwner(owner) { return (await this.listGiftsByOwner(owner)).length; },
  getGift: code => kv.get(`gift:${code}`),
  putGift: g => kv.set(`gift:${g.code}`, g),
  async deleteGift(code) { await kv.del(`gift:${code}`); await kv.del(`stats:${code}`); },

  // nobody else can reach this browser, so there is nothing to notify
  async setDue() {}, async dueCodes() { return []; }, async claimDue() { return false; },
  async addSub() {}, async listSubs() { return []; }, async removeSub() {}, async deleteSubs() {},
  async putInbox() {}, async getInbox() { return null; },

  async bumpStats(code, kind, at) {
    const s = { ...EMPTY_STATS, ...(await kv.get(`stats:${code}`)) };
    if (kind === "open") { s.opens++; s.firstOpenAt ??= at; s.lastOpenAt = at; }
    else { s.views++; s.firstViewAt ??= at; s.lastViewAt = at; }
    await kv.set(`stats:${code}`, s);
    return kind === "open" ? s.opens : s.views;
  },
  getStats: async code => ({ ...EMPTY_STATS, ...(await kv.get(`stats:${code}`)) }),
  async getStatsMany(codes) { return Promise.all(codes.map(c => this.getStats(c))); },

  async saveFile(meta, buf) {
    await tx("blobs", "readwrite", s => s.put(new Blob([buf], { type: meta.type || "application/pdf" }), meta.id));
    await kv.set(`file:${meta.id}`, meta);
  },
  getFileMeta: id => kv.get(`file:${id}`),
  listFilesByOwner: async owner => (await kv.list("file:")).filter(f => f.owner === owner),
  async readFile(id) {
    const meta = await kv.get(`file:${id}`);
    const body = meta && await tx("blobs", "readonly", s => s.get(id));
    return body ? { meta, body } : null;
  },
  async deleteFile(id) { await tx("blobs", "readwrite", s => s.delete(id)); await kv.del(`file:${id}`); }
};

/* ---------- the app ---------- */
let appP = null;
function app() {
  return (appP ??= (async () => {
    let secret = await kv.get("meta:secret");
    if (!secret) { secret = Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, "0")).join(""); await kv.set("meta:secret", secret); }
    return createApp({ storage, secret, log: { error() {} } });
  })());
}

async function call(path, { method = "GET", headers = {}, body } = {}, cookie = "") {
  const handle = await app();
  const h = new Headers(headers);
  if (cookie) h.set("cookie", cookie);
  const bytes = async () => (body == null ? new ArrayBuffer(0) : typeof body === "string" ? new TextEncoder().encode(body).buffer : body instanceof Blob ? body.arrayBuffer() : ArrayBuffer.isView(body) ? body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) : body);
  const req = {
    method, headers: h,
    url: new URL(`api/${path}`, document.baseURI).href,
    json: async () => JSON.parse(new TextDecoder().decode(await bytes())),
    arrayBuffer: bytes
  };
  return handle(req, path.split("?")[0]);
}

/** Same as fetch("api/<path>"), answered by the workshop in this browser (always signed in as its owner) */
export async function request(path, init = {}) {
  const id = await kv.get("meta:ws");
  const cookie = id ? await (await app()).session(id) : "";
  return call(path, init, cookie);
}

/** Opens the trial workshop, creating it on the first visit */
export async function start(name = "") {
  if (await kv.get("meta:ws")) return;
  const res = await call("workshop", { method: "POST", headers: { "x-admin": "1", "content-type": "application/json" }, body: JSON.stringify({ name: name || "Zkušební dílna", email: "" }) });
  if (!res.ok) throw new Error("Zkušební dílnu se nepodařilo založit.");
  await kv.set("meta:ws", (await res.json()).workshop.id);
}

export const exists = async () => { try { return !!(await kv.get("meta:ws")); } catch { return false; } };
export const hasGift = async code => { try { return !!(await kv.get(`gift:${code}`)); } catch { return false; } };

/** Everything needed to rebuild the boxes on a server: raw boxes (with the password readable) and file bodies */
export async function dump() {
  const id = await kv.get("meta:ws");
  const w = id && await storage.getWorkshop(id);
  const gifts = id ? await storage.listGiftsByOwner(id) : [];
  gifts.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return {
    workshop: w ? { name: w.name, theme: w.theme } : null,
    gifts: gifts.map(({ passwordHash, ...g }) => ({ ...g, password: plainPassword(passwordHash) })),
    file: async fid => (await storage.readFile(fid))?.body || null
  };
}

/** Forgets the trial workshop (after it moved to an account, or when the owner throws it away) */
export async function clear() {
  appP = null;
  const d = await db().catch(() => null);
  d?.close();
  dbP = null;
  await new Promise(resolve => { const r = indexedDB.deleteDatabase(DB); r.onsuccess = r.onerror = r.onblocked = () => resolve(); });
}
