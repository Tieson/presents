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
  const items1 = [{ id: "abcd1", name: "Masáž", file: { id: fid } }];
  r = await A("PUT", "admin/gifts/" + code, { title: "T", anytime: true, appearance: { paper: "kraft", pattern: "gingerbread", patternColor: "red", patternOpacity: 140, ribbon: "copper", ribbonStyle: "none", bow: "rosette", deco: "holly", seal: "T" }, items: items1 });
  ok(r.d.appearance.paper === "kraft" && r.d.appearance.pattern === "gingerbread" && r.d.appearance.patternColor === "red" && r.d.appearance.patternOpacity === 90
    && r.d.appearance.ribbonStyle === "none" && r.d.appearance.bow === "rosette" && r.d.appearance.deco === "holly", "new papers, patterns, pattern colour + opacity (capped), bows, decorations");
  r = await A("PUT", "admin/gifts/" + code, { title: "T", anytime: true, appearance: { paper: "kraft", patternColor: "pink<", patternOpacity: "x", bow: "huge", deco: "<img>" }, items: items1 });
  ok(r.d.appearance.patternColor === null && r.d.appearance.patternOpacity === null && r.d.appearance.bow === "classic" && r.d.appearance.deco === "none", "invalid colour/opacity/bow/decoration → defaults");

  /* ---------- photo in the box ---------- */
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("JFIF fake image body")]);
  r = await A("POST", "admin/files", jpeg, { headers: { "X-File-Name": encodeURIComponent("Hory.jpg"), "X-Image-Width": "1200", "X-Image-Height": "800" } });
  ok(r.s === 201 && r.d.type === "image/jpeg" && r.d.w === 1200 && r.d.h === 800, "upload photo (type from the bytes, size from headers)");
  const img = r.d.id;
  r = await A("POST", "admin/files", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>")); ok(r.s === 415, "SVG / unknown files rejected");
  r = await A("PUT", "admin/gifts/" + code, { title: "T", anytime: true, items: [...items1, { id: "abcd3", name: "Fotka?", file: { id: img } }], photo: { file: { id: fid } } });
  ok(r.d.items[0].file?.id === fid && r.d.items[1].file === null && r.d.photo === null, "photo can't be a PDF, voucher can't be a photo");
  r = await A("PUT", "admin/gifts/" + code, { title: "T", anytime: true, items: items1, photo: { file: { id: img }, caption: "  Na   horách\n2025 ", frame: "postcard" } });
  ok(r.s === 200 && r.d.photo?.file?.id === img && r.d.photo.caption === "Na horách 2025" && r.d.photo.frame === "postcard", "attach photo with caption + frame");
  r = await A("GET", "workshop"); ok(r.d.workshop.usedBytes === pdf.length + jpeg.length, "photo counts towards the space");
  r = await B("PUT", "admin/gifts/" + codeB, { title: "B", items: [], photo: { file: { id: img } } }); ok(r.s === 200 && r.d.photo === null, "B can't use A's photo");
  r = await B("GET", "admin/files/" + img); ok(r.s === 404, "B can't read A's photo");
  r = await A("GET", "admin/files/" + img); ok(r.s === 200 && r.h.get("content-type") === "image/jpeg" && r.h.get("x-content-type-options") === "nosniff", "workshop preview of the photo");
  r = await A("PUT", "admin/gifts/" + code, { title: "T", anytime: true, items: items1 });
  ok(r.d.photo?.file?.id === img, "photo kept when not sent");
  r = await anon("GET", `gifts/${code}/photo`); ok(r.s === 401, "photo without token → 401");
  r = await anon("POST", `gifts/${code}/open`, { password: "vanoce" });
  const ptok = r.d.token;
  ok(r.s === 200 && r.d.gift.photo?.caption === "Na horách 2025" && r.d.gift.photo.frame === "postcard" && r.d.gift.photo.w === 1200 && !JSON.stringify(r.d.gift).includes(img), "opened box has the photo (no file id)");
  r = await anon("GET", `gifts/${code}/photo?t=${encodeURIComponent(ptok)}`);
  ok(r.s === 200 && r.h.get("content-type") === "image/jpeg" && Buffer.from(r.d).equals(jpeg), "photo with token");
  r = await A("PUT", "admin/gifts/" + code, { title: "T", anytime: false, openAt: "2030-12-24T17:00:00.000Z", items: items1 });
  r = await anon("GET", `gifts/${code}/photo?t=${encodeURIComponent(ptok)}`); ok(r.s === 423, "locked box → photo locked too");
  r = await A("PUT", "admin/gifts/" + code, { title: "T", anytime: true, items: items1, photo: null });
  ok(r.d.photo === null, "remove photo");
  r = await A("GET", "admin/files/" + img); ok(r.s === 404, "removed photo deleted");
  r = await A("GET", "workshop"); ok(r.d.workshop.usedBytes === pdf.length, "its space freed");

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

  /* ---------- occasions ---------- */
  r = await B("GET", "workshop"); ok(r.d.workshop.theme === "general", "new workshop starts neutral (Pro radost)");
  r = await B("POST", "admin/gifts", {}); ok(r.d.theme === "general", "new box without an occasion → Pro radost");
  await B("DELETE", "admin/gifts/" + r.d.code);
  r = await A("PUT", "workshop", { theme: "wedding" }); ok(r.s === 200 && r.d.workshop.theme === "wedding", "workshop remembers the chosen occasion");
  r = await A("PUT", "workshop", { theme: "halloween" }); ok(r.d.workshop.theme === "general", "unknown occasion → Pro radost (neutral)");
  r = await A("POST", "admin/gifts", { theme: "birthday", openAt: "2031-05-01T16:00:00.000Z" });
  const codeT = r.d.code;
  ok(r.s === 201 && r.d.theme === "birthday" && r.d.openAt === "2031-05-01T16:00:00.000Z" && r.d.locked === true, "box with an occasion and its own unlock time");
  r = await anon("GET", "gifts/" + codeT); ok(r.d.theme === "birthday", "recipient gets the occasion before opening");
  r = await A("PUT", "admin/gifts/" + codeT, { title: "Oslava", anytime: true, theme: "wedding", items: [] }); ok(r.d.theme === "wedding" && r.d.locked === false, "occasion can be changed");
  r = await A("PUT", "admin/gifts/" + codeT, { title: "Oslava", anytime: true, items: [] }); ok(r.d.theme === "wedding", "occasion kept when not sent");

  /* ---------- who looked (views + unwraps) ---------- */
  r = await A("GET", "admin/gifts/" + codeT); ok(r.d.stats?.views === 1 && r.d.stats.opens === 0, "first view counted (recipient), creator's own not");
  await anon("GET", "gifts/" + codeT); await A("GET", "gifts/" + codeT);
  r = await anon("POST", `gifts/${codeT}/open`, {}); ok(r.s === 200 && r.d.gift.theme === "wedding", "unwrap");
  await A("POST", `gifts/${codeT}/open`, { preview: true });
  r = await A("GET", "admin/gifts/" + codeT);
  ok(r.d.stats.views === 2 && r.d.stats.opens === 1 && r.d.stats.firstOpenAt && r.d.stats.firstViewAt <= r.d.stats.lastViewAt, "views + unwraps recorded, creator's preview not");
  r = await A("GET", "admin/gifts"); const rowT = r.d.gifts.find(g => g.code === codeT);
  ok(rowT?.stats?.opens === 1 && rowT.locked === false && rowT.theme === "wedding", "list shows unwraps, lock state and occasion");
  r = await A("DELETE", "admin/gifts/" + codeT); ok(r.s === 200, "delete box (its stats go too)");

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
