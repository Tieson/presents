/**
 * Serverless storage for Vercel:
 *  - data in Upstash Redis (REST API; Vercel Marketplace → Upstash / "KV").
 *    Keys start with `keyPrefix` (REDIS_KEY_PREFIX, default "xd:"), so the database can be shared.
 *      xd:workshops  hash  id → workshop JSON
 *      xd:keys       hash  sha256(secret key) → workshop id
 *      xd:gifts      hash  code → box JSON          xd:own:<id>   set of the workshop's box codes
 *      xd:files      hash  id → PDF meta JSON       xd:ownf:<id>  set of the workshop's file ids
 *  - PDF files in a *private* Vercel Blob store; files are always streamed
 *    through the API after the password + unlock check, the blob URL never
 *    reaches the browser. (BLOB_ACCESS=public works for a public store too.)
 */
export function vercelStorage({ redisUrl, redisToken, blobToken, blobAccess = "private", keyPrefix = "xd:", blobImpl = null }) {
  if (!redisUrl || !redisToken) throw new Error("Missing Upstash Redis env (UPSTASH_REDIS_REST_URL / _TOKEN or KV_REST_API_URL / _TOKEN)");

  async function redis(...cmd) {
    const r = await fetch(redisUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${redisToken}`, "content-type": "application/json" },
      body: JSON.stringify(cmd)
    });
    const data = await r.json();
    if (data.error) throw new Error(`Redis: ${data.error}`);
    return data.result;
  }
  const parse = v => (v ? JSON.parse(v) : null);
  const K = name => keyPrefix + name;     // every Redis key goes through here (shared databases)

  let blobMod;
  const blob = async () => blobImpl || (blobMod ??= await import("@vercel/blob"));   // blobImpl: tests only

  return {
    /* workshops */
    async getWorkshop(id) { return parse(await redis("HGET", K("workshops"), id)); },
    async putWorkshop(w) { await redis("HSET", K("workshops"), w.id, JSON.stringify(w)); },
    async deleteWorkshop(id) {
      await redis("HDEL", K("workshops"), id);
      await redis("DEL", K(`own:${id}`), K(`ownf:${id}`));
    },
    async getKeyOwner(hash) { return (await redis("HGET", K("keys"), hash)) || null; },
    async setKeyOwner(hash, id) { await redis("HSET", K("keys"), hash, id); },
    async deleteKeyOwner(hash) { await redis("HDEL", K("keys"), hash); },

    /* gifts */
    async listGiftsByOwner(owner) {
      const codes = (await redis("SMEMBERS", K(`own:${owner}`))) || [];
      if (!codes.length) return [];
      const vals = await redis("HMGET", K("gifts"), ...codes);
      return vals.map(parse).filter(g => g && g.owner === owner);
    },
    async countGiftsByOwner(owner) { return Number(await redis("SCARD", K(`own:${owner}`))) || 0; },
    async getGift(code) { return parse(await redis("HGET", K("gifts"), code)); },
    async putGift(g) {
      await redis("HSET", K("gifts"), g.code, JSON.stringify(g));
      if (g.owner) await redis("SADD", K(`own:${g.owner}`), g.code);
    },
    async deleteGift(code) {
      const g = await this.getGift(code);
      await redis("HDEL", K("gifts"), code);
      if (g?.owner) await redis("SREM", K(`own:${g.owner}`), code);
    },

    /* files */
    async saveFile(meta, buf) {
      const { put } = await blob();
      const res = await put(`vouchers/${meta.id}.pdf`, buf, {
        access: blobAccess,
        addRandomSuffix: true,
        contentType: "application/pdf",
        token: blobToken
      });
      await redis("HSET", K("files"), meta.id, JSON.stringify({ ...meta, url: res.url, access: blobAccess }));
      if (meta.owner) await redis("SADD", K(`ownf:${meta.owner}`), meta.id);
    },
    async getFileMeta(id) { return parse(await redis("HGET", K("files"), id)); },
    async listFilesByOwner(owner) {
      const ids = (await redis("SMEMBERS", K(`ownf:${owner}`))) || [];
      if (!ids.length) return [];
      return (await redis("HMGET", K("files"), ...ids)).map(parse).filter(Boolean);
    },
    async readFile(id) {
      const meta = await this.getFileMeta(id);
      if (!meta?.url) return null;
      const { get } = await blob();
      const r = await get(meta.url, { access: meta.access || blobAccess, token: blobToken });
      if (!r || r.statusCode !== 200) return null;
      return { meta, body: r.stream };
    },
    async deleteFile(id) {
      const meta = await this.getFileMeta(id);
      if (meta?.url) {
        const { del } = await blob();
        try { await del(meta.url, { token: blobToken }); } catch { /* already gone */ }
      }
      await redis("HDEL", K("files"), id);
      if (meta?.owner) await redis("SREM", K(`ownf:${meta.owner}`), id);
    }
  };
}
