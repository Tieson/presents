/**
 * Serverless storage for Vercel:
 *  - box data in Upstash Redis (REST API; Vercel Marketplace → Upstash / "KV")
 *  - PDF files in a *private* Vercel Blob store; files are always streamed
 *    through the API after the password + unlock check, the blob URL never
 *    reaches the browser. (BLOB_ACCESS=public works for a public store too.)
 */
export function vercelStorage({ redisUrl, redisToken, blobToken, blobAccess = "private" }) {
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

  let blobMod;
  const blob = async () => (blobMod ??= await import("@vercel/blob"));

  return {
    async listGifts() {
      const flat = (await redis("HGETALL", "xd:gifts")) || [];
      const out = [];
      for (let i = 1; i < flat.length; i += 2) out.push(JSON.parse(flat[i]));
      return out;
    },
    async getGift(code) {
      const v = await redis("HGET", "xd:gifts", code);
      return v ? JSON.parse(v) : null;
    },
    async putGift(g) {
      await redis("HSET", "xd:gifts", g.code, JSON.stringify(g));
    },
    async deleteGift(code) {
      await redis("HDEL", "xd:gifts", code);
    },
    async saveFile(meta, buf) {
      const { put } = await blob();
      const res = await put(`vouchers/${meta.id}.pdf`, buf, {
        access: blobAccess,
        addRandomSuffix: true,
        contentType: "application/pdf",
        token: blobToken
      });
      await redis("HSET", "xd:files", meta.id, JSON.stringify({ ...meta, url: res.url, access: blobAccess }));
    },
    async getFileMeta(id) {
      const v = await redis("HGET", "xd:files", id);
      return v ? JSON.parse(v) : null;
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
      await redis("HDEL", "xd:files", id);
    }
  };
}
