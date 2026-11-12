import "./common.js";
import "./wrap.js";
import "./fx.js";
import "./themes.js";
import "./rec.js";

/* Screen height for the one-screen layout.
   Pinned to the real window height on load and on rotation / browser-bar changes.
   When the on-screen keyboard opens (a text field has focus and the window got
   shorter) the value is kept, so nothing shrinks while typing. */
(function pinViewportHeight() {
  const root = document.documentElement;
  let pinned = 0, width = 0;
  window.XDvh = () => pinned;
  const typing = () => document.activeElement?.matches?.("input, textarea, [contenteditable]");
  function update(force) {
    const h = window.innerHeight, w = window.innerWidth;
    const rotated = w !== width;
    if (!force && !rotated && h < pinned && typing()) return;   // keyboard: keep the old height
    if (!force && !rotated && Math.abs(h - pinned) < 2) return;
    pinned = h; width = w;
    root.style.setProperty("--vh", `${h}px`);
    root.classList.toggle("short", h < 700);
    root.classList.toggle("tiny", h < 600);
    // phone on its side: wider than tall and low → side-by-side layout with a squeezed heading
    root.classList.toggle("land", w > h && h < 540);
    window.dispatchEvent(new CustomEvent("xd:vh", { detail: h }));
  }
  update(true);
  addEventListener("resize", () => update(false));
  addEventListener("orientationchange", () => setTimeout(() => update(true), 250));
  // after the keyboard closes the field may still have focus – grow back when it blurs
  document.addEventListener("focusout", () => setTimeout(() => update(false), 300));
})();

/* Recipient page */
(function () {
  const { api, normalizePassword, normalizeCode, formatLong, plural, formatSize, esc, store } = window.XD;
  const TH = window.XDthemes;
  let T = TH.get(TH.DEFAULT);          // texts + style of the box's occasion
  const W = window.XDwrap;
  const $ = id => document.getElementById(id);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const stage = $("stage"), present = $("present"), gift = $("gift"), tag = $("tag"), msg = $("msg");
  const unwrap = $("unwrap"), peek = $("peek"), reveal = $("reveal");
  const states = { hub: $("hubState"), code: $("codeForm"), loading: $("loadingState"), locked: $("lockedState"), open: $("openForm") };

  const params = new URLSearchParams(location.search);
  const wantsPreview = params.has("preview");
  let preview = false;      // ?preview=1 counts only for the signed-in creator (the server says so)
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
    scheduleFit();
  }

  /* ---------- size the present so heading + present + tag + footline fill exactly one screen ----------
     CSS gives a first guess; here we measure what the texts really take (they wrap differently
     on every phone) and give the present whatever height is left. Uses the pinned screen height,
     so the keyboard never makes it smaller. */
  const scene = $("scene"), giftSlot = gift.parentElement;
  let fitQueued = false;
  function scheduleFit() {
    if (fitQueued) return;
    fitQueued = true;
    requestAnimationFrame(() => { fitQueued = false; fit(); fit(); });
  }
  function fit() {
    if (present.hidden || opened) return;
    const vh = window.XDvh?.() || innerHeight;
    const wide = innerWidth >= 860 || document.documentElement.classList.contains("land");
    const w = gift.offsetWidth;                                       // layout size: ignores the delivery / wiggle transforms
    const free = scene.clientHeight - present.offsetHeight;          // > 0: room left in the scene
    const over = Math.max(0, stage.offsetHeight - vh);                // > 0: stage taller than the screen
    const slotH = giftSlot.offsetHeight;
    // in the side-by-side layout only the part of the present taller than the tag counts
    const growable = wide ? Math.max(0, slotH - tag.offsetHeight) + Math.max(0, free) : free;
    const delta = ((over > 0 ? -over : growable) - 3) / 1.24;      // 3px spare for rounding
    const land = document.documentElement.classList.contains("land");
    const maxW = land ? 250 : wide ? 330 : Math.min(270, innerWidth * .62);
    const next = Math.max(96, Math.min(maxW, w + delta));
    if (Math.abs(next - w) > 2 || over > 0) stage.style.setProperty("--wbase", `${next.toFixed(1)}px`);
  }
  addEventListener("xd:vh", scheduleFit);
  addEventListener("resize", scheduleFit);
  document.fonts?.ready.then(scheduleFit);
  if ("ResizeObserver" in window) {
    const ro = new ResizeObserver(scheduleFit);
    [$("tag"), document.querySelector(".intro"), $("footline")].forEach(el => el && ro.observe(el));
  }
  function say(text) { msg.textContent = text || ""; }
  function shake() { tag.classList.remove("shake"); void tag.offsetWidth; tag.classList.add("shake"); }
  const now = () => Date.now() + offset;
  const key = k => `xd:${k}:${code}`;   // t = token, n = revealed count, m = chosen mode

  /* ---------- footline (Christmas: days to Christmas Eve) ---------- */
  function footline() { $("footline").innerHTML = T.footline(new Date()); }

  /* ---------- occasion: palette, particles and every text that depends on it ---------- */
  function applyTheme(k) {
    const was = document.documentElement.dataset.theme;
    T = TH.applyPage(k);
    if (was && was !== document.documentElement.dataset.theme && !document.documentElement.classList.contains("pending-theme")) {
      // palette and box colours glide (CSS), the texts fade through
      const intro = document.querySelector(".intro");
      intro.classList.remove("swap-in"); void intro.offsetWidth; intro.classList.add("swap-in");
    }
    $("eyebrow").textContent = T.eyebrow;
    document.querySelector(".intro h1").innerHTML = `<span class="line">${esc(T.h1[0])}</span><em class="foil">${esc(T.h1[1])}</em>`;
    $("pwNote").textContent = T.pwNote;
    footline();
  }
  /** first paint of a gift link: show the box's style right away, without gliding from the neutral one */
  function revealTheme() {
    const html = document.documentElement;
    if (!html.classList.contains("pending-theme")) return;
    void getComputedStyle(html).getPropertyValue("--velvet");      // settle the new colours while transitions are off
    void getComputedStyle(gift).getPropertyValue("--pp-a");
    requestAnimationFrame(() => html.classList.remove("pending-theme"));
  }

  /* home page and code entry (no box yet): always neutral; the box's own style blends in once its code is known */
  function applyHome() {
    applyTheme(TH.DEFAULT);
    $("eyebrow").textContent = T.home.eyebrow;
    document.querySelector(".intro h1").innerHTML = `<span class="line">${esc(T.home.h1[0])}</span><em class="foil">${esc(T.home.h1[1])}</em>`;
    $("lede").textContent = T.home.lede;
    document.title = T.home.title;
    W.apply(gift, T.appearance);
    revealTheme();
  }

  /* ---------- the visitor's own workshop (session cookie), asked once ---------- */
  let mine;
  const myWorkshop = () => (mine ??= api("workshop").then(r => r.workshop, () => null));
  /** "Zabalit dárek" → the workshop; someone who already has one goes straight back to it */
  async function wrapLinks(root = document) {
    const w = await myWorkshop();
    if (!w) return;
    root.querySelectorAll("[data-wrap]").forEach(a => {
      a.href = "dilna";
      a.textContent = a.dataset.wrapBack || "Pokračovat do dílny";
    });
    return w;
  }

  /* ---------- states ---------- */

  /* landing page: nothing to unwrap yet, so offer both ways */
  function showHub() {
    show("hub");
    say("");
    applyHome();
    wrapLinks($("hubState")).then(w => {
      if (w) $("hubNote").innerHTML = `Vítej zpátky. Tvoje dílna <strong>${esc(w.name)}</strong> na tebe čeká.`;
      scheduleFit();
    });
  }
  $("hubCode").addEventListener("click", () => showCodeEntry(""));
  $("codeBack").addEventListener("click", () => {
    if (code) { code = null; history.pushState(null, "", location.pathname.replace(/[^/]*$/, "")); }
    showHub();
  });

  function showCodeEntry(message) {
    show("code");
    say(message);
    applyHome();
    setTimeout(() => $("codeInput").focus({ preventScroll: true }), 50);
  }

  function setLede() {
    $("lede").innerHTML = meta?.title ? `<strong>${esc(meta.title)}</strong><br>${esc(T.ledeTitle)}` : esc(T.lede);
  }

  /* ---------- delivery: how the present arrives (once per box and page load) ---------- */
  let delivered = null;
  const slot = $("giftSlot"), deliveryEl = $("delivery");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const BALLOON_COLORS = [["#ff7aa8", "#c23a76"], ["#ffd166", "#d49a1c"], ["#5ad1c7", "#1f8f86"]];

  async function deliver(kind) {
    if (reduceMotion || opened) return;
    present.classList.add("delivering");
    slot.className = "gift-slot";
    deliveryEl.innerHTML = "";
    try {
      if (kind === "jezisek") {
        // Ježíšek flies in as a light with a glittering trail, leaves the present and rings the bell
        slot.classList.add("d-hidden");
        await wait(250);
        const r = gift.getBoundingClientRect();
        const toX = r.left + r.width / 2, toY = r.top + r.height * .45;
        await (window.XDfx?.comet(toX < innerWidth / 2 ? innerWidth + 40 : -40, innerHeight * .08, toX, toY, 1700) ?? wait(0));
        slot.classList.remove("d-hidden");
        slot.classList.add("d-appear");
        ringFx(true);
      } else if (kind === "balloons") {
        deliveryEl.innerHTML = BALLOON_COLORS.map(([a, b], i) =>
          `<span class="balloon b${i}" style="--bl:${a};--bd:${b}"><i></i></span>`).join("");
        slot.classList.add("d-float");
        await wait(2300);
        slot.classList.add("d-release");
        await wait(200);
        const r = gift.getBoundingClientRect();
        window.XDfx?.burst(r.left + r.width / 2, r.top + r.height * .2, 60);
        await wait(1500);
      } else if (kind === "petals") {
        slot.classList.add("d-bloom");
        await wait(500);
        const r = gift.getBoundingClientRect();
        window.XDfx?.burst(r.left + r.width / 2, r.top + r.height * .3, 90);
        await wait(1100);
      } else {
        slot.classList.add("d-drop");
        await wait(720);
        const r = gift.getBoundingClientRect();
        window.XDfx?.burst(r.left + r.width / 2, r.top + r.height, 50);
        await wait(600);
      }
    } finally {
      present.classList.remove("delivering");
      deliveryEl.innerHTML = "";
      setTimeout(() => slot.classList.remove("d-appear", "d-float", "d-release", "d-bloom", "d-drop", "d-hidden"), 900);
    }
  }

  /* ---------- ring: the creator pressed "Zazvonit zvonečkem" (or the delivery rings) ---------- */
  let lastRing = null, audio;
  function chime() {
    try {
      audio ??= new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state !== "running") return;          // browsers allow sound only after a tap
      const t0 = audio.currentTime;
      [1318.5, 1760, 2637].forEach((f, i) => {
        const o = audio.createOscillator(), g = audio.createGain();
        o.type = "sine"; o.frequency.value = f;
        g.gain.setValueAtTime(0, t0 + i * .12);
        g.gain.linearRampToValueAtTime(.12 / (i + 1), t0 + i * .12 + .01);
        g.gain.exponentialRampToValueAtTime(.0001, t0 + i * .12 + 1.6);
        o.connect(g).connect(audio.destination);
        o.start(t0 + i * .12); o.stop(t0 + i * .12 + 1.7);
      });
    } catch { /* no sound */ }
  }
  addEventListener("pointerdown", () => { try { audio ??= new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch { /* ignore */ } }, { once: true });

  function ringFx(quiet = false) {
    if (opened) return;
    const el = $("ringFx");
    el.innerHTML = TH.RING_ICONS[document.documentElement.dataset.theme] || TH.RING_ICONS.christmas;
    el.classList.remove("on"); void el.offsetWidth; el.classList.add("on");
    gift.classList.remove("wiggle"); void gift.offsetWidth; gift.classList.add("wiggle");
    if (!quiet) { say(T.ring.note); chime(); navigator.vibrate?.([80, 60, 80]); }
    setTimeout(() => el.classList.remove("on"), 2600);
  }

  /* poll for rings (and for the unlock) while the box waits to be opened */
  let pollTimer = null;
  function startPolling() {
    clearInterval(pollTimer);
    if (preview) return;
    pollTimer = setInterval(async () => {
      if (document.hidden || opened || !code) return;
      try {
        const m = await api(`gifts/${code}?poll=1`);
        if (m.ringAt && m.ringAt !== lastRing) { lastRing = m.ringAt; ringFx(); }
        if (meta?.locked && !m.locked) { meta = m; showOpen(); }
      } catch { /* try again later */ }
    }, 20000);
  }
  navigator.serviceWorker?.addEventListener("message", e => { if (e.data?.type === "xd:notification" && code && !opened) load(); });

  /* ---------- "let me know when I can unwrap it" (system notification) ---------- */
  let info = null;
  const subKey = () => `xd:sub:${code}`;
  async function setupNotify() {
    const btn = $("notifyLocked");
    info ??= await api("info").catch(() => ({}));
    const can = !!info.push && !preview && (window.XDpush.supported() || window.XDpush.iosNeedsInstall());
    btn.hidden = !can;
    if (!can) return;
    const on = store(subKey()) && window.Notification?.permission === "granted";
    btn.innerHTML = on ? "✓ Upozorním tě, až půjde rozbalit" : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0"/></svg><span>Upozornit mě<span class="long">, až půjde rozbalit</span></span>`;
    btn.disabled = !!on;
    scheduleFit();
  }
  $("notifyLocked").addEventListener("click", async () => {
    const btn = $("notifyLocked");
    btn.disabled = true;
    try {
      const endpoint = await window.XDpush.subscribe(info.push);
      await api(`gifts/${code}/subscribe`, { method: "POST", body: { endpoint } });
      store(subKey(), "1");
      say("Hotovo. Až dárek půjde rozbalit, přijde ti upozornění.");
    } catch (err) {
      say(err.message);
      btn.disabled = false;
    }
    setupNotify();
  });

  function showLocked(openAt) {
    show("locked");
    say("");
    $("lockedWhen").textContent = formatLong(openAt);
    setupNotify();
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
    renderRx();
  }

  async function load() {
    clearInterval(tick);
    if (!code) { showHub(); return; }
    show("loading"); say("");
    try {
      meta = await api(`gifts/${code}`);
      offset = Date.parse(meta.serverNow) - Date.now();
      preview = wantsPreview && meta.owner === true;
      applyTheme(meta.theme);
      W.apply(gift, meta.appearance);
      revealTheme();
      document.title = meta.title ? `${meta.title} · ${T.docTitle}` : T.docTitle;
      setLede();
      lastRing = meta.ringAt;
      if (meta.locked && !preview) showLocked(meta.openAt);
      else showOpen();
      if (delivered !== code) { delivered = code; deliver(T.delivery); }
      startPolling();
    } catch (err) {
      document.documentElement.classList.remove("pending-theme");
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
    else if (!states.hub.hidden) $("hubWrap").focus();
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
      if (res.token) store(key("t"), res.token);
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
  /* the photo / postcard inside the box */
  function photoHtml(g, delay) {
    const p = g.photo;
    if (!p) return "";
    const src = `api/gifts/${encodeURIComponent(g.code)}/photo?t=${encodeURIComponent(opened.token)}`;
    const ratio = p.w && p.h ? `${p.w} / ${p.h}` : "4 / 3";
    const cap = p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : "";
    const style = `animation-delay:${delay}s;--ratio:${ratio}`;
    return p.frame === "postcard"
      ? `<figure class="keepsake postcard" style="${style}">
          <a class="pc-img" href="${src}" target="_blank" rel="noopener" aria-label="Otevřít pohled v plné velikosti"><img src="${src}" alt="${esc(p.caption || "Pohled")}"></a>
          <div class="pc-back"><span class="pc-stamp" aria-hidden="true">✦</span>${cap || `<figcaption class="pc-empty">${esc(T.postcard)}</figcaption>`}</div>
        </figure>`
      : `<figure class="keepsake polaroid" style="${style}">
          <a href="${src}" target="_blank" rel="noopener" aria-label="Otevřít fotku v plné velikosti"><img src="${src}" alt="${esc(p.caption || "Fotka")}"></a>
          ${cap}
        </figure>`;
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
      // nothing to unwrap one by one (no items, or just one): no choice to make, show it all
      mode: g.items.length < 2 && g.reveal === "choice" ? "all"
        : g.reveal === "choice" ? (chosen === "all" || chosen === "sequential" ? chosen : null) : (g.reveal || "all"),
      view: "box"
    };
    if (!isPreview && token && rx.stream) rxStart(token);
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
    stage.style.removeProperty("--wbase");      // the unwrap scene has its own sizing
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
        <h2>${esc(g.title || T.defaultTitle)}</h2>
        <div class="ornament" aria-hidden="true">✦</div>
        ${g.message ? `<p class="note">${esc(g.message)}</p>` : ""}
        ${g.clip && (all || done) ? clipHtml(g) : ""}
        ${g.photo && (all || done) ? photoHtml(g, all ? .35 : 0) : ""}
        ${shown.length
          ? `<ol class="items">${shown.map((it, i) => itemHtml(it, i, all ? { delay: .45 + i * .16 } : { cls: i === fresh ? "flash" : "seen" })).join("")}</ol>`
          : (!all && mode ? `<p class="reveal-empty">Zatím nic. Rozbal první krabičku nahoře.</p>` : "")}
        ${g.signature && done ? `<p class="sign">${esc(g.signature)}</p>` : ""}
        <button class="link-btn" id="rewrap" type="button">Zabalit znovu</button>
      </article>
      ${done && !opened.preview ? ctaHtml() : ""}`;
    $("rewrap").addEventListener("click", rewrap);
    wireClip();
    if (done && !opened.preview) wireCta();
  }

  /* ---------- the creator's voice / video message ---------- */
  const R = window.XDrec;
  function clipHtml(g) {
    const audio = g.clip.kind === "audio";
    return `<div class="clip ${audio ? "audio" : "video"}" id="clipBox">
      <button type="button" class="btn small gold" id="clipPlay">▶ ${audio ? "Pustit hlasový vzkaz" : "Pustit video vzkaz"}${g.clip.duration ? ` (${R.clock(g.clip.duration)})` : ""}</button>
    </div>`;
  }
  function wireClip() {
    const box = $("clipBox");
    if (!box) return;
    const audio = opened.g.clip.kind === "audio";
    const show = autoplay => {
      box.innerHTML = audio ? `<audio controls preload="metadata"></audio>` : `<video controls playsinline preload="metadata"></video>`;
      const el = box.firstElementChild;
      R.fixLength(el);
      el.src = opened.clipUrl;
      if (autoplay) el.play().catch(() => { /* the browser wants another tap */ });
    };
    if (opened.clipUrl) { show(false); return; }
    $("clipPlay").addEventListener("click", async e => {
      const o = opened;
      e.target.disabled = true; e.target.textContent = "Načítám…";
      try {
        const r = await fetch(`api/gifts/${encodeURIComponent(o.g.code)}/clip?t=${encodeURIComponent(o.token || "")}`, { credentials: "same-origin" });
        if (!r.ok) throw new Error("clip");
        o.clipUrl = URL.createObjectURL(await r.blob());
        if (opened === o && $("clipBox")) show(true);
      } catch { e.target.disabled = false; e.target.textContent = "Vzkaz se nepodařilo načíst. Zkusit znovu"; }
    });
  }

  /* ---------- the unwrapping video ----------
     Only when the creator asked for it AND the recipient switches the camera on before unwrapping.
     Nothing leaves the device until the recipient has watched the video and pressed "Poslat". */
  const rx = { choice: null, stream: null, video: null, cams: [], rec: null, comp: null, pip: null, error: "" };
  const rxWanted = () => !!meta?.askReaction && !preview && R.supported("video");
  const CAM_ICON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6.5" width="12.5" height="11" rx="2"/><path d="M15.5 10.5l5-3v9l-5-3z"/></svg>`;
  const FLIP_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9a8 8 0 0 1 14-3.5L20 8M20 4v4h-4M20 15a8 8 0 0 1-14 3.5L4 16M4 20v-4h4"/></svg>`;

  function rxVideo() {
    if (!rx.video) {
      rx.video = document.createElement("video");
      rx.video.autoplay = true; rx.video.muted = true; rx.video.playsInline = true;
      rx.video.setAttribute("playsinline", "");
    }
    return rx.video;
  }
  const rxCamId = () => rx.stream?.getVideoTracks()[0]?.getSettings?.().deviceId || "";
  function rxMirror() {
    // the front camera looks right mirrored (the recording itself is never flipped)
    const f = R.facingOf(rx.stream);
    rxVideo().classList.toggle("mirror", f ? f === "user" : rx.cams.length < 2 || rx.cams[0]?.deviceId === rxCamId());
  }
  function rxOff() {
    R.stopStream(rx.stream);
    rx.stream = null;
    if (rx.video) rx.video.srcObject = null;
  }
  async function rxOn() {
    rx.error = "";
    try {
      rx.stream = await R.open({ video: true, audio: true, camera: "user" });
      rx.cams = await R.cameras();
      rxVideo().srcObject = rx.stream;
      rx.choice = "yes";
    } catch (err) { rx.error = R.explain(err); rx.stream = null; }
    renderRx();
  }
  /** another camera (also in the middle of a recording): `id` = a deviceId, or nothing for the next one */
  async function rxCamera(id) {
    if (!rx.stream || rx.switching) return;
    const cur = rxCamId();
    if (!id) {
      const i = rx.cams.findIndex(c => c.deviceId === cur);
      id = rx.cams.length > 1 ? rx.cams[(i + 1) % rx.cams.length].deviceId : (R.facingOf(rx.stream) === "user" ? "environment" : "user");
    }
    if (id === cur) return;
    rx.switching = true;
    const old = rx.stream.getVideoTracks();
    old.forEach(t => { t.stop(); rx.stream.removeTrack(t); });      // phones open one camera at a time
    let fresh = null;
    try { fresh = await R.open({ video: true, audio: false, camera: id }); }
    catch { try { fresh = await R.open({ video: true, audio: false, camera: "user" }); } catch { /* no camera left */ } }
    fresh?.getVideoTracks().forEach(t => rx.stream.addTrack(t));
    rxVideo().srcObject = rx.stream;
    rxVideo().play().catch(() => {});
    rx.switching = false;
    rxMirror();
    const sel = $("rxCam"); if (sel) sel.value = rxCamId();
    if (!fresh) say("Kameru se nepodařilo přepnout.");
  }

  function renderRx() {
    const el = $("rx");
    if (!rxWanted() || rx.rec) { el.hidden = true; el.innerHTML = ""; return; }
    el.hidden = false;
    const secs = meta.askReaction.seconds;
    if (rx.stream) {
      const opts = rx.cams.filter(c => c.deviceId).map((c, i) => `<option value="${esc(c.deviceId)}">${esc(c.label || `Kamera ${i + 1}`)}</option>`).join("");
      el.innerHTML = `
        <div class="rx-preview" id="rxPreview"></div>
        ${rx.cams.length > 1 ? `<label class="rx-cam"><span>Kamera</span><select id="rxCam" class="tag-input">${opts}</select></label>` : ""}
        <p class="rx-note"><b>Kamera je připravená, ještě se nenahrává.</b> Začne to, až dárek rozbalíš, a skončí nejpozději za ${secs} s. Kameru můžeš během nahrávání přepnout.</p>
        <button type="button" class="tag-link" id="rxCancel">Vypnout kameru, nenahrávat</button>`;
      $("rxPreview").append(rxVideo());
      rxVideo().play().catch(() => {});
      rxMirror();
      const sel = $("rxCam");
      if (sel) { sel.value = rxCamId(); sel.addEventListener("change", () => rxCamera(sel.value)); }
      $("rxCancel").addEventListener("click", () => { rxOff(); rx.choice = "no"; renderRx(); });
      $("openBtn").textContent = "Rozbalit a nahrávat";
    } else if (rx.choice === "no") {
      el.innerHTML = `<p class="rx-note">Rozbalování se nenahrává. <button type="button" class="tag-link inline" id="rxYes">Přece jen se natočit</button></p>`;
      $("rxYes").addEventListener("click", () => { rx.choice = null; renderRx(); });
      $("openBtn").textContent = "Rozbalit dárek";
    } else {
      el.innerHTML = `
        <p class="rx-title">${CAM_ICON}Natočíš, jak dárek rozbaluješ?</p>
        <p class="rx-note">Ten, kdo ti dárek zabalil, by rád viděl tvou radost.</p>
        <ul class="rx-list">
          <li>Potřebujeme <b>kameru a mikrofon</b>. Zapnou se, až to dovolíš, a nejdřív uvidíš náhled.</li>
          <li>Nahrává se od rozbalení, <b>nejvýš ${secs} s</b>.</li>
          <li>Video si pak <b>přehraješ a sám rozhodneš</b>, jestli ho pošleš. Uvidí ho jen dárce.</li>
        </ul>
        ${rx.error ? `<p class="rx-err" role="alert">${esc(rx.error)}</p>` : ""}
        <div class="rx-choice">
          <button type="button" class="btn small gold" id="rxOn">Zapnout kameru</button>
          <button type="button" class="tag-link" id="rxNo">Ne, díky</button>
        </div>`;
      $("rxOn").addEventListener("click", e => { e.target.disabled = true; e.target.textContent = "Čekám na povolení…"; rxOn(); });
      $("rxNo").addEventListener("click", () => { rx.choice = "no"; rx.error = ""; renderRx(); });
      $("openBtn").textContent = "Rozbalit dárek";
    }
    scheduleFit();
  }

  function rxStart(token) {
    const secs = meta.askReaction.seconds;
    const pip = document.createElement("div");
    pip.className = "rx-pip";
    pip.innerHTML = `
      <div class="rx-pip-video"></div>
      <div class="rx-pip-bar">
        <span class="rx-live"><i></i><span id="rxTime">0:00</span><small>/ ${R.clock(secs)}</small></span>
        ${rx.cams.length > 1 || matchMedia("(pointer: coarse)").matches ? `<button type="button" class="rx-btn" id="rxFlip" aria-label="Přepnout kameru" title="Přepnout kameru">${FLIP_ICON}</button>` : ""}
        <button type="button" class="rx-btn stop" id="rxStop">Hotovo</button>
      </div>`;
    document.body.append(pip);
    pip.firstElementChild.append(rxVideo());
    rxVideo().play().catch(() => {});
    rx.pip = pip;
    rx.comp = R.compose(rxVideo());
    const tracks = [...(rx.comp ? rx.comp.stream.getVideoTracks() : rx.stream.getVideoTracks()), ...rx.stream.getAudioTracks()];
    if (!rx.comp) pip.querySelector("#rxFlip")?.remove();          // without the canvas the camera can't change mid-recording
    try {
      rx.rec = R.record(new MediaStream(tracks), { kind: "video", maxSeconds: secs, maxBytes: meta.askReaction.bytes,
        onTick: t => { const el = pip.querySelector("#rxTime"); if (el) el.textContent = R.clock(t); } });
    } catch { rxEnd(); return; }
    pip.querySelector("#rxStop").addEventListener("click", () => rx.rec?.stop());
    pip.querySelector("#rxFlip")?.addEventListener("click", () => rxCamera());
    rx.rec.done.then(out => { rxEnd(); if (out.blob.size && out.duration >= 1) rxReview(out, token); }).catch(rxEnd);
    $("rx").hidden = true;
  }
  function rxEnd() {
    rx.comp?.stop(); rx.comp = null;
    rx.rec = null;
    rxOff();
    rx.pip?.remove(); rx.pip = null;
  }
  addEventListener("pagehide", () => { rx.comp?.stop(); rxOff(); });

  /** the recipient watches the video and decides: send it to the creator, or throw it away */
  function rxReview(out, token) {
    const url = URL.createObjectURL(out.blob);
    const dlg = document.createElement("dialog");
    dlg.className = "rx-dlg";
    dlg.innerHTML = `
      <div class="rx-dlg-card">
        <h3>Tvoje video z rozbalování</h3>
        <video controls playsinline src="${url}"></video>
        <p class="rx-note" id="rxDlgNote">Zatím ho máš jen ty. Pošleš ho tomu, kdo ti dárek zabalil?</p>
        <div class="rx-dlg-actions">
          <button type="button" class="btn small gold" id="rxSend">Poslat video</button>
          <a class="btn small ghost" id="rxSave" href="${url}" download="rozbalovani.${out.mime.includes("mp4") ? "mp4" : "webm"}">Uložit si ho</a>
          <button type="button" class="tag-link" id="rxDrop">Zahodit</button>
        </div>
      </div>`;
    document.body.append(dlg);
    R.fixLength(dlg.querySelector("video"));
    const close = () => { dlg.close(); dlg.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    dlg.addEventListener("cancel", e => e.preventDefault());        // Esc mustn't lose the video by accident
    dlg.querySelector("#rxDrop").addEventListener("click", close);
    dlg.querySelector("#rxSend").addEventListener("click", async e => {
      const btn = e.target, note = dlg.querySelector("#rxDlgNote");
      if (btn.dataset.done) { close(); return; }
      btn.disabled = true; btn.textContent = "Posílám…";
      try {
        const r = await fetch(`api/gifts/${encodeURIComponent(code)}/reaction`, {
          method: "POST", credentials: "same-origin", body: out.blob,
          headers: { "Content-Type": "application/octet-stream", "X-Gift-Token": token, "X-Media-Duration": String(out.duration) }
        });
        if (!r.ok) { const d = await r.json().catch(() => null); throw new Error(d?.message || "Video se nepodařilo odeslat."); }
        if (meta) meta.askReaction = null;
        note.textContent = "Odesláno. Dárce bude mít radost!";
        btn.disabled = false; btn.textContent = "Zavřít"; btn.dataset.done = "1";
        dlg.querySelector("#rxDrop").remove();
      } catch (err) {
        note.textContent = `${err.message} Zkus to znovu, nebo si video ulož.`;
        btn.disabled = false; btn.textContent = "Poslat znovu";
      }
    });
    dlg.showModal();
  }

  /* after everything is unwrapped: invite the recipient to wrap a present of their own */
  function ctaHtml() {
    const touch = matchMedia("(pointer: coarse)").matches;
    const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    const what = opened?.g.items.some(i => i.file) ? "k poukazům" : "k dárku";
    const keep = touch
      ? `Ať se ${what} kdykoli vrátíš, ulož si tuhle stránku do záložek nebo na plochu.`
      : `Ať se ${what} kdykoli vrátíš, ulož si tuhle stránku do záložek (<kbd>${mac ? "⌘" : "Ctrl"}</kbd> + <kbd>D</kbd>).`;
    return `<aside class="cta" aria-labelledby="ctaTitle">
      <p class="eyebrow ruled">${esc(T.workshop.join(" "))}</p>
      <h3 id="ctaTitle">Chceš taky někoho <em>obdarovat?</em></h3>
      <p class="cta-text">Zabal vlastní online dárek: pár překvapení, poukazy v PDF, heslo a čas, kdy půjde rozbalit. Zdarma a bez registrace.</p>
      <div class="cta-mail" id="ctaMail" hidden>
        <label for="ctaEmail" class="visually-hidden">Tvůj e-mail</label>
        <input id="ctaEmail" class="cta-input" type="email" maxlength="200" placeholder="tvůj e-mail (nepovinný)" autocomplete="email">
        <p class="cta-note">Pošleme ti na něj odkaz do dílny, ať o něj nepřijdeš.</p>
      </div>
      <a class="btn gold" id="ctaGo" href="dilna#nova" data-wrap data-wrap-back="Pokračovat do mé dílny">Zabalit svůj dárek</a>
      <p class="cta-keep">${keep}</p>
    </aside>`;
  }

  let infoP;
  const serverInfo = () => (infoP ??= api("info").catch(() => ({})));
  async function wireCta() {
    const go = $("ctaGo");
    // the typed address travels to the workshop's sign-up form (#nova=<e-mail>)
    go.addEventListener("click", () => {
      const e = $("ctaEmail").value.trim();
      if (go.getAttribute("href").startsWith("dilna#nova")) go.href = e ? `dilna#nova=${encodeURIComponent(e)}` : "dilna#nova";
    });
    $("ctaEmail").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); go.click(); } });
    const [w, info] = await Promise.all([wrapLinks(reveal), serverInfo()]);
    if (!w && info.mail && $("ctaMail")) $("ctaMail").hidden = false;
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
    scheduleFit();
  }

  footline();
  load();
})();
