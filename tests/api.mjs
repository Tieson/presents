// API end-to-end tests shared by Node and PHP backends.
export async function run(base, adminPassword) {
let cookie = "";
let passed = 0, failed = 0;
const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF");
async function call(method, path, body, extra = {}) {
  const h = { "X-Admin": "1", cookie, ...extra.headers };
  let b;
  if (body instanceof Buffer) { b = body; h["content-type"] = "application/octet-stream"; }
  else if (body !== undefined) { b = JSON.stringify(body); h["content-type"] = "application/json"; }
  const r = await fetch(base + "/api/" + path, { method, headers: extra.noauth ? { "content-type": "application/json" } : h, body: b });
  const sc = r.headers.get("set-cookie"); if (sc && !extra.noauth) cookie = sc.split(";")[0];
  const ct = r.headers.get("content-type") || "";
  const data = ct.includes("json") ? await r.json() : await r.arrayBuffer();
  return { s: r.status, d: data, h: r.headers };
}
const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); c ? passed++ : failed++; };
let r = await call("POST", "admin/login", { password: "spatne" }); ok(r.s === 401, "bad admin login 401");
r = await call("POST", "admin/login", { password: adminPassword }); ok(r.s === 200 && cookie, "admin login");
r = await call("POST", "admin/gifts", { title: "Dárek pro sestřičku" }); ok(r.s === 201 && /^[a-z]{6}-[a-z]{6}$/.test(r.d.code), "create " + r.d.code + " openAt " + r.d.openAt);
const code = r.d.code;
r = await call("POST", "admin/files", pdf, { headers: { "X-File-Name": encodeURIComponent("Poukaz masáž.pdf") } }); ok(r.s === 201, "upload pdf"); const fid = r.d.id;
r = await call("POST", "admin/files", Buffer.from("hello"), {}); ok(r.s === 415, "reject non-pdf");
r = await call("PUT", "admin/gifts/" + code, { title: "Dárek pro sestřičku", showTitle: true, message: "Ahoj", signature: "Tom", anytime: false, openAt: "2026-12-24T17:00:00.000Z", manualUnlock: false, password: "vanoce", items: [{ id: "abcd1", name: "Masáž", description: "60 min", file: { id: fid } }, { id: "abcd2", name: "Večeře", description: "", file: null }] });
ok(r.s === 200 && r.d.hasPassword && r.d.locked && r.d.items[0].file.name === "Poukaz masáž.pdf", "save with password, locked");
r = await call("GET", "gifts/" + code.toUpperCase().replace("-", " "), undefined, { noauth: true }); ok(r.s === 200 && r.d.locked && r.d.hasPassword && r.d.title === "Dárek pro sestřičku", "public meta (code normalized)");
r = await call("POST", `gifts/${code}/open`, { password: "spatne" }, { noauth: true }); ok(r.s === 401, "wrong password 401");
r = await call("POST", `gifts/${code}/open`, { password: "vanoce" }, { noauth: true }); ok(r.s === 423 && r.d.openAt, "right password but locked 423");
r = await call("POST", `gifts/${code}/open`, { preview: true }, { noauth: true }); ok(r.s === 401, "preview without admin cookie denied");
r = await call("POST", `gifts/${code}/open`, { preview: true }); ok(r.s === 200 && r.d.preview, "admin preview bypasses lock");
r = await call("PUT", "admin/gifts/" + code, { title: "Dárek pro sestřičku", showTitle: false, message: "Ahoj", signature: "Tom", anytime: false, openAt: "2026-12-24T17:00:00.000Z", manualUnlock: true, items: [{ id: "abcd2", name: "Večeře", description: "", file: null }, { id: "abcd1", name: "Masáž", description: "60 min", file: { id: fid } }] });
ok(r.s === 200 && !r.d.locked && r.d.hasPassword && r.d.items[0].id === "abcd2", "manual unlock + reorder, password kept");
r = await call("POST", `gifts/${code}/open`, { password: "vanoce" }, { noauth: true }); ok(r.s === 200 && r.d.gift.title === null && r.d.gift.items.length === 2, "open ok, hidden title, items visible");
const token = r.d.token;
r = await call("POST", `gifts/${code}/open`, { token }, { noauth: true }); ok(r.s === 200, "reopen with token");
r = await call("GET", `gifts/${code}/items/abcd1/file?t=${encodeURIComponent(token)}&dl=1`, undefined, { noauth: true }); ok(r.s === 200 && Buffer.from(r.d).subarray(0, 5).toString() === "%PDF-", "download pdf; " + r.h.get("content-disposition"));
r = await call("GET", `gifts/${code}/items/abcd1/file?t=bad.token`, undefined, { noauth: true }); ok(r.s === 401, "pdf with bad token 401");
r = await call("PUT", "admin/gifts/" + code, { title: "X", showTitle: true, anytime: true, manualUnlock: false, openAt: "2026-12-24T17:00:00.000Z", password: null, items: [{ id: "abcd2", name: "Večeře", description: "", file: null }] });
ok(r.s === 200 && !r.d.hasPassword && !r.d.locked, "remove password, anytime, drop pdf item");
r = await call("POST", `gifts/${code}/open`, {}, { noauth: true }); ok(r.s === 200, "open without password");
r = await call("GET", `admin/files/${fid}`); ok(r.s === 404, "orphaned pdf deleted");
r = await call("GET", `gifts/${code}/items/abcd1/file?t=${encodeURIComponent(token)}`, undefined, { noauth: true }); ok(r.s === 401 || r.s === 404, "old token invalid after password change");
r = await call("POST", `admin/gifts/${code}/regenerate-code`); ok(r.s === 200 && r.d.code !== code, "regenerate code " + r.d.code);
const code2 = r.d.code;
r = await call("GET", "gifts/" + code, undefined, { noauth: true }); ok(r.s === 404, "old code 404");
r = await call("GET", "admin/gifts"); ok(r.s === 200 && r.d.gifts.some(g => g.code === code2), "list");
r = await call("PUT", "admin/gifts/" + code2, { title: "Y", anytime: true, items: [] }, { headers: { "X-Admin": "" } }); ok(r.s === 403, "CSRF header required");
r = await call("DELETE", "admin/gifts/" + code2); ok(r.s === 200, "delete");
r = await call("GET", "gifts/" + code2, undefined, { noauth: true }); ok(r.s === 404, "deleted 404");

// --- appearance & reveal ---
r = await call("POST", "admin/gifts", {}); const code3 = r.d.code;
ok(r.d.appearance?.paper === "burgundy" && r.d.reveal === "all", "defaults on create");
r = await call("PUT", "admin/gifts/" + code3, { title: "T", anytime: true, appearance: { paper: "midnight", pattern: "snow", ribbon: "silver", ribbonStyle: "single", seal: "ABC" }, reveal: "sequential", items: [] });
ok(r.d.appearance.paper === "midnight" && r.d.appearance.seal === "AB" && r.d.reveal === "sequential", "save appearance (seal trimmed to 2)");
r = await call("PUT", "admin/gifts/" + code3, { title: "T", anytime: true, appearance: { paper: "<script>", pattern: "x", ribbon: 5, ribbonStyle: "zz", seal: "" }, reveal: "bogus", items: [] });
ok(r.d.appearance.paper === "burgundy" && r.d.appearance.pattern === "stripes" && r.d.appearance.seal === "" && r.d.reveal === "sequential", "invalid values rejected, reveal kept");
r = await call("PUT", "admin/gifts/" + code3, { title: "T", anytime: true, items: [] });
ok(r.d.appearance.seal === "" , "appearance kept when omitted");
r = await call("GET", "gifts/" + code3, undefined, { noauth: true }); ok(r.d.appearance?.paper === "burgundy", "public meta has appearance");
r = await call("POST", `gifts/${code3}/open`, {}, { noauth: true }); ok(r.d.gift.reveal === "sequential" && r.d.gift.appearance, "open returns reveal + appearance");
r = await call("GET", "admin/gifts"); ok(r.d.gifts[0].appearance && r.d.gifts[0].reveal, "list summary has appearance");
await call("DELETE", "admin/gifts/" + code3);

return { passed, failed };
}
