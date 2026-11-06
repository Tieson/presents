import fs from "node:fs/promises";
import path from "node:path";

/**
 * Plain file storage:
 *   data/workshops/<id>.json     workshop (account)
 *   data/keys/<sha256>.json      { id } – finds a workshop by the hash of its secret key
 *   data/emails/<sha256>.json    { ids } – workshops saved with an e-mail address (lost-link e-mails)
 *   data/gifts/<code>.json       box (has `owner` = workshop id)
 *   data/stats/<code>.json       views / unwraps of a box (kept apart, so a visit never overwrites an edit)
 *   data/due/<code>              unlock time (ms) of a box that still has to notify when it unlocks
 *   data/subs/<scope>.json       push subscriptions (scope g-<code> | w-<workshop id>)
 *   data/inbox/<sha256>.json     last notification text for a subscription's service worker
 *   data/files/<id>.pdf + .json  uploaded file + meta (has `owner`; `type` says PDF or image,
 *                                the .pdf name is kept for every file so older data still works)
 */
const EMPTY_STATS = { views: 0, opens: 0, firstViewAt: null, lastViewAt: null, firstOpenAt: null, lastOpenAt: null };

export function fsStorage(dataDir) {
  const dirs = {
    gifts: path.join(dataDir, "gifts"),
    files: path.join(dataDir, "files"),
    workshops: path.join(dataDir, "workshops"),
    keys: path.join(dataDir, "keys"),
    emails: path.join(dataDir, "emails"),
    stats: path.join(dataDir, "stats"),
    due: path.join(dataDir, "due"),
    subs: path.join(dataDir, "subs"),
    inbox: path.join(dataDir, "inbox")
  };
  const scopeFile = scope => path.join(dirs.subs, `${scope.replace(":", "-")}.json`);
  const ready = Promise.all(Object.values(dirs).map(d => fs.mkdir(d, { recursive: true })));
  const safe = s => typeof s === "string" && /^[\w-]+$/.test(s);

  async function writeAtomic(file, data) {
    const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, file);
  }
  async function readJson(file) {
    try { return JSON.parse(await fs.readFile(file, "utf8")); }
    catch (e) { if (e.code === "ENOENT") return null; throw e; }
  }
  async function readAll(dir) {
    const out = [];
    for (const n of (await fs.readdir(dir)).filter(n => n.endsWith(".json"))) {
      const v = await readJson(path.join(dir, n));
      if (v) out.push(v);
    }
    return out;
  }

  return {
    /* workshops */
    async getWorkshop(id) { await ready; return safe(id) ? readJson(path.join(dirs.workshops, `${id}.json`)) : null; },
    async putWorkshop(w) { await ready; await writeAtomic(path.join(dirs.workshops, `${w.id}.json`), JSON.stringify(w, null, 2)); },
    async deleteWorkshop(id) { await ready; if (safe(id)) await fs.rm(path.join(dirs.workshops, `${id}.json`), { force: true }); },
    async getKeyOwner(hash) { await ready; return safe(hash) ? (await readJson(path.join(dirs.keys, `${hash}.json`)))?.id ?? null : null; },
    async setKeyOwner(hash, id) { await ready; await writeAtomic(path.join(dirs.keys, `${hash}.json`), JSON.stringify({ id })); },
    async deleteKeyOwner(hash) { await ready; if (safe(hash)) await fs.rm(path.join(dirs.keys, `${hash}.json`), { force: true }); },
    async getEmailOwners(hash) { await ready; return safe(hash) ? (await readJson(path.join(dirs.emails, `${hash}.json`)))?.ids ?? [] : []; },
    async setEmailOwners(hash, ids) {
      await ready;
      if (!safe(hash)) return;
      const file = path.join(dirs.emails, `${hash}.json`);
      if (ids.length) await writeAtomic(file, JSON.stringify({ ids })); else await fs.rm(file, { force: true });
    },

    /* gifts */
    async listGiftsByOwner(owner) { await ready; return (await readAll(dirs.gifts)).filter(g => g.owner === owner); },
    async countGiftsByOwner(owner) { return (await this.listGiftsByOwner(owner)).length; },
    async getGift(code) { await ready; return safe(code) ? readJson(path.join(dirs.gifts, `${code}.json`)) : null; },
    async putGift(g) { await ready; await writeAtomic(path.join(dirs.gifts, `${g.code}.json`), JSON.stringify(g, null, 2)); },
    async deleteGift(code) {
      await ready;
      if (!safe(code)) return;
      await fs.rm(path.join(dirs.gifts, `${code}.json`), { force: true });
      await fs.rm(path.join(dirs.stats, `${code}.json`), { force: true });
    },

    /* notifications */
    async setDue(code, ms) {
      await ready;
      if (!safe(code)) return;
      const f = path.join(dirs.due, code);
      if (ms == null) await fs.rm(f, { force: true }); else await writeAtomic(f, String(ms));
    },
    async dueCodes(nowMs) {
      await ready;
      const out = [];
      for (const code of await fs.readdir(dirs.due)) {
        if (!safe(code)) continue;
        const ms = Number(await fs.readFile(path.join(dirs.due, code), "utf8").catch(() => NaN));
        if (ms <= nowMs) out.push(code);
      }
      return out;
    },
    async claimDue(code) {                                           // rename is atomic: only one caller wins
      await ready;
      if (!safe(code)) return false;
      const claimed = path.join(dirs.due, `${code}.${process.pid}.${Math.random().toString(36).slice(2)}.claim`);
      try { await fs.rename(path.join(dirs.due, code), claimed); } catch { return false; }
      await fs.rm(claimed, { force: true });
      return true;
    },
    async addSub(scope, hash, sub) {
      await ready;
      const all = (await readJson(scopeFile(scope))) || {};
      all[hash] = sub;
      await writeAtomic(scopeFile(scope), JSON.stringify(all));
    },
    async listSubs(scope) { await ready; return Object.entries((await readJson(scopeFile(scope))) || {}).map(([k, v]) => ({ hash: k, ...v })); },
    async removeSub(scope, hash) {
      await ready;
      const all = (await readJson(scopeFile(scope))) || {};
      delete all[hash];
      if (Object.keys(all).length) await writeAtomic(scopeFile(scope), JSON.stringify(all)); else await fs.rm(scopeFile(scope), { force: true });
      if (safe(hash)) await fs.rm(path.join(dirs.inbox, `${hash}.json`), { force: true });
    },
    async deleteSubs(scope) { for (const s of await this.listSubs(scope)) await this.removeSub(scope, s.hash); },
    async putInbox(hash, msg) { await ready; if (safe(hash)) await writeAtomic(path.join(dirs.inbox, `${hash}.json`), JSON.stringify(msg)); },
    async getInbox(hash) { await ready; return safe(hash) ? readJson(path.join(dirs.inbox, `${hash}.json`)) : null; },

    /* stats */
    async bumpStats(code, kind, at) {
      await ready;
      if (!safe(code)) return;
      const file = path.join(dirs.stats, `${code}.json`);
      const s = { ...EMPTY_STATS, ...(await readJson(file)) };
      if (kind === "open") { s.opens++; s.firstOpenAt ??= at; s.lastOpenAt = at; }
      else { s.views++; s.firstViewAt ??= at; s.lastViewAt = at; }
      await writeAtomic(file, JSON.stringify(s));
      return kind === "open" ? s.opens : s.views;   // the new count (1 = the very first)
    },
    async getStats(code) { await ready; return { ...EMPTY_STATS, ...(safe(code) ? await readJson(path.join(dirs.stats, `${code}.json`)) : null) }; },
    async getStatsMany(codes) { return Promise.all(codes.map(c => this.getStats(c))); },

    /* files */
    async saveFile(meta, buf) {
      await ready;
      await fs.writeFile(path.join(dirs.files, `${meta.id}.pdf`), buf);
      await writeAtomic(path.join(dirs.files, `${meta.id}.json`), JSON.stringify(meta));
    },
    async getFileMeta(id) { await ready; return safe(id) ? readJson(path.join(dirs.files, `${id}.json`)) : null; },
    async listFilesByOwner(owner) { await ready; return (await readAll(dirs.files)).filter(f => f.owner === owner); },
    async readFile(id) {
      const meta = await this.getFileMeta(id);
      if (!meta) return null;
      try { return { meta, body: await fs.readFile(path.join(dirs.files, `${id}.pdf`)) }; }
      catch { return null; }
    },
    async deleteFile(id) {
      await ready;
      if (!safe(id)) return;
      await fs.rm(path.join(dirs.files, `${id}.pdf`), { force: true });
      await fs.rm(path.join(dirs.files, `${id}.json`), { force: true });
    }
  };
}
