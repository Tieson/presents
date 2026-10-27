import "./common.js";
import "./wrap.js";
import "./fx.js";

/* Ježíškova dílna – admin */
(function () {
  const { api: rawApi, normalizePassword, formatShort, formatWithYear, relative, plural, formatSize, esc, copy, appBase } = window.XD;
  const W = window.XDwrap;
  const $ = id => document.getElementById(id);
  const styleVars = a => Object.entries(W.vars(a)).map(([k, v]) => `${k}:${v}`).join(";");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- state ---------- */
  let list = [];
  let offset = 0;                 // server clock − browser clock
  let cur = null;                 // gift as last loaded/saved from server
  let draft = null;               // editable copy
  let pw = { on: false, editing: false, value: "" };
  let mode = "christmas";         // christmas | custom | anytime (UI choice)
  let snapshot = "";
  let saving = false;
  const uploads = {};             // itemId → { progress, error }
  const fresh = {};               // code → password set in this session (plain, memory only)

  const now = () => Date.now() + offset;

  /* ---------- api with auth handling ---------- */
  async function api(path, opts = {}) {
    try {
      return await rawApi(path, { ...opts, admin: true });
    } catch (err) {
      if (err.status === 401 && !path.startsWith("admin/login")) {
        showLogin("Přihlášení vypršelo. Přihlas se prosím znovu.");
      }
      throw err;
    }
  }

  /* ---------- toast & dialog ---------- */
  let toastTimer;
  function toast(text, isError = false) {
    const t = $("toast");
    t.textContent = text;
    t.classList.toggle("error", isError);
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), isError ? 5000 : 2600);
  }

  function confirmDialog({ title, text, ok = "Potvrdit", cancel = "Zpět" }) {
    const dlg = $("dlg");
    $("dlgTitle").textContent = title;
    $("dlgText").textContent = text || "";
    $("dlgOk").textContent = ok;
    $("dlgCancel").textContent = cancel;
    return new Promise(resolve => {
      const done = () => { dlg.removeEventListener("close", done); resolve(dlg.returnValue === "ok"); };
      dlg.addEventListener("close", done);
      dlg.returnValue = "cancel";
      if (typeof dlg.showModal === "function") dlg.showModal();
      else resolve(true);
      setTimeout(() => $("dlgCancel").focus(), 30);
    });
  }

  /* ---------- login ---------- */
  function showLogin(message = "") {
    $("app").hidden = true;
    $("login").hidden = false;
    $("loginMsg").textContent = message;
    setTimeout(() => $("loginPw").focus(), 50);
  }

  $("loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = $("loginBtn");
    btn.disabled = true;
    $("loginMsg").textContent = "";
    try {
      await rawApi("admin/login", { method: "POST", body: { password: $("loginPw").value } });
      $("loginPw").value = "";
      showApp();
    } catch (err) {
      $("loginMsg").textContent = err.message;
      $("loginPw").select();
    } finally {
      btn.disabled = false;
    }
  });

  $("logout").addEventListener("click", async () => {
    if (isDirty() && !(await confirmDialog({ title: "Odhlásit bez uložení?", text: "Neuložené změny v boxu se ztratí.", ok: "Odhlásit" }))) return;
    try { await rawApi("admin/logout", { method: "POST", admin: true }); } catch { /* ignore */ }
    cur = draft = null; snapshot = "";
    showLogin("Odhlášeno. Hezké svátky!");
  });

  /* ---------- app ---------- */
  async function showApp() {
    $("login").hidden = true;
    $("app").hidden = false;
    await loadList();
    const fromHash = decodeURIComponent(location.hash.slice(1));
    if (fromHash && list.some(g => g.code === fromHash)) select(fromHash, true);
    else showEmptyEditor();
  }

  async function loadList() {
    try {
      const res = await api("admin/gifts");
      list = res.gifts;
      offset = Date.parse(res.serverNow) - Date.now();
      renderList();
    } catch (err) {
      if (err.status !== 401) toast(err.message, true);
    }
  }

  function statusOf(g) {
    if (g.manualUnlock) return { ok: true, text: "Odemčeno ručně" };
    if (g.anytime) return { ok: true, text: "Lze rozbalit kdykoli" };
    const t = Date.parse(g.openAt);
    if (now() >= t) return { ok: true, text: `Odemčeno od ${formatShort(g.openAt)}` };
    return { ok: false, text: `Zamčeno do ${formatShort(g.openAt)}` };
  }

  function renderList() {
    const ul = $("giftList");
    $("shelfCount").textContent = list.length ? `${list.length} ${plural(list.length, "box", "boxy", "boxů")}` : "";
    $("shelfEmpty").hidden = list.length > 0;
    ul.innerHTML = list.map(g => {
      const st = statusOf(g);
      return `<li>
        <button type="button" class="gl-item${cur && g.code === cur.code ? " active" : ""}${st.ok ? " open" : ""}" data-code="${esc(g.code)}">
          <span class="gl-box${W.normalize(g.appearance).ribbonStyle === "single" ? " rb-single" : ""}" style="--w:46px;${esc(styleVars(g.appearance))}" aria-hidden="true"></span>
          <span class="gl-title">${esc(g.title)}</span>
          <span class="gl-sub"><span class="mono">${esc(g.code)}</span><span>${g.itemCount} ${plural(g.itemCount, "položka", "položky", "položek")}</span></span>
          <span class="gl-flags">
            <span class="flag ${st.ok ? "ok" : "wait"}">${esc(st.text)}</span>
            <span class="flag">${g.hasPassword ? "s heslem" : "bez hesla"}</span>
            ${g.showTitle ? "" : `<span class="flag">název skrytý</span>`}
          </span>
        </button>
      </li>`;
    }).join("");
  }

  $("giftList").addEventListener("click", e => {
    const b = e.target.closest(".gl-item");
    if (b) select(b.dataset.code);
  });

  function showEmptyEditor() {
    $("editor").hidden = true;
    $("emptyEditor").hidden = false;
    $("savebar").hidden = true;
    $("layout").classList.remove("show-editor");
  }

  async function select(code, skipCheck = false) {
    if (!skipCheck && cur && code === cur.code) { $("layout").classList.add("show-editor"); return; }
    if (!skipCheck && isDirty() && !(await confirmDialog({ title: "Zahodit neuložené změny?", text: `V boxu „${draft.title}“ máš neuložené změny.`, ok: "Zahodit" }))) return;
    try {
      const g = await api(`admin/gifts/${encodeURIComponent(code)}`);
      setCurrent(g);
      $("layout").classList.add("show-editor");
      if (matchMedia("(max-width: 900px)").matches) scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    } catch (err) {
      if (err.status !== 401) toast(err.message, true);
    }
  }

  $("backToList").addEventListener("click", () => {
    $("layout").classList.remove("show-editor");
    scrollTo({ top: 0 });
  });

  /* ---------- editor ---------- */
  function clone(g) {
    return {
      title: g.title, showTitle: !!g.showTitle, message: g.message || "", signature: g.signature || "",
      anytime: !!g.anytime, openAt: g.openAt, manualUnlock: !!g.manualUnlock,
      appearance: W.normalize(g.appearance), reveal: W.REVEALS[g.reveal] ? g.reveal : "all",
      items: g.items.map(i => ({ id: i.id, name: i.name, description: i.description, file: i.file ? { ...i.file } : null }))
    };
  }

  function serialize() {
    if (!draft) return "";
    return JSON.stringify({
      ...draft,
      items: draft.items.map(i => [i.id, i.name, i.description, i.file?.id || null]),
      pw: pw.on ? (pw.value ? `new:${pw.value}` : cur.hasPassword ? "keep" : "missing") : "none"
    });
  }
  const isDirty = () => !!draft && serialize() !== snapshot;

  function setCurrent(g) {
    cur = g;
    draft = clone(g);
    pw = { on: g.hasPassword, editing: !g.hasPassword, value: "" };
    for (const k in uploads) delete uploads[k];
    fillForm();
    renderItems();
    snapshot = serialize();
    updateDirty();
    renderList();
    $("emptyEditor").hidden = true;
    $("editor").hidden = false;
    $("savebar").hidden = false;
    history.replaceState(null, "", `#${g.code}`);
  }

  function xmasIso() {
    const d = new Date(now());
    let y = d.getFullYear();
    if (d > new Date(y, 11, 26, 23, 59)) y++;
    return new Date(y, 11, 24, 18, 0).toISOString();
  }

  function detectMode() {
    if (draft.anytime) return "anytime";
    const d = new Date(draft.openAt);
    if (d.getMonth() === 11 && d.getDate() === 24 && d.getHours() === 18 && d.getMinutes() === 0) return "christmas";
    return "custom";
  }

  function toLocalInput(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    const p = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function fillForm() {
    $("fTitle").value = draft.title;
    $("fShowTitle").checked = draft.showTitle;
    $("fMessage").value = draft.message;
    $("fSignature").value = draft.signature;
    $("fManual").checked = draft.manualUnlock;
    $("fOpenAt").value = toLocalInput(draft.openAt);
    mode = detectMode();
    document.querySelectorAll('input[name="when"]').forEach(r => { r.checked = r.value === mode; });
    $("xmasLabel").textContent = `${formatWithYear(xmasIso())}`;
    document.querySelectorAll('input[name="reveal"]').forEach(r => { r.checked = r.value === draft.reveal; });
    $("fSeal").value = draft.appearance.seal;
    renderLook();
    $("fPwOn").checked = pw.on;
    $("fPw").value = "";
    $("fPw").classList.remove("invalid");
    renderAddress();
    renderPw();
    renderWhen();
    $("metaLine").textContent = `Založeno ${formatWithYear(cur.createdAt)} · upraveno ${formatWithYear(cur.updatedAt)}`;
  }

  function renderAddress() {
    const url = appBase() + cur.code;
    $("codeBig").textContent = cur.code;
    $("urlLine").textContent = url;
    $("previewLink").href = `${url}?preview=1`;
  }

  function renderPw() {
    $("pwArea").hidden = !pw.on;
    $("pwSet").hidden = !(cur.hasPassword && !pw.editing);
    $("pwEdit").hidden = !pw.editing;
    $("pwChange").textContent = "Změnit heslo";
    const f = fresh[cur.code];
    $("pwFresh").hidden = !(f && pw.on && cur.hasPassword && !pw.editing);
    if (f) $("pwFreshVal").textContent = f;
  }

  function renderWhen() {
    $("customWhen").hidden = mode !== "custom";
    const st = statusOf(draft);
    const pill = `<span class="pill ${st.ok ? "ok" : ""}">${esc(st.text)}</span>`;
    let extra = "";
    if (!st.ok) extra = `Otevře se za ${relative(Date.parse(draft.openAt) - now())}.`;
    else if (draft.manualUnlock) extra = "Příjemce může rozbalit hned.";
    $("whenStatus").innerHTML = `${pill}<span>${esc(extra)}</span>`;
    const head = $("statusPill");
    head.className = `pill ${st.ok ? "ok" : ""}`;
    head.textContent = st.text;
  }

  function updateDirty() {
    const dirty = isDirty();
    $("savebar").classList.toggle("dirty", dirty);
    $("saveState").textContent = saving ? "Ukládám…" : dirty ? "Neuložené změny" : "Vše uloženo";
    $("save").disabled = !dirty || saving;
    $("discard").disabled = !dirty || saving;
    if (draft) $("itemCount").textContent = draft.items.length ? `· ${draft.items.length}` : "";
  }

  /* field bindings */
  const bind = (id, key, prop = "value") => $(id).addEventListener("input", () => { draft[key] = $(id)[prop]; updateDirty(); });
  bind("fTitle", "title");
  bind("fMessage", "message");
  bind("fSignature", "signature");
  $("fShowTitle").addEventListener("change", () => { draft.showTitle = $("fShowTitle").checked; updateDirty(); });
  $("fManual").addEventListener("change", () => { draft.manualUnlock = $("fManual").checked; renderWhen(); updateDirty(); });

  document.querySelectorAll('input[name="when"]').forEach(r => r.addEventListener("change", () => {
    if (!r.checked) return;
    mode = r.value;
    if (r.value === "anytime") draft.anytime = true;
    else if (r.value === "christmas") { draft.anytime = false; draft.openAt = xmasIso(); $("fOpenAt").value = toLocalInput(draft.openAt); }
    else {
      draft.anytime = false;
      $("fOpenAt").value = toLocalInput(draft.openAt);
      $("customWhen").hidden = false;
      setTimeout(() => $("fOpenAt").focus(), 30);
    }
    renderWhen(); updateDirty();
  }));
  $("fOpenAt").addEventListener("input", () => {
    const d = new Date($("fOpenAt").value);
    if (!isNaN(d)) { draft.openAt = d.toISOString(); renderWhen(); updateDirty(); }
  });

  $("fPwOn").addEventListener("change", () => {
    pw.on = $("fPwOn").checked;
    if (pw.on && !cur.hasPassword) pw.editing = true;
    if (!pw.on) { pw.value = ""; $("fPw").value = ""; pw.editing = !cur.hasPassword; }
    renderPw(); updateDirty();
    if (pw.on && pw.editing) setTimeout(() => $("fPw").focus(), 30);
  });
  $("pwChange").addEventListener("click", () => {
    pw.editing = true; renderPw();
    setTimeout(() => $("fPw").focus(), 30);
  });
  $("fPw").addEventListener("input", () => {
    pw.value = $("fPw").value.trim();
    $("fPw").classList.remove("invalid");
    updateDirty();
  });
  $("copyPw").addEventListener("click", async () => { if (await copy(fresh[cur.code])) toast("Heslo zkopírováno"); });

  $("copyLink").addEventListener("click", async () => { if (await copy(appBase() + cur.code)) toast("Odkaz zkopírován"); });
  $("copyCode").addEventListener("click", async () => { if (await copy(cur.code)) toast("Kód zkopírován"); });

  $("regenCode").addEventListener("click", async () => {
    if (isDirty()) { toast("Nejdřív ulož změny, pak vygeneruj nový kód.", true); return; }
    if (!(await confirmDialog({ title: "Vygenerovat nový kód?", text: `Starý odkaz ${cur.code} přestane fungovat. Pokud už ho příjemce má, pošli mu nový.`, ok: "Vygenerovat" }))) return;
    try {
      const old = cur.code;
      const g = await api(`admin/gifts/${old}/regenerate-code`, { method: "POST" });
      if (fresh[old]) { fresh[g.code] = fresh[old]; delete fresh[old]; }
      setCurrent(g);
      await loadList();
      toast(`Nový kód: ${g.code}`);
    } catch (err) { if (err.status !== 401) toast(err.message, true); }
  });

  /* ---------- appearance ---------- */
  const lookGift = $("lookGift");
  lookGift.innerHTML = W.markup();

  function buildPicker(el, entries, cls, field, labelFor) {
    el.innerHTML = entries.map(([k, v]) =>
      `<button type="button" class="sw ${cls}" role="radio" data-k="${k}" aria-label="${esc(v.name)}" title="${esc(v.name)}">${cls === "tile" ? `<span>${esc(v.name)}</span>` : ""}</button>`
    ).join("");
    el.addEventListener("click", e => {
      const b = e.target.closest("[data-k]");
      if (!b || !draft) return;
      draft.appearance[field] = b.dataset.k;
      renderLook(); updateDirty();
    });
    el.addEventListener("keydown", e => {
      if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key) || !draft) return;
      e.preventDefault();
      const keys = entries.map(([k]) => k);
      const i = keys.indexOf(draft.appearance[field]);
      const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
      draft.appearance[field] = keys[(i + d + keys.length) % keys.length];
      renderLook(); updateDirty();
      el.querySelector(`[data-k="${draft.appearance[field]}"]`)?.focus();
    });
  }
  buildPicker($("paperPicker"), Object.entries(W.PAPERS), "paper", "paper");
  buildPicker($("patternPicker"), Object.entries(W.PATTERNS), "tile", "pattern");
  buildPicker($("ribbonPicker"), Object.entries(W.RIBBONS), "ribbon", "ribbon");
  $("stylePicker").innerHTML = Object.entries(W.RIBBON_STYLES).map(([k, name]) =>
    `<button type="button" role="radio" data-k="${k}">${k === "cross"
      ? `<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="1" y="1" width="12" height="12" rx="1.5" fill="none" stroke="currentColor"/><path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="2"/></svg>`
      : `<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="1" y="1" width="12" height="12" rx="1.5" fill="none" stroke="currentColor"/><path d="M7 1v12" stroke="currentColor" stroke-width="2"/></svg>`}${esc(name)}</button>`).join("");
  $("stylePicker").addEventListener("click", e => {
    const b = e.target.closest("[data-k]");
    if (!b || !draft) return;
    draft.appearance.ribbonStyle = b.dataset.k;
    renderLook(); updateDirty();
  });
  $("fSeal").addEventListener("input", () => {
    draft.appearance.seal = [...$("fSeal").value].slice(0, 2).join("");
    renderLook(); updateDirty();
  });

  function renderLook() {
    const a = draft.appearance;
    W.apply(lookGift, a);
    const mark = (el, k) => el.querySelectorAll("[data-k]").forEach(b => {
      const on = b.dataset.k === k;
      b.setAttribute("aria-checked", on);
      b.tabIndex = on ? 0 : -1;
    });
    $("paperPicker").querySelectorAll("[data-k]").forEach(b => { b.style.cssText = styleVars({ ...a, paper: b.dataset.k }); });
    $("patternPicker").querySelectorAll("[data-k]").forEach(b => { b.style.cssText = `--w:170px;${styleVars({ ...a, pattern: b.dataset.k })}`; });
    $("ribbonPicker").querySelectorAll("[data-k]").forEach(b => { b.style.cssText = styleVars({ ...a, ribbon: b.dataset.k }); });
    mark($("paperPicker"), a.paper);
    mark($("patternPicker"), a.pattern);
    mark($("ribbonPicker"), a.ribbon);
    mark($("stylePicker"), a.ribbonStyle);
    $("paperName").textContent = W.PAPERS[a.paper].name;
    $("patternName").textContent = W.PATTERNS[a.pattern].name;
    $("ribbonName").textContent = W.RIBBONS[a.ribbon].name;
  }

  let playing = false;
  function play() {
    if (playing || reduce) return;
    playing = true;
    lookGift.classList.add("wiggle");
    setTimeout(() => {
      lookGift.classList.add("lifted");
      const r = lookGift.getBoundingClientRect();
      window.XDfx?.burst(r.left + r.width / 2, r.top + r.height * .3, 80);
    }, 650);
    setTimeout(() => { lookGift.classList.remove("wiggle", "lifted"); playing = false; }, 2300);
  }
  lookGift.addEventListener("click", play);
  $("lookPlay").addEventListener("click", play);

  document.querySelectorAll('input[name="reveal"]').forEach(r => r.addEventListener("change", () => {
    if (r.checked && draft) { draft.reveal = r.value; updateDirty(); }
  }));

  /* ---------- items ---------- */
  const itemsEl = $("items");
  const tpl = $("itemTpl");
  const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);

  function autosize(ta) { ta.style.height = "auto"; ta.style.height = `${ta.scrollHeight}px`; }

  function renderItems(focus) {
    itemsEl.innerHTML = "";
    if (!draft.items.length) {
      const p = document.createElement("li");
      p.className = "items-empty";
      p.textContent = "Box je zatím prázdný. Přidej první položku, třeba poukaz v PDF.";
      itemsEl.appendChild(p);
    }
    draft.items.forEach((item, i) => {
      const li = tpl.content.firstElementChild.cloneNode(true);
      li.dataset.id = item.id;
      li.querySelector(".item-num").textContent = i + 1;
      const name = li.querySelector(".item-name");
      const desc = li.querySelector(".item-desc");
      name.value = item.name;
      desc.value = item.description;
      name.addEventListener("input", () => { item.name = name.value; updateDirty(); });
      desc.addEventListener("input", () => { item.description = desc.value; autosize(desc); updateDirty(); });
      li.querySelector(".up").disabled = i === 0;
      li.querySelector(".down").disabled = i === draft.items.length - 1;
      li.querySelector(".up").addEventListener("click", () => move(item.id, -1, ".up"));
      li.querySelector(".down").addEventListener("click", () => move(item.id, 1, ".down"));
      li.querySelector(".remove").addEventListener("click", () => removeItem(item.id));
      const grip = li.querySelector(".grip");
      grip.addEventListener("pointerdown", e => startDrag(e, li));
      grip.addEventListener("keydown", e => {
        if (e.key === "ArrowUp") { e.preventDefault(); move(item.id, -1, ".grip"); }
        if (e.key === "ArrowDown") { e.preventDefault(); move(item.id, 1, ".grip"); }
      });
      renderFileSlot(li.querySelector(".file-slot"), item);
      itemsEl.appendChild(li);
      requestAnimationFrame(() => autosize(desc));
    });
    if (focus) itemsEl.querySelector(`[data-id="${focus.id}"] ${focus.sel}`)?.focus();
    updateDirty();
  }

  function move(id, delta, focusSel) {
    const i = draft.items.findIndex(x => x.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= draft.items.length) return;
    const [it] = draft.items.splice(i, 1);
    draft.items.splice(j, 0, it);
    const before = snapshotPositions();
    renderItems({ id, sel: focusSel });
    flip(before);
  }

  function snapshotPositions() {
    const m = new Map();
    itemsEl.querySelectorAll(".item").forEach(li => m.set(li.dataset.id, li.getBoundingClientRect().top));
    return m;
  }
  function flip(before) {
    if (reduce) return;
    itemsEl.querySelectorAll(".item").forEach(li => {
      const prev = before.get(li.dataset.id);
      if (prev === undefined) return;
      const d = prev - li.getBoundingClientRect().top;
      if (!d) return;
      li.style.transition = "none";
      li.style.transform = `translateY(${d}px)`;
      requestAnimationFrame(() => {
        li.style.transition = "transform .22s ease";
        li.style.transform = "";
        li.addEventListener("transitionend", () => { li.style.transition = ""; }, { once: true });
      });
    });
  }

  async function removeItem(id) {
    const item = draft.items.find(x => x.id === id);
    if (!item) return;
    const hasContent = item.name.trim() || item.description.trim() || item.file;
    if (hasContent && !(await confirmDialog({
      title: "Odebrat položku?",
      text: `${item.name ? `„${item.name}“` : "Položka"}${item.file ? " i s přiloženým PDF" : ""} zmizí z boxu po uložení.`,
      ok: "Odebrat"
    }))) return;
    draft.items = draft.items.filter(x => x.id !== id);
    delete uploads[id];
    renderItems();
  }

  $("addItem").addEventListener("click", () => {
    const item = { id: newId(), name: "", description: "", file: null };
    draft.items.push(item);
    renderItems({ id: item.id, sel: ".item-name" });
    itemsEl.querySelector(`[data-id="${item.id}"]`)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  });

  /* drag & drop reorder (mouse + touch via pointer events) */
  function startDrag(e, li) {
    if (e.button !== 0) return;
    e.preventDefault();
    const pid = e.pointerId;
    li.classList.add("dragging");
    document.body.style.userSelect = "none";
    let startDocY = e.clientY + scrollY;
    let lastClientY = e.clientY;
    let scrollTimer = null;

    const position = () => {
      const dy = lastClientY + scrollY - startDocY;
      li.style.transform = `translateY(${dy}px)`;
      const r = li.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      const prev = li.previousElementSibling, next = li.nextElementSibling;
      if (prev?.classList.contains("item")) {
        const pr = prev.getBoundingClientRect();
        if (mid < pr.top + pr.height / 2) return swap(prev, true);
      }
      if (next?.classList.contains("item")) {
        const nr = next.getBoundingClientRect();
        if (mid > nr.top + nr.height / 2) return swap(next, false);
      }
    };
    const swap = (sib, before) => {
      const sibTop = sib.getBoundingClientRect().top;
      const oldTop = li.offsetTop;
      itemsEl.insertBefore(li, before ? sib : sib.nextElementSibling);
      startDocY += li.offsetTop - oldTop;
      li.style.transform = `translateY(${lastClientY + scrollY - startDocY}px)`;
      if (!reduce) {
        const d = sibTop - sib.getBoundingClientRect().top;
        sib.style.transition = "none";
        sib.style.transform = `translateY(${d}px)`;
        requestAnimationFrame(() => { sib.style.transition = "transform .2s ease"; sib.style.transform = ""; });
      }
    };
    const onMove = ev => {
      if (ev.pointerId !== pid) return;
      ev.preventDefault();
      lastClientY = ev.clientY;
      position();
      const edge = 70;
      clearInterval(scrollTimer);
      if (ev.clientY < edge + 60 || ev.clientY > innerHeight - edge) {
        const dir = ev.clientY < edge + 60 ? -1 : 1;
        scrollTimer = setInterval(() => { scrollBy(0, dir * 12); position(); }, 16);
      }
    };
    const onUp = ev => {
      if (ev.pointerId !== pid) return;
      clearInterval(scrollTimer);
      removeEventListener("pointermove", onMove);
      removeEventListener("pointerup", onUp);
      removeEventListener("pointercancel", onUp);
      document.body.style.userSelect = "";
      li.classList.add("settling");
      li.style.transform = "";
      setTimeout(() => {
        li.classList.remove("dragging", "settling");
        const order = [...itemsEl.querySelectorAll(".item")].map(x => x.dataset.id);
        const byId = new Map(draft.items.map(x => [x.id, x]));
        const changed = order.join() !== draft.items.map(x => x.id).join();
        draft.items = order.map(id => byId.get(id)).filter(Boolean);
        if (changed) renderItems({ id: li.dataset.id, sel: ".grip" });
      }, reduce ? 0 : 200);
    };
    // listen on window: moving the node in the DOM would drop pointer capture
    addEventListener("pointermove", onMove, { passive: false });
    addEventListener("pointerup", onUp);
    addEventListener("pointercancel", onUp);
  }

  /* file slot */
  function renderFileSlot(slot, item) {
    const up = uploads[item.id];
    if (up && !up.error) {
      slot.innerHTML = `<div class="file-chip"><span class="pdf-ico empty">PDF</span>
        <span class="file-info"><span class="file-name">${esc(up.name)}</span><span class="file-size">Nahrávám… ${Math.round(up.progress * 100)} %</span></span>
        <span class="progress"><i style="width:${Math.round(up.progress * 100)}%"></i></span></div>`;
      return;
    }
    if (item.file) {
      slot.innerHTML = `<div class="file-chip">
        <span class="pdf-ico">PDF</span>
        <span class="file-info"><span class="file-name" title="${esc(item.file.name)}">${esc(item.file.name)}</span><span class="file-size">${esc(formatSize(item.file.size))}</span></span>
        <span class="file-actions">
          <a class="chip" href="api/admin/files/${encodeURIComponent(item.file.id)}" target="_blank" rel="noopener">Náhled</a>
          <label class="chip">Vyměnit<input type="file" accept="application/pdf,.pdf" hidden></label>
          <button type="button" class="chip danger" data-act="unfile">Odebrat PDF</button>
        </span>
      </div>`;
      slot.querySelector('[data-act="unfile"]').addEventListener("click", () => { item.file = null; renderFileSlot(slot, item); updateDirty(); });
    } else {
      slot.innerHTML = `<label class="drop">
        <span class="pdf-ico empty">PDF</span>
        <span>Přetáhni sem PDF poukaz, nebo <u>vyber soubor</u></span>
        <input type="file" accept="application/pdf,.pdf">
      </label>${up?.error ? `<p class="file-error">${esc(up.error)}</p>` : ""}`;
      const drop = slot.querySelector(".drop");
      drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); });
      drop.addEventListener("dragleave", () => drop.classList.remove("over"));
      drop.addEventListener("drop", e => {
        e.preventDefault(); drop.classList.remove("over");
        const f = e.dataTransfer.files?.[0];
        if (f) uploadFile(item, f, slot);
      });
    }
    const input = slot.querySelector('input[type="file"]');
    input?.addEventListener("change", () => { const f = input.files?.[0]; if (f) uploadFile(item, f, slot); });
  }

  function uploadFile(item, file, slot) {
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (!isPdf) { uploads[item.id] = { error: `„${file.name}“ není PDF. Nahrát jde jen PDF soubor.` }; renderFileSlot(slot, item); return; }
    uploads[item.id] = { progress: 0, name: file.name };
    renderFileSlot(slot, item);
    updateDirty();

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "api/admin/files");
    xhr.setRequestHeader("X-Admin", "1");
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = e => {
      if (!e.lengthComputable || !uploads[item.id]) return;
      uploads[item.id].progress = e.loaded / e.total;
      const bar = slot.querySelector(".progress i"), label = slot.querySelector(".file-size");
      if (bar) bar.style.width = `${Math.round(uploads[item.id].progress * 100)}%`;
      if (label) label.textContent = `Nahrávám… ${Math.round(uploads[item.id].progress * 100)} %`;
    };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* not json */ }
      if (xhr.status === 201 && data?.id) {
        delete uploads[item.id];
        item.file = { id: data.id, name: data.name, size: data.size };
        toast("PDF nahráno. Nezapomeň box uložit.");
      } else if (xhr.status === 401) {
        delete uploads[item.id];
        showLogin("Přihlášení vypršelo. Přihlas se prosím znovu.");
        return;
      } else {
        uploads[item.id] = { error: data?.message || (xhr.status === 413 ? "Soubor je na server příliš velký." : `Nahrání se nepovedlo (chyba ${xhr.status}).`) };
      }
      if (draft?.items.includes(item)) renderFileSlot(slot, item);
      updateDirty();
    };
    xhr.onerror = () => {
      uploads[item.id] = { error: "Nahrání se nepovedlo. Zkontroluj připojení a zkus to znovu." };
      renderFileSlot(slot, item);
    };
    xhr.send(file);
  }

  /* ---------- save / discard / create / delete ---------- */
  async function save() {
    if (!draft || saving || !isDirty()) return;
    if (Object.values(uploads).some(u => !u.error)) { toast("Počkej, až se PDF nahraje.", true); return; }
    if (pw.on && !cur.hasPassword && !pw.value) {
      $("fPw").classList.add("invalid");
      $("fPw").focus();
      $("fPw").scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
      toast("Zadej heslo, nebo ochranu heslem vypni.", true);
      return;
    }
    if (!draft.anytime && isNaN(Date.parse(draft.openAt))) { toast("Doplň datum a čas odemčení.", true); $("fOpenAt").focus(); return; }

    const body = {
      title: draft.title.trim() || "Dárek",
      showTitle: draft.showTitle,
      message: draft.message,
      signature: draft.signature,
      anytime: draft.anytime,
      openAt: draft.openAt,
      manualUnlock: draft.manualUnlock,
      appearance: { ...draft.appearance, seal: draft.appearance.seal.trim() },
      reveal: draft.reveal,
      items: draft.items.map(i => ({ id: i.id, name: i.name.trim(), description: i.description.trim(), file: i.file ? { id: i.file.id } : null }))
    };
    let newPw = null;
    if (!pw.on && cur.hasPassword) body.password = null;
    if (pw.on && pw.value) { newPw = normalizePassword(pw.value); body.password = newPw; }

    saving = true; updateDirty();
    try {
      const g = await api(`admin/gifts/${encodeURIComponent(cur.code)}`, { method: "PUT", body });
      if (newPw) fresh[g.code] = newPw;
      if (body.password === null) delete fresh[g.code];
      saving = false;
      setCurrent(g);
      await loadList();
      toast("Uloženo");
    } catch (err) {
      saving = false; updateDirty();
      if (err.status !== 401) toast(err.message, true);
    }
  }

  $("save").addEventListener("click", save);
  $("discard").addEventListener("click", async () => {
    if (await confirmDialog({ title: "Zahodit změny?", text: "Box se vrátí do posledního uloženého stavu.", ok: "Zahodit" })) setCurrent(cur);
  });
  document.addEventListener("keydown", e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && !$("editor").hidden) { e.preventDefault(); save(); }
  });
  addEventListener("beforeunload", e => { if (isDirty()) { e.preventDefault(); e.returnValue = ""; } });

  async function createGift() {
    if (isDirty() && !(await confirmDialog({ title: "Zahodit neuložené změny?", text: `V boxu „${draft.title}“ máš neuložené změny.`, ok: "Zahodit" }))) return;
    try {
      const g = await api("admin/gifts", { method: "POST", body: { title: "Nový dárek" } });
      await loadList();
      setCurrent(g);
      $("layout").classList.add("show-editor");
      const t = $("fTitle");
      t.focus(); t.select();
      toast(`Box zabalen. Kód ${g.code}`);
    } catch (err) { if (err.status !== 401) toast(err.message, true); }
  }
  $("newGift").addEventListener("click", createGift);
  $("newGiftEmpty").addEventListener("click", createGift);

  $("deleteGift").addEventListener("click", async () => {
    const files = cur.items.filter(i => i.file).length;
    if (!(await confirmDialog({
      title: `Smazat „${cur.title}“?`,
      text: `Odkaz ${cur.code} přestane fungovat${files ? ` a smaže se ${files} ${plural(files, "PDF soubor", "PDF soubory", "PDF souborů")}` : ""}. Tohle nejde vrátit.`,
      ok: "Smazat box"
    }))) return;
    try {
      await api(`admin/gifts/${encodeURIComponent(cur.code)}`, { method: "DELETE" });
      delete fresh[cur.code];
      cur = draft = null; snapshot = "";
      history.replaceState(null, "", location.pathname);
      await loadList();
      showEmptyEditor();
      toast("Box smazán");
    } catch (err) { if (err.status !== 401) toast(err.message, true); }
  });

  /* keep relative times fresh */
  setInterval(() => { if (draft) renderWhen(); renderList(); }, 30000);

  /* ---------- boot ---------- */
  (async () => {
    try {
      await rawApi("admin/me", { admin: true });
      showApp();
    } catch (err) {
      showLogin(err.status === 401 ? "" : err.message);
    }
  })();
})();
