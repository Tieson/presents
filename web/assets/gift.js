import "./common.js";
import "./wrap.js";
import "./fx.js";

/* Recipient page */
(function () {
  const { api, normalizePassword, normalizeCode, formatLong, plural, formatSize, esc, store } = window.XD;
  const W = window.XDwrap;
  const $ = id => document.getElementById(id);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const stage = $("stage"), present = $("present"), gift = $("gift"), tag = $("tag"), msg = $("msg");
  const unwrap = $("unwrap"), peek = $("peek"), reveal = $("reveal");
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

  /* ---------- after opening ----------
     mode "all":        stage shrinks to the heading, the list card follows right under it
     mode "sequential": the stage shows one small box at a time → the surprise it held → next box…,
                        the list of what's been unwrapped sits below the stage and peeks in
     mode "choice":     the stage first asks which of the two the recipient wants            */
  let opened = null;      // { g, token, preview, mode, view: "box" | "item" | "done" }
  let unwrapping = false;

  const total = () => opened.g.items.length;
  const revealed = () => Math.min(total(), Math.max(0, Number(store(key("n"))) || 0));
  const toTop = (smooth = true) => scrollTo({ top: 0, behavior: smooth && !reduce ? "smooth" : "auto" });

  function fileUrl(it, dl) {
    const g = opened.g;
    return `api/gifts/${encodeURIComponent(g.code)}/items/${encodeURIComponent(it.id)}/file?t=${encodeURIComponent(opened.token)}${dl ? "&dl=1" : ""}`;
  }
  function fileActions(it) {
    if (!it.file) return "";
    return `<span class="actions">
      <a class="btn small gold" href="${fileUrl(it, false)}" target="_blank" rel="noopener">Otevřít poukaz</a>
      <a class="btn small ghost" href="${fileUrl(it, true)}">Stáhnout PDF</a>
      <span class="file-meta">${esc(formatSize(it.file.size))}</span>
    </span>`;
  }
  function itemHtml(it, i, { delay = 0, cls = "" } = {}) {
    return `<li class="${cls}" data-i="${i}" style="${cls === "seen" ? "" : `animation-delay:${delay}s`}">
      <span class="num" aria-hidden="true">${i + 1}</span>
      <span class="name">${esc(it.name || "Překvapení")}</span>
      ${it.description ? `<span class="desc">${esc(it.description)}</span>` : ""}
      ${fileActions(it)}
    </li>`;
  }
  const dotsHtml = n => `<div class="seq-dots" aria-hidden="true">${opened.g.items.map((_, i) => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</div>`;

  function openSequence(g, token, isPreview) {
    const chosen = store(key("m"));
    opened = {
      g, token, preview: isPreview,
      mode: g.reveal === "choice" ? (chosen === "all" || chosen === "sequential" ? chosen : null) : (g.reveal || "all"),
      view: "box"
    };
    if (reduce) { present.hidden = true; enterOpened(); busy = false; return; }
    toTop();                                   // the present must be on screen for the effect
    present.classList.add("opening");
    gift.classList.remove("breathe");
    gift.classList.add("wiggle");
    setTimeout(() => {
      gift.classList.add("lifted");
      const r = gift.getBoundingClientRect();
      window.XDfx?.burst(r.left + r.width / 2, r.top + r.height * .3);
    }, 900);
    setTimeout(() => present.classList.add("gone"), 1700);
    setTimeout(() => { present.hidden = true; enterOpened(); busy = false; }, 2200);
  }

  function enterOpened() {
    renderCard();
    reveal.hidden = false;
    if (!total() || opened.mode === "all") {
      stage.classList.add("compact");
      stage.classList.remove("with-peek");
      unwrap.hidden = true;
      peek.hidden = true;
      toTop(false);
      return;
    }
    stage.classList.add("with-peek");
    unwrap.hidden = false;
    peek.hidden = false;
    opened.view = revealed() >= total() ? "done" : "box";
    renderStage();
  }

  /* the list card below the stage */
  function renderCard(fresh = -1) {
    const g = opened.g, mode = opened.mode, n = revealed();
    const all = mode === "all" || !total();
    const shown = all ? g.items : g.items.slice(0, n);
    const done = all || n >= total();
    reveal.innerHTML = `
      ${opened.preview ? `<p class="preview-banner">Náhled pro tvůrce. Příjemce uvidí totéž až po zadání hesla a v nastavený čas.</p>` : ""}
      <article class="card">
        <p class="eyebrow">${all ? (g.title ? "Rozbaleno" : "Tvůj dárek") : mode ? `Rozbaleno ${n} z ${total()}` : "Tvůj dárek"}</p>
        <h2>${esc(g.title || "Veselé Vánoce")}</h2>
        <div class="ornament" aria-hidden="true">✦</div>
        ${g.message ? `<p class="note">${esc(g.message)}</p>` : ""}
        ${shown.length
          ? `<ol class="items">${shown.map((it, i) => itemHtml(it, i, all ? { delay: .45 + i * .16 } : { cls: i === fresh ? "flash" : "seen" })).join("")}</ol>`
          : (mode ? `<p class="reveal-empty">Zatím nic. Rozbal první krabičku nahoře.</p>` : "")}
        ${g.signature && done && mode ? `<p class="sign">${esc(g.signature)}</p>` : ""}
        <button class="link-btn" id="rewrap" type="button">Zabalit znovu</button>
      </article>`;
    $("rewrap").addEventListener("click", rewrap);
  }

  /* the stage after opening */
  function renderStage() {
    const g = opened.g, n = revealed(), t = total();
    if (!opened.mode) {
      $("peekText").textContent = "Tvoje překvapení";
      unwrap.innerHTML = `<div class="choice">
        <p class="choice-q">Uvnitř ${plural(t, "je", "jsou", "je")} ${t} překvapení. Jak je chceš rozbalit?</p>
        <div class="choice-opts">
          <button type="button" class="choice-opt" data-mode="all"><b>Všechno najednou</b><span>Ukáže se celý obsah boxu hned.</span></button>
          <button type="button" class="choice-opt" data-mode="sequential"><b>Postupně</b><span>Jedno překvapení po druhém, každé ve vlastní krabičce.</span></button>
        </div>
      </div>`;
      unwrap.querySelectorAll(".choice-opt").forEach(b => b.addEventListener("click", () => {
        opened.mode = b.dataset.mode;
        store(key("m"), opened.mode);
        enterOpened();
      }));
      return;
    }

    $("peekText").textContent = n ? `Rozbaleno ${n} z ${t}` : "Tvoje překvapení";

    if (opened.view === "box") {
      unwrap.innerHTML = `
        <button type="button" class="gift wait" id="miniGift" aria-label="Rozbalit překvapení ${n + 1} z ${t}">${W.markup()}</button>
        <p class="step-label">Překvapení <b>${n + 1}</b> z <b>${t}</b></p>
        ${dotsHtml(n)}
        <div class="step-actions"><button type="button" class="btn" id="stepBtn">${n ? "Rozbalit další" : "Rozbalit první"}</button></div>`;
      const mini = $("miniGift");
      W.apply(mini, meta?.appearance || g.appearance);
      mini.addEventListener("click", () => unwrapNext(mini));
      $("stepBtn").addEventListener("click", () => unwrapNext(mini));
      return;
    }

    if (opened.view === "item") {
      const it = g.items[n - 1];
      unwrap.innerHTML = `
        <article class="surprise">
          <p class="step-label">Překvapení <b>${n}</b> z <b>${t}</b></p>
          <h2 class="s-name">${esc(it.name || "Překvapení")}</h2>
          ${it.description ? `<p class="s-desc">${esc(it.description)}</p>` : ""}
          ${fileActions(it)}
        </article>
        ${dotsHtml(n)}
        <div class="step-actions"><button type="button" class="btn" id="stepBtn">${n < t ? "Další překvapení" : "Dokončit"}</button></div>`;
      $("stepBtn").addEventListener("click", () => {
        opened.view = n < t ? "box" : "done";
        renderStage();
        if (opened.view === "done") renderCard();
      });
      $("stepBtn").focus({ preventScroll: true });
      return;
    }

    // done
    unwrap.innerHTML = `
      <article class="surprise">
        <p class="step-label">Rozbaleno <b>${t}</b> z <b>${t}</b></p>
        <h2 class="s-name">Všechno je rozbalené</h2>
        <p class="s-desc">Všechna překvapení najdeš pohromadě v seznamu níž.</p>
        ${g.signature ? `<p class="sign">${esc(g.signature)}</p>` : ""}
      </article>
      <div class="step-actions"><button type="button" class="btn ghost" id="stepBtn">Ukázat seznam</button></div>`;
    $("stepBtn").addEventListener("click", showList);
  }

  function unwrapNext(mini) {
    if (unwrapping) return;
    unwrapping = true;
    const n = Math.min(total(), revealed() + 1);
    const finish = () => {
      store(key("n"), String(n));
      unwrapping = false;
      opened.view = "item";
      renderStage();
      renderCard(n - 1);
    };
    // keep the box on screen for the effect
    if (stage.getBoundingClientRect().top < -4) toTop();
    if (reduce) { finish(); return; }
    $("stepBtn").disabled = true;
    mini.classList.remove("wait");
    mini.classList.add("wiggle");
    setTimeout(() => {
      mini.classList.add("lifted");
      const r = mini.getBoundingClientRect();
      window.XDfx?.burst(r.left + r.width / 2, r.top + r.height * .3, 110);
    }, 650);
    setTimeout(finish, 1350);
  }

  function showList() {
    reveal.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }
  peek.addEventListener("click", showList);

  function rewrap() {
    store(key("n"), null); store(key("m"), null);
    resetView(); showOpen();
    toTop();
  }

  function resetView() {
    reveal.hidden = true;
    reveal.innerHTML = "";
    unwrap.hidden = true;
    unwrap.innerHTML = "";
    peek.hidden = true;
    stage.classList.remove("compact", "with-peek");
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
