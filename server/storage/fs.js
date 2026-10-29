import fs from "node:fs/promises";
import path from "node:path";

/**
 * Plain file storage:
 *   data/workshops/<id>.json     workshop (account)
 *   data/keys/<sha256>.json      { id } – finds a workshop by the hash of its secret key
 *   data/gifts/<code>.json       box (has `owner` = workshop id)
 *   data/files/<id>.pdf + .json  uploaded PDF + meta (has `owner`)
 */
export function fsStorage(dataDir) {
  const dirs = {
    gifts: path.join(dataDir, "gifts"),
    files: path.join(dataDir, "files"),
    workshops: path.join(dataDir, "workshops"),
    keys: path.join(dataDir, "keys")
  };
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

    /* gifts */
    async listGiftsByOwner(owner) { await ready; return (await readAll(dirs.gifts)).filter(g => g.owner === owner); },
    async countGiftsByOwner(owner) { return (await this.listGiftsByOwner(owner)).length; },
    async getGift(code) { await ready; return safe(code) ? readJson(path.join(dirs.gifts, `${code}.json`)) : null; },
    async putGift(g) { await ready; await writeAtomic(path.join(dirs.gifts, `${g.code}.json`), JSON.stringify(g, null, 2)); },
    async deleteGift(code) { await ready; if (safe(code)) await fs.rm(path.join(dirs.gifts, `${code}.json`), { force: true }); },

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
