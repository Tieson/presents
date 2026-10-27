import fs from "node:fs/promises";
import path from "node:path";

/** Plain file storage: data/gifts/<code>.json, data/files/<id>.pdf + <id>.json */
export function fsStorage(dataDir) {
  const giftsDir = path.join(dataDir, "gifts");
  const filesDir = path.join(dataDir, "files");
  const ready = Promise.all([
    fs.mkdir(giftsDir, { recursive: true }),
    fs.mkdir(filesDir, { recursive: true })
  ]);
  const safe = s => /^[\w-]+$/.test(s);

  async function writeAtomic(file, data) {
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, file);
  }
  async function readJson(file) {
    try { return JSON.parse(await fs.readFile(file, "utf8")); }
    catch (e) { if (e.code === "ENOENT") return null; throw e; }
  }

  return {
    async listGifts() {
      await ready;
      const names = (await fs.readdir(giftsDir)).filter(n => n.endsWith(".json"));
      const out = [];
      for (const n of names) {
        const g = await readJson(path.join(giftsDir, n));
        if (g) out.push(g);
      }
      return out;
    },
    async getGift(code) {
      await ready;
      return safe(code) ? readJson(path.join(giftsDir, `${code}.json`)) : null;
    },
    async putGift(g) {
      await ready;
      await writeAtomic(path.join(giftsDir, `${g.code}.json`), JSON.stringify(g, null, 2));
    },
    async deleteGift(code) {
      await ready;
      if (safe(code)) await fs.rm(path.join(giftsDir, `${code}.json`), { force: true });
    },
    async saveFile(meta, buf) {
      await ready;
      await fs.writeFile(path.join(filesDir, `${meta.id}.pdf`), buf);
      await writeAtomic(path.join(filesDir, `${meta.id}.json`), JSON.stringify(meta));
    },
    async getFileMeta(id) {
      await ready;
      return safe(id) ? readJson(path.join(filesDir, `${id}.json`)) : null;
    },
    async readFile(id) {
      const meta = await this.getFileMeta(id);
      if (!meta) return null;
      try { return { meta, body: await fs.readFile(path.join(filesDir, `${id}.pdf`)) }; }
      catch { return null; }
    },
    async deleteFile(id) {
      await ready;
      if (!safe(id)) return;
      await fs.rm(path.join(filesDir, `${id}.pdf`), { force: true });
      await fs.rm(path.join(filesDir, `${id}.json`), { force: true });
    }
  };
}
