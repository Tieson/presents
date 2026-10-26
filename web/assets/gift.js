/* Recipient page */
(function () {
  const { api, normalizePassword, normalizeCode, formatLong, plural, formatSize, esc, store } = window.XD;
  const W = window.XDwrap;
  const $ = id => document.getElementById(id);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const present = $("present"), gift = $("gift"), tag = $("tag"), msg = $("msg"), reveal = $("reveal");
  const states = { code: $("codeForm"), loading: $("loadingState"), locked: $("lockedState"), open: $("openForm") };

  const params = new URLSearchParams(location.search);
  const preview = params.has("preview");
  let code = readCode();
  let meta = null, offset = 0, fails = 0, busy = false, tick = null;

  function readCode() {
    const fromQuery = params.get("d") || params.get("kod");
    if (fromQuery) return normalizeCode(fromQuery);
    const last = decodeURIComponent(location.pathname.split("/").filter(Boolean).pop() || "");
    if (!last || /\.html?$/.test(last)) return null;
    return normalizeCode(last);
  }

  function show(name) {
    for (const [k, el] of Object.entries(states)) el.hidden = k !== name;
  }
  function say(text) { msg.textContent = text || ""; }
  function shake() { tag.classList.remove("shake"); void tag.offsetWidth; tag.classList.add("shake"); }
  const now = () => Date.now() + offset;
  const key = k => `xd:${k}:${code}`;   // t = token, n = revealed count, m = chosen mode

  /* ---------- footline: days to Christmas Eve ---------- */
  function footline() {
    const el = $("footline");
    const d = new Date(), today = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const eve = new Date(d.getFullYear(), 11, 24);
    const days = Math.round((eve - today) / 86400000);
    if (days > 0) el.innerHTML = `Do Štědrého večera ${days >= 2 && days <= 4 ? "zbývají" : "zbývá"} <b>${days}</b> ${plural(days, "den", "dny", "dní")}`;
    else if (days === 0) el.innerHTML = "Dnes je <b>Štědrý den</b>";
    else el.innerHTML = "Krásné <b>vánoční svátky</b>";
  }

  /* ---------- states ---------- */
  function showCodeEntry(message) {
    show("code");
    say(message);
    $("lede").textContent = "Pod stromečkem na tebe něco čeká. Rozbal si svůj dárek.";
    W.apply(gift, W.DEFAULT);
    setTimeout(() => $("codeInput").focus({ preventScroll: true }), 50);
  }

  function setLede() {
    if (meta?.title) $("lede").innerHTML = `<strong>${esc(meta.title)}</strong><br>Pod stromečkem na tebe něco čeká.`;
  }

  function showLocked(openAt) {
    show("locked");
    say("");
    $("lockedWhen").textContent = formatLong(openAt);
    const target = Date.parse(openAt);
    const set = (u, v) => { const el = document.querySelector(`[data-u="${u}"]`); if (el.textContent !== v) el.textContent = v; };
    clearInterval(tick);
    const update = () => {
      const ms = target - now();
      if (ms <= 0) { clearInterval(tick); load(); return; }
      const s = Math.floor(ms / 1000);
      const d = Math.floor(s / 86400);
      set("d", String(d));
      document.querySelector('[data-l="d"]').textContent = plural(d, "den", "dny", "dní");
      set("h", String(Math.floor(s % 86400 / 3600)).padStart(2, "0"));
      set("m", String(Math.floor(s % 3600 / 60)).padStart(2, "0"));
      set("s", String(s % 60).padStart(2, "0"));
    };
    update();
    tick = setInterval(update, 1000);
  }

  function showOpen() {
    show("open");
    const needPw = meta.hasPassword && !store(key("t")) && !preview;
    $("pwWrap").hidden = !needPw;
    $("openTitle").textContent = preview ? "Náhled pro tvůrce" : needPw ? "Heslo pro dárek" : "Dárek je připravený";
    $("openBtn").textContent = preview ? "Rozbalit náhled" : "Rozbalit dárek";
    if (needPw) setTimeout(() => $("pwInput").focus({ preventScroll: true }), 50);
  }

  async function load() {
    clearInterval(tick);
    if (!code) { showCodeEntry(""); return; }
    show("loading"); say("");
    try {
      meta = await api(`gifts/${code}`);
      offset = Date.parse(meta.serverNow) - Date.now();
      W.apply(gift, meta.appearance);
      document.title = meta.title ? `${meta.title} · Vánoční dárek` : "Vánoční dárek";
      setLede();
      if (meta.locked && !preview) showLocked(meta.openAt);
      else showOpen();
    } catch (err) {
      if (err.status === 404) showCodeEntry(`Dárek s kódem ${code} jsme nenašli. Zkontroluj, jestli je kód opsaný správně.`);
      else { show("loading"); say(err.message); }
    }
  }

  /* ---------- code entry ---------- */
  states.code.addEventListener("submit", e => {
    e.preventDefault();
    const c = normalizeCode($("codeInput").value);
    if (!c) { say("Kód má 12 písmen, třeba bekalo-mitusa."); shake(); return; }
    code = c;
    const base = location.pathname.replace(/[^/]*$/, "");
    history.pushState(null, "", base + c);
    load();
  });
  addEventListener("popstate", () => { code = readCode(); resetView(); load(); });

  /* ---------- open ---------- */
  gift.addEventListener("click", () => {
    if (!states.open.hidden) {
      if (!$("pwWrap").hidden) $("pwInput").focus(); else states.open.requestSubmit();
    } else if (!states.code.hidden) $("codeInput").focus();
  });

  states.open.addEventListener("submit", async e => {
    e.preventDefault();
    if (busy) return;
    const body = {};
    const savedToken = store(key("t"));
    if (preview) body.preview = true;
    else if (!$("pwWrap").hidden) {
      body.password = normalizePassword($("pwInput").value);
      if (!body.password) { say("Nejdřív napiš heslo z přáníčka."); $("pwInput").focus(); return; }
    } else if (savedToken) body.token = savedToken;

    busy = true;
    $("openBtn").disabled = true;
    say("");
    try {
      const res = await api(`gifts/${code}/open`, { method: "POST", body });
      store(key("t"), res.token);
      openSequence(res.gift, res.token, res.preview);
    } catch (err) {
      busy = false;
      $("openBtn").disabled = false;
      if (err.code === "bad_password") {
        if (body.token) { store(key("t"), null); showOpen(); say("Pro otevření je potřeba heslo."); return; }
        fails++;
        say(fails >= 2 ? "Tohle heslo dárek neotevře. Na velikosti písmen ani na diakritice nezáleží." : "Tohle heslo dárek neotevře. Zkus to znovu.");
        shake();
        $("pwInput").select();
      } else if (err.code === "locked") {
        offset = Date.parse(err.data.serverNow) - Date.now();
        showLocked(err.data.openAt);
      } else if (err.status === 404) {
        showCodeEntry("Tenhle dárek už neexistuje.");
      } else {
        say(err.message);
      }
    }
  });

  /* ---------- the opened card ---------- */
  let opened = null; // { g, token, mode }

  function itemHtml(it, i, { delay = 0, seen = false } = {}) {
    const g = opened.g, token = opened.token;
    const fileUrl = dl => `api/gifts/${encodeURIComponent(g.code)}/items/${encodeURIComponent(it.id)}/file?t=${encodeURIComponent(token)}${dl ? "&dl=1" : ""}`;
    return `<li class="${seen ? "seen" : ""}" data-i="${i}" style="${seen ? "" : `animation-delay:${delay}s`}">
      <span class="num" aria-hidden="true">${i + 1}</span>
      <span class="name">${esc(it.name || "Překvapení")}</span>
      ${it.description ? `<span class="desc">${esc(it.description)}</span>` : ""}
      ${it.file ? `<span class="actions">
        <a class="btn small gold" href="${fileUrl(false)}" target="_blank" rel="noopener">Otevřít poukaz</a>
        <a class="btn small ghost" href="${fileUrl(true)}">Stáhnout PDF</a>
        <span class="file-meta">${esc(formatSize(it.file.size))}</span>
      </span>` : ""}
    </li>`;
  }

  function renderCard(g, token, isPreview) {
    const chosen = store(key("m"));
    opened = { g, token, mode: g.reveal === "choice" ? (chosen === "all" || chosen === "sequential" ? chosen : null) : (g.reveal || "all") };
    reveal.innerHTML = `
      ${isPreview ? `<p class="preview-banner">Náhled pro tvůrce. Příjemce uvidí totéž až po zadání hesla a v nastavený čas.</p>` : ""}
      <article class="card">
        <p class="eyebrow">${g.title ? "Rozbaleno" : "Tvůj dárek"}</p>
        <h2>${esc(g.title || "Veselé Vánoce")}</h2>
        <div class="ornament" aria-hidden="true">✦</div>
        ${g.message ? `<p class="note">${esc(g.message)}</p>` : ""}
        <div class="items-area" id="itemsArea"></div>
        ${g.signature ? `<p class="sign" id="sign">${esc(g.signature)}</p>` : ""}
        <button class="link-btn" id="rewrap" type="button">Zabalit znovu</button>
      </article>`;
    $("rewrap").addEventListener("click", () => {
      store(key("n"), null); store(key("m"), null);
      resetView(); showOpen();
      present.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    });
    renderItemsArea();
  }

  function renderItemsArea(fresh = -1) {
    const { g, mode } = opened;
    const area = $("itemsArea");
    const total = g.items.length;
    const sign = $("sign");

    if (!total) { area.innerHTML = ""; if (sign) sign.hidden = false; return; }

    if (!mode) {
      if (sign) sign.hidden = true;
      area.innerHTML = `<div class="choice">
        <p class="choice-q">Uvnitř ${plural(total, "je", "jsou", "je")} ${total} ${plural(total, "překvapení", "překvapení", "překvapení")}. Jak je chceš rozbalit?</p>
        <div class="choice-opts">
          <button type="button" class="choice-opt" data-mode="all"><b>Všechno najednou</b><span>Ukáže se celý obsah boxu hned.</span></button>
          <button type="button" class="choice-opt" data-mode="sequential"><b>Postupně</b><span>Jedno překvapení po druhém, každé ve vlastní krabičce.</span></button>
        </div>
      </div>`;
      area.querySelectorAll(".choice-opt").forEach(b => b.addEventListener("click", () => {
        opened.mode = b.dataset.mode;
        store(key("m"), opened.mode);
        renderItemsArea();
      }));
      return;
    }

    if (mode === "all") {
      area.innerHTML = `<ol class="items">${g.items.map((it, i) => itemHtml(it, i, { delay: .45 + i * .16 })).join("")}</ol>`;
      if (sign) sign.hidden = false;
      return;
    }

    // sequential
    let n = Math.min(total, Math.max(0, Number(store(key("n"))) || 0));
    const done = n >= total;
    area.innerHTML = `
      ${n ? `<ol class="items">${g.items.slice(0, n).map((it, i) => itemHtml(it, i, { seen: i !== fresh, delay: .1 })).join("")}</ol>` : ""}
      ${done ? "" : `<div class="next-gift">
        <button type="button" class="gift wait" id="miniGift" aria-label="Rozbalit další překvapení">${W.markup()}</button>
        <p class="next-label">Překvapení <b>${n + 1}</b> z <b>${total}</b></p>
        <div class="seq-dots" aria-hidden="true">${g.items.map((_, i) => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</div>
        <button type="button" class="btn" id="nextBtn">${n ? "Rozbalit další" : "Rozbalit první"}</button>
      </div>`}`;
    if (sign) sign.hidden = !done;

    if (!done) {
      const mini = $("miniGift");
      W.apply(mini, meta?.appearance || g.appearance);
      const go = () => unwrapNext(mini);
      mini.addEventListener("click", go);
      $("nextBtn").addEventListener("click", go);
    }
    if (fresh >= 0) {
      const li = area.querySelector(`li[data-i="${fresh}"]`);
      li?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    }
  }

  let unwrapping = false;
  function unwrapNext(mini) {
    if (unwrapping) return;
    unwrapping = true;
    const n = Math.min(opened.g.items.length, (Number(store(key("n"))) || 0) + 1);
    const finish = () => {
      store(key("n"), String(n));
      unwrapping = false;
      renderItemsArea(n - 1);
    };
    if (reduce) { finish(); return; }
    $("nextBtn").disabled = true;
    mini.classList.remove("wait");
    mini.classList.add("wiggle");
    setTimeout(() => {
      mini.classList.add("lifted");
      const r = mini.getBoundingClientRect();
      window.XDfx?.burst(r.left + r.width / 2, r.top + r.height * .3, 90);
    }, 650);
    setTimeout(finish, 1300);
  }

  function openSequence(g, token, isPreview) {
    renderCard(g, token, isPreview);
    if (reduce) { present.hidden = true; reveal.hidden = false; busy = false; return; }
    present.classList.add("opening");
    gift.classList.remove("breathe");
    gift.classList.add("wiggle");
    setTimeout(() => {
      gift.classList.add("lifted");
      const r = gift.getBoundingClientRect();
      window.XDfx?.burst(r.left + r.width / 2, r.top + r.height * .3);
    }, 900);
    setTimeout(() => present.classList.add("gone"), 1700);
    setTimeout(() => {
      present.hidden = true;
      reveal.hidden = false;
      reveal.scrollIntoView({ behavior: "smooth", block: "start" });
      busy = false;
    }, 2200);
  }

  function resetView() {
    reveal.hidden = true;
    reveal.innerHTML = "";
    opened = null;
    present.classList.remove("opening", "gone");
    gift.classList.remove("wiggle", "lifted");
    gift.classList.add("breathe");
    present.hidden = false;
    $("openBtn").disabled = false;
    $("pwInput").value = "";
    fails = 0; busy = false; unwrapping = false;
  }

  footline();
  load();
})();
