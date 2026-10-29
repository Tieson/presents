// API end-to-end tests shared by the Node and PHP backends.
// Every "client" has its own cookie jar, like a separate browser.

const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF");

export async function run(base) {
  let passed = 0, failed = 0;
  const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); c ? passed++ : failed++; };

  function client() {
    let cookie = "";
    return async function call(method, path, body, { headers = {}, csrf = true } = {}) {
      const h = { ...(cookie ? { cookie } : {}), ...(csrf ? { "X-Admin": "1" } : {}), ...headers };
      let b;
      if (body instanceof Buffer) { b = body; h["content-type"] = "application/octet-stream"; }
      else if (body !== undefined) { b = JSON.stringify(body); h["content-type"] = "application/json"; }
      const r = await fetch(base + "/api/" + path, { method, headers: h, body: b });
      const sc = r.headers.get("set-cookie");
      if (sc) { const v = sc.split(";")[0]; cookie = /=$/.test(v) ? "" : v; }
      const ct = r.headers.get("content-type") || "";
      const d = ct.includes("json") ? await r.json() : await r.arrayBuffer();
      return { s: r.status, d, h: r.headers };
    };
  }
  const anon = client();

  /* ---------- workshops ---------- */
  const A = client(), B = client();
  let r = await A("POST", "workshop", { name: "Tomova dílna", email: "tom@example.com" });
  ok(r.s === 201 && /^[A-Za-z0-9_-]{32}$/.test(r.d.workshop?.key) && r.d.workshop.name === "Tomova dílna", "create workshop → secret key");
  const keyA = r.d.workshop.key;
  r = await A("GET", "workshop"); ok(r.s === 200 && r.d.workshop.key === keyA && r.d.workshop.email === "tom@example.com", "signed in after create, key shown again");
  r = await B("POST", "workshop", {}); ok(r.s === 201 && r.d.workshop.name === "Moje dílna", "second workshop with defaults");
  r = await anon("POST", "workshop", { email: "nope" }); ok(r.s === 400, "bad email rejected");
  r = await anon("POST", "workshop", {}, { csrf: false }); ok(r.s === 403, "CSRF header required");
  r = await anon("GET", "workshop"); ok(r.s === 401, "no session → 401");
  r = await anon("GET", "admin/gifts"); ok(r.s === 401, "admin without session → 401");

  const A2 = client();
  r = await A2("POST", "workshop/login", { key: keyA.slice(0, 31) + (keyA[31] === "A" ? "B" : "A") }); ok(r.s === 401, "wrong key → 401");
  r = await A2("POST", "workshop/login", { key: keyA }); ok(r.s === 200 && r.d.workshop.name === "Tomova dílna", "sign in with key from the link (2nd device)");
  r = await A2("PUT", "workshop", { name: "  Dílna  u  Toma ", email: "" }); ok(r.s === 200 && r.d.workshop.name === "Dílna u Toma" && r.d.workshop.email === "", "rename + clear e-mail");

  /* ---------- boxes ---------- */
  r = await A("POST", "admin/files", pdf, { headers: { "X-File-Name": encodeURIComponent("Poukaz masáž.pdf") } }); ok(r.s === 201, "upload pdf");
  const fid = r.d.id;
  r = await A("POST", "admin/files", Buffer.from("hello")); ok(r.s === 415, "reject non-pdf");
  r = await A("GET", "workshop"); ok(r.d.workshop.usedBytes === pdf.length, "used space counted");
  r = await A("POST", "admin/gifts", { title: "Dárek pro sestřičku" }); ok(r.s === 201 && /^[a-z]{6}-[a-z]{6}$/.test(r.d.code), "create box " + r.d.code);
  const code = r.d.code;
  r = await A("PUT", "admin/gifts/" + code, { title: "Dárek pro sestřičku", showTitle: true, message: "Ahoj", signature: "Tom", anytime: false, openAt: "2030-12-24T17:00:00.000Z", manualUnlock: false, password: "vanoce", items: [{ id: "abcd1", name: "Masáž", description: "60 min", file: { id: fid } }, { id: "abcd2", name: "Večeře", description: "", file: null }] });
  ok(r.s === 200 && r.d.hasPassword && r.d.locked && r.d.items[0].file?.name === "Poukaz masáž.pdf", "save with password, locked");

  /* ---------- isolation between workshops ---------- */
  r = await B("GET", "admin/gifts"); ok(r.s === 200 && r.d.gifts.length === 0, "B sees none of A's boxes");
  r = await B("GET", "admin/gifts/" + code); ok(r.s === 404, "B can't read A's box");
  r = await B("PUT", "admin/gifts/" + code, { title: "hack", items: [] }); ok(r.s === 404, "B can't edit A's box");
  r = await B("DELETE", "admin/gifts/" + code); ok(r.s === 404, "B can't delete A's box");
  r = await B("GET", "admin/files/" + fid); ok(r.s === 404, "B can't read A's PDF");
  r = await B("POST", "admin/gifts", {}); const codeB = r.d.code;
  r = await B("PUT", "admin/gifts/" + codeB, { title: "B", anytime: true, items: [{ id: "steal1", name: "x", file: { id: fid } }] });
  ok(r.s === 200 && r.d.items[0].file === null, "B can't attach A's PDF to own box");
  r = await B("POST", `gifts/${code}/open`, { preview: true }); ok(r.s === 401, "B can't preview A's box");

  /* ---------- recipients (public) ---------- */
  r = await anon("GET", "gifts/" + code.toUpperCase().replace("-", " ")); ok(r.s === 200 && r.d.locked && r.d.hasPassword && r.d.title === "Dárek pro sestřičku", "public meta (code normalized)");
  r = await anon("POST", `gifts/${code}/open`, { password: "spatne" }, { csrf: false }); ok(r.s === 401, "wrong password 401");
  r = await anon("POST", `gifts/${code}/open`, { password: "Vánoce".normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase() }, { csrf: false }); ok(r.s === 423 && r.d.openAt, "right password but locked 423");
  r = await A("POST", `gifts/${code}/open`, { preview: true }); ok(r.s === 200 && r.d.preview, "owner preview bypasses lock");
  r = await A("PUT", "admin/gifts/" + code, { title: "Dárek pro sestřičku", showTitle: false, anytime: false, openAt: "2030-12-24T17:00:00.000Z", manualUnlock: true, items: [{ id: "abcd2", name: "Večeře", description: "", file: null }, { id: "abcd1", name: "Masáž", description: "60 min", file: { id: fid } }] });
  ok(r.s === 200 && !r.d.locked && r.d.hasPassword && r.d.items[0].id === "abcd2", "manual unlock + reorder, password kept");
  r = await anon("POST", `gifts/${code}/open`, { password: "vanoce" }); ok(r.s === 200 && r.d.gift.title === null && r.d.gift.items.length === 2, "open ok, hidden title, items visible");
  const token = r.d.token;
  r = await anon("POST", `gifts/${code}/open`, { token }); ok(r.s === 200, "reopen with token");
  r = await anon("GET", `gifts/${code}/items/abcd1/file?t=${encodeURIComponent(token)}&dl=1`); ok(r.s === 200 && Buffer.from(r.d).subarray(0, 5).toString() === "%PDF-", "download pdf");
  r = await anon("GET", `gifts/${code}/items/abcd1/file?t=bad.token`); ok(r.s === 401, "pdf with bad token 401");

  /* ---------- appearance & reveal ---------- */
  r = await A("PUT", "admin/gifts/" + code, { title: "T", anytime: true, appearance: { paper: "midnight", pattern: "snow", ribbon: "silver", ribbonStyle: "single", seal: "ABC" }, reveal: "sequential", items: [{ id: "abcd2", name: "Večeře" }, { id: "abcd1", name: "Masáž", file: { id: fid } }] });
  ok(r.d.appearance?.paper === "midnight" && r.d.appearance.seal === "AB" && r.d.reveal === "sequential", "save appearance (seal trimmed to 2)");
  r = await A("PUT", "admin/gifts/" + code, { title: "T", anytime: true, appearance: { paper: "<script>", pattern: "x", ribbon: 5, ribbonStyle: "zz", seal: "" }, reveal: "bogus", items: [{ id: "abcd1", name: "Masáž", file: { id: fid } }] });
  ok(r.d.appearance.paper === "burgundy" && r.d.appearance.pattern === "stripes" && r.d.appearance.seal === "" && r.d.reveal === "sequential", "invalid values rejected, reveal kept");
  r = await anon("GET", "gifts/" + code); ok(r.d.appearance?.paper === "burgundy", "public meta has appearance");

  /* ---------- code, files, password removal ---------- */
  r = await A("PUT", "admin/gifts/" + code, { title: "X", anytime: true, password: null, items: [{ id: "abcd2", name: "Večeře" }] });
  ok(r.s === 200 && !r.d.hasPassword, "remove password, drop pdf item");
  r = await A("GET", "admin/files/" + fid); ok(r.s === 404, "orphaned pdf deleted");
  r = await A("GET", "workshop"); ok(r.d.workshop.usedBytes === 0, "used space freed");
  r = await anon("POST", `gifts/${code}/open`, {}); ok(r.s === 200, "open without password");
  r = await A("POST", `admin/gifts/${code}/regenerate-code`); ok(r.s === 200 && r.d.code !== code, "regenerate code");
  const code2 = r.d.code;
  r = await anon("GET", "gifts/" + code); ok(r.s === 404, "old code 404");
  r = await A("GET", "admin/gifts"); ok(r.d.gifts.length === 1 && r.d.gifts[0].code === code2 && r.d.gifts[0].appearance, "list has only the renamed box");

  /* ---------- rotate the secret link ---------- */
  r = await A("POST", "workshop/rotate-key"); const keyA2 = r.d.workshop?.key;
  ok(r.s === 200 && keyA2 && keyA2 !== keyA, "rotate key → new link");
  r = await A("GET", "workshop"); ok(r.s === 200 && r.d.workshop.key === keyA2, "this device stays signed in");
  r = await A2("GET", "workshop"); ok(r.s === 401, "other device signed out after rotation");
  r = await client()("POST", "workshop/login", { key: keyA }); ok(r.s === 401, "old link no longer works");
  r = await client()("POST", "workshop/login", { key: keyA2 }); ok(r.s === 200, "new link works");

  /* ---------- delete workshop ---------- */
  r = await A("DELETE", "workshop"); ok(r.s === 200, "delete workshop");
  r = await A("GET", "workshop"); ok(r.s === 401, "signed out after delete");
  r = await anon("GET", "gifts/" + code2); ok(r.s === 404, "its boxes are gone");
  r = await client()("POST", "workshop/login", { key: keyA2 }); ok(r.s === 401, "its link is gone");
  r = await B("GET", "admin/gifts/" + codeB); ok(r.s === 200, "other workshop untouched");
  await B("DELETE", "workshop");

  return { passed, failed };
}
