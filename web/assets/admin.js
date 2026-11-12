import "./common.js";
import "./wrap.js";
import "./fx.js";
import "./themes.js";
import "./rec.js";

/* Ježíškova dílna – admin */
(function () {
  const { api: rawApi, normalizePassword, formatShort, formatWithYear, relative, plural, formatSize, esc, copy, appBase } = window.XD;
  const W = window.XDwrap;
  const TH = window.XDthemes;
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
      if (err.status === 401) {
        showLogin("Přihlášení tady už neplatí (odkaz mohl být vyměněn za nový). Otevři dílnu svým tajným odkazem.");
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

  /* ---------- workshop: create / open with the secret link / account ---------- */
  let ws = null;                                   // current workshop { id, name, email, key, … }

  /* ---------- occasion: Christmas / birthday / wedding / just because ----------
     The list shows every box; the filter under its heading narrows it to one occasion.
     The page takes the style of the open box (live while its occasion is being switched);
     with no box open it follows the filter, or stays neutral for "Vše". */
  const SHELF = {
    all: ["Všechny dárky", "Zatím tu není žádný dárek.", "Zabalit první dárek"],
    christmas: ["Pod stromečkem", "Pod stromečkem je zatím prázdno.", "Zabalit vánoční dárek"],
    birthday: ["Na oslavu", "Zatím tu není žádný narozeninový dárek.", "Zabalit dárek k narozeninám"],
    wedding: ["Na svatbu", "Zatím tu není žádný svatební dar.", "Připravit svatební dar"],
    general: ["Pro radost", "Zatím tu není žádný dárek pro radost.", "Zabalit dárek pro radost"]
  };
  const ALL_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></svg>`;
  const keyOfFilter = v => (v === "all" ? "all" : TH.THEMES[v] ? v : "all");
  let filter = (() => { try { return keyOfFilter(localStorage.getItem("xd:filter")); } catch { return "all"; } })();
  let showOpened = (() => { try { return localStorage.getItem("xd:showOpened") === "1"; } catch { return false; } })();
  let theme = TH.DEFAULT;          // the page's current style
  let TT = TH.get(theme);
  const restTheme = () => (filter === "all" ? TH.DEFAULT : filter);

  function applyTheme(k) {
    theme = TH.keyOf(k);
    TT = TH.applyPage(theme);
    const [a, b] = TT.workshop;
    $("brandName").innerHTML = `${esc(a)} <em>${esc(b)}</em>`;
    $("welcomeTitle").innerHTML = `${esc(a)} <em class="foil">${esc(b)}</em>`;
    document.title = ws ? `${ws.name} · ${a} ${b}` : `${a} ${b}`;
  }
  function renderFilter() {
    const opts = [["all", "Vše", ALL_ICON, list.length], ...Object.entries(TH.THEMES).map(([k, t]) => [k, t.name, TH.ICONS[k], list.filter(g => TH.keyOf(g.theme) === k).length])];
    $("themeFilter").innerHTML = opts.map(([k, name, icon, n]) =>
      `<button type="button" role="radio" data-k="${k}" aria-checked="${k === filter}" tabindex="${k === filter ? 0 : -1}" title="${esc(name)}">${icon}<span class="tname">${esc(name)}</span><span class="count">${n}</span></button>`).join("");
    const [eyebrow, empty, cta] = SHELF[filter];
    $("shelfEyebrow").textContent = eyebrow;
    $("shelfEmptyText").textContent = empty;
    $("newGiftEmpty").textContent = cta;
  }
  function setFilter(k) {
    filter = keyOfFilter(k);
    try { localStorage.setItem("xd:filter", filter); } catch { /* ignore */ }
    if (!draft) applyTheme(restTheme());
    renderList();
  }
  $("showOpened").addEventListener("change", e => {
    showOpened = e.target.checked;
    try { localStorage.setItem("xd:showOpened", showOpened ? "1" : "0"); } catch { /* ignore */ }
    renderList();
  });
  $("themeFilter").addEventListener("click", e => {
    const b = e.target.closest("[data-k]");
    if (b) setFilter(b.dataset.k);
  });
  $("themeFilter").addEventListener("keydown", e => {
    if (!["ArrowRight", "ArrowLeft"].includes(e.key)) return;
    e.preventDefault();
    const keys = ["all", ...Object.keys(TH.THEMES)], i = keys.indexOf(filter);
    setFilter(keys[(i + (e.key === "ArrowRight" ? 1 : -1) + keys.length) % keys.length]);
    $("themeFilter").querySelector('[aria-checked="true"]')?.focus();
  });

  /* the box's occasion: switching it restyles everything at once, saving makes it stick */
  $("fTheme").innerHTML = Object.entries(TH.THEMES).map(([k, t]) =>
    `<button type="button" role="radio" data-k="${k}">${TH.ICONS[k]}<span>${esc(t.name)}</span></button>`).join("");
  function setBoxTheme(k) {
    if (!draft) return;
    draft.theme = TH.keyOf(k);
    if (draft.theme !== "christmas" && mode === "christmas") { mode = "custom"; document.querySelectorAll('input[name="when"]').forEach(r => { r.checked = r.value === "custom"; }); }
    applyTheme(draft.theme);
    renderOccasion(); renderWhen(); renderLook(); updateDirty();
  }
  $("fTheme").addEventListener("click", e => {
    const b = e.target.closest("[data-k]");
    if (b) setBoxTheme(b.dataset.k);
  });
  $("fTheme").addEventListener("keydown", e => {
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key) || !draft) return;
    e.preventDefault();
    const keys = Object.keys(TH.THEMES), i = keys.indexOf(draft.theme);
    setBoxTheme(keys[(i + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1) + keys.length) % keys.length]);
    $("fTheme").querySelector('[aria-checked="true"]')?.focus();
  });
  applyTheme(restTheme());

  /* height of the sticky top bar (it wraps to two rows on phones): sticky things sit below it */
  const topbar = document.querySelector(".topbar");
  const setTopbarH = () => document.documentElement.style.setProperty("--topbar-h", `${topbar.offsetHeight}px`);
  if ("ResizeObserver" in window) new ResizeObserver(setTopbarH).observe(topbar);
  setTopbarH();

  /* what the server can do (e-mails are optional) */
  let info = { mail: false };
  rawApi("info").then(i => { info = i || info; applyInfo(); }, () => {});
  function applyInfo() {
    if (!info.mail) return;
    $("cEmailHint").textContent = "Pošleme ti na něj odkaz do dílny, ať o něj nepřijdeš. Nic jiného ti posílat nebudeme.";
    $("lostBtn").hidden = false;
    $("aEmail").placeholder = "kam poslat odkaz do dílny";
    $("aEmailHint").hidden = false;
  }
  const linkFor = key => `${appBase()}dilna#klic=${key}`;

  /** Accepts the whole link (…/dilna#klic=KEY), "klic=KEY" or just the key */
  function keyFrom(text) {
    const t = String(text || "").trim();
    const m = t.match(/klic=([A-Za-z0-9_-]{32})/) || t.match(/^([A-Za-z0-9_-]{32})$/);
    return m ? m[1] : null;
  }

  function showScreen(id) {
    for (const s of ["login", "created", "app"]) $(s).hidden = s !== id;
  }
  function showLogin(message = "") {
    ws = null;
    cur = draft = null; snapshot = "";
    try { $("acct").open && $("acct").close(); } catch { /* ignore */ }
    showScreen("login");
    $("loginMsg").textContent = message;
    $("loginMsg").classList.toggle("ok", false);
  }

  function setWorkshop(w) {
    const first = !ws || ws.id !== w.id;
    ws = w;
    $("brandSub").textContent = w.name;
    document.title = `${w.name} · ${TT.workshop.join(" ")}`;
  }

  async function busy(btn, fn) {
    btn.disabled = true;
    try { await fn(); } finally { btn.disabled = false; }
  }

  $("createForm").addEventListener("submit", e => {
    e.preventDefault();
    $("loginMsg").textContent = "";
    busy($("createBtn"), async () => {
      try {
        const body = { name: $("cName").value, email: $("cEmail").value };
        if (!$("cCodeWrap").hidden) body.signupCode = $("cCode").value;
        const res = await rawApi("workshop", { method: "POST", admin: true, body });
        setWorkshop(res.workshop);
        $("createdLink").textContent = linkFor(res.workshop.key);
        $("createdMailed").hidden = !res.mailed;
        if (res.mailed) $("createdMailed").textContent = `Odkaz jsme ti poslali i na ${res.workshop.email}. Kdyby nedorazil, mrkni do spamu. I tak si ho radši ulož.`;
        $("createdSaved").checked = false;
        $("createdGo").disabled = true;
        showScreen("created");
        window.XDfx?.burst(innerWidth / 2, innerHeight * .3, 120);
      } catch (err) {
        if (err.code === "bad_signup_code") {
          const first = $("cCodeWrap").hidden;
          $("cCodeWrap").hidden = false;
          $("cCode").focus();
          $("loginMsg").textContent = first ? "Zakládání dílen je jen pro pozvané. Zadej kód pro založení." : err.message;
        } else {
          $("loginMsg").textContent = err.message;
        }
      }
    });
  });

  $("createdCopy").addEventListener("click", async () => {
    if (await copy($("createdLink").textContent)) { toast("Odkaz zkopírován"); $("createdSaved").checked = true; $("createdGo").disabled = false; }
  });
  $("createdSaved").addEventListener("change", () => { $("createdGo").disabled = !$("createdSaved").checked; });
  $("createdGo").addEventListener("click", () => showApp());

  async function loginWithKey(key) {
    const res = await rawApi("workshop/login", { method: "POST", admin: true, body: { key } });
    setWorkshop(res.workshop);
    return res.workshop;
  }

  $("loginForm").addEventListener("submit", e => {
    e.preventDefault();
    $("loginMsg").textContent = "";
    const key = keyFrom($("loginKey").value);
    if (!key) { $("loginMsg").textContent = "Tohle nevypadá jako odkaz do dílny. Vlož celý odkaz, který začíná adresou webu a končí #klic=…"; return; }
    busy($("loginBtn"), async () => {
      try {
        await loginWithKey(key);
        $("loginKey").value = "";
        showApp();
      } catch (err) {
        $("loginMsg").textContent = err.message;
      }
    });
  });

  /* lost link → e-mail */
  function showLost(on) {
    $("loginForm").hidden = on;
    $("lostForm").hidden = !on;
    $("loginMsg").textContent = "";
    $("loginMsg").classList.remove("ok");
    setTimeout(() => (on ? $("lostEmail") : $("loginKey")).focus(), 30);
  }
  $("lostBtn").addEventListener("click", () => showLost(true));
  $("lostBack").addEventListener("click", () => showLost(false));
  $("lostForm").addEventListener("submit", e => {
    e.preventDefault();
    const email = $("lostEmail").value.trim();
    const msg = $("loginMsg");
    msg.classList.remove("ok");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.textContent = "Napiš e-mail, který máš u dílny uložený."; $("lostEmail").focus(); return; }
    busy($("lostSend"), async () => {
      try {
        await rawApi("workshop/recover", { method: "POST", admin: true, body: { email } });
        msg.textContent = `Pokud k adrese ${email} patří nějaká dílna, odkaz už ti letí e-mailem. Mrkni i do spamu.`;
        msg.classList.add("ok");
      } catch (err) {
        msg.textContent = err.message;
      }
    });
  });

  /* account panel */
  function fillAccount() {
    $("acctLink").textContent = ws.key ? linkFor(ws.key) : "Odkaz se nepodařilo načíst.";
    $("aName").value = ws.name || "";
    $("aEmail").value = ws.email || "";
    $("acctSend").hidden = !(info.mail && ws.email);
    $("aNotifyOpen").checked = ws.notifyOpen !== false;
    $("aNotifyOpen").disabled = !(info.mail && ws.email);
    $("aNotifyHint").textContent = !info.mail ? "Posílání e-mailů zatím není na serveru zapnuté."
      : !ws.email ? "Nejdřív níž vyplň svůj e-mail." : `Napíšeme na ${ws.email}, jen při prvním rozbalení každého dárku.`;
    renderPushBtn();
    const L = ws.limits || {};
    $("acctUsage").textContent = `Boxy ${ws.giftCount ?? list.length} z ${L.gifts ?? "?"} · PDF ${formatSize(ws.usedBytes || 0)} z ${formatSize(L.storageBytes || 0)}`;
  }
  $("accountBtn").addEventListener("click", async () => {
    try { setWorkshop((await api("workshop")).workshop); } catch (err) { if (err.status === 401) return; }
    fillAccount();
    $("acct").showModal();
  });
  $("acctClose").addEventListener("click", () => $("acct").close());
  $("acct").addEventListener("click", e => { if (e.target === $("acct")) $("acct").close(); });
  $("acctCopy").addEventListener("click", async () => { if (await copy($("acctLink").textContent)) toast("Odkaz zkopírován"); });

  $("acctForm").addEventListener("submit", e => {
    e.preventDefault();
    busy($("acctSave"), async () => {
      try {
        const res = await api("workshop", { method: "PUT", body: { name: $("aName").value, email: $("aEmail").value } });
        setWorkshop(res.workshop);
        fillAccount();
        toast("Uloženo");
      } catch (err) { if (err.status !== 401) toast(err.message, true); }
    });
  });

  $("aNotifyOpen").addEventListener("change", async e => {
    try { setWorkshop((await api("workshop", { method: "PUT", body: { notifyOpen: e.target.checked } })).workshop); toast("Uloženo"); }
    catch (err) { e.target.checked = !e.target.checked; if (err.status !== 401) toast(err.message, true); }
  });

  /* system notifications for the creator: "someone opened / unwrapped your box" */
  async function renderPushBtn() {
    const btn = $("acctPush"), hint = $("acctPushHint");
    const can = !!info.push && (window.XDpush.supported() || window.XDpush.iosNeedsInstall());
    btn.hidden = !can; hint.hidden = !can;
    if (!can) return;
    let on = false;
    try { on = !!(await window.XDpush.current()) && localStorage.getItem("xd:wsPush") === ws.id && Notification.permission === "granted"; } catch { /* ignore */ }
    btn.textContent = on ? "Vypnout upozornění v tomto prohlížeči" : "Zapnout upozornění v tomto prohlížeči";
    btn.dataset.on = on ? "1" : "";
    hint.textContent = on ? "Tenhle prohlížeč ti dá vědět, když někdo poprvé otevře nebo rozbalí tvůj dárek."
      : "Upozornění přijde i do systému (telefon, počítač), když někdo poprvé otevře nebo rozbalí tvůj dárek.";
  }
  $("acctPush").addEventListener("click", () => busy($("acctPush"), async () => {
    try {
      if ($("acctPush").dataset.on) {
        const sub = await window.XDpush.current();
        if (sub) await api("workshop/subscribe", { method: "DELETE", body: { endpoint: sub.endpoint } });
        try { localStorage.removeItem("xd:wsPush"); } catch { /* ignore */ }
        toast("Upozornění v tomto prohlížeči jsou vypnutá.");
      } else {
        const endpoint = await window.XDpush.subscribe(info.push);
        await api("workshop/subscribe", { method: "POST", body: { endpoint } });
        try { localStorage.setItem("xd:wsPush", ws.id); } catch { /* ignore */ }
        toast("Hotovo. Dáme ti vědět, až si někdo dárek otevře.");
      }
    } catch (err) { if (err.status !== 401) toast(err.message, true); }
    renderPushBtn();
  }));

  $("acctRotate").addEventListener("click", async () => {
    if (!(await confirmDialog({
      title: "Vyměnit tajný odkaz?",
      text: "Starý odkaz přestane fungovat a ostatní zařízení se z dílny odhlásí. Tady zůstaneš přihlášený a dostaneš nový odkaz.",
      ok: "Vyměnit"
    }))) return;
    try {
      const res = await api("workshop/rotate-key", { method: "POST" });
      setWorkshop(res.workshop);
      fillAccount();
      toast(res.mailed ? `Máš nový odkaz. Poslali jsme ti ho i na ${res.workshop.email}.` : "Máš nový odkaz. Ulož si ho.");
    } catch (err) { if (err.status !== 401) toast(err.message, true); }
  });

  $("acctSend").addEventListener("click", () => busy($("acctSend"), async () => {
    try {
      const res = await api("workshop/send-link", { method: "POST" });
      toast(`Odkaz jsme poslali na ${res.email}`);
    } catch (err) { if (err.status !== 401) toast(err.message, true); }
  }));

  $("logout").addEventListener("click", async () => {
    if (isDirty() && !(await confirmDialog({ title: "Odhlásit bez uložení?", text: "Neuložené změny v boxu se ztratí.", ok: "Odhlásit" }))) return;
    if (!(await confirmDialog({ title: "Odhlásit na tomhle zařízení?", text: "Zpátky se dostaneš jen tajným odkazem. Máš ho uložený?", ok: "Odhlásit" }))) return;
    try { await rawApi("workshop/logout", { method: "POST", admin: true }); } catch { /* ignore */ }
    showLogin("Odhlášeno. Do dílny se vrátíš svým tajným odkazem.");
  });

  $("acctDelete").addEventListener("click", async () => {
    if (!(await confirmDialog({
      title: `Smazat dílnu „${ws.name}“?`,
      text: `Smažou se všechny boxy (${ws.giftCount ?? list.length}) i nahraná PDF a odkazy na dárky přestanou fungovat. Tohle nejde vrátit.`,
      ok: "Smazat dílnu"
    }))) return;
    try {
      await api("workshop", { method: "DELETE" });
      showLogin("Dílna je smazaná.");
    } catch (err) { if (err.status !== 401) toast(err.message, true); }
  });

  /* ---------- app ---------- */
  async function showApp() {
    showScreen("app");
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

  const lockSvg = open => open
    ? `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 4.9-.7"/></svg>`
    : `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>`;

  function renderList() {
    const ul = $("giftList");
    const inTheme = filter === "all" ? list : list.filter(g => TH.keyOf(g.theme) === filter);
    const opened = inTheme.filter(g => g.stats?.opens);
    const shown = showOpened ? inTheme : inTheme.filter(g => !g.stats?.opens || (cur && g.code === cur.code));
    renderFilter();
    $("openedToggle").hidden = !opened.length;
    $("showOpened").checked = showOpened;
    $("openedCount").textContent = `(${opened.length})`;
    $("shelfCount").textContent = shown.length ? `${shown.length} ${plural(shown.length, "box", "boxy", "boxů")}` : "";
    $("shelfEmpty").hidden = shown.length > 0;
    if (!shown.length && inTheme.length) $("shelfEmptyText").textContent = "Všechny dárky tady už jsou rozbalené.";
    ul.innerHTML = shown.map(g => {
      const st = statusOf(g);
      const s = g.stats || {};
      const seen = s.opens ? `<span class="flag unwrapped" title="Poprvé rozbaleno ${esc(formatShort(s.firstOpenAt))}">Rozbaleno ${esc(formatShort(s.firstOpenAt))}</span>`
        : s.views ? `<span class="flag seen" title="Naposledy ${esc(formatShort(s.lastViewAt))}">Otevřeno ${s.views}×, nerozbaleno</span>` : "";
      return `<li>
        <button type="button" class="gl-item${cur && g.code === cur.code ? " active" : ""}${st.ok ? " open" : ""}" data-code="${esc(g.code)}">
          <span class="gl-box rb-${W.normalize(g.appearance).ribbonStyle}" style="--w:46px;${esc(styleVars(g.appearance))}" aria-hidden="true"><span class="lock-dot">${lockSvg(st.ok)}</span></span>
          <span class="gl-title">${filter === "all" ? `<span class="gl-occ" title="${esc(TH.get(g.theme).name)}">${TH.ICONS[TH.keyOf(g.theme)]}</span>` : ""}${esc(g.title)}</span>
          <span class="gl-sub"><span class="mono">${esc(g.code)}</span><span>${g.itemCount} ${plural(g.itemCount, "položka", "položky", "položek")}</span></span>
          <span class="gl-flags">
            <span class="flag lock ${st.ok ? "ok" : "wait"}" title="${st.ok ? "Obdarovaný si dárek může rozbalit" : "Obdarovaný si ho zatím nerozbalí"}">${lockSvg(st.ok)}${esc(st.text)}</span>
            ${seen}
            <span class="flag">${g.hasPassword ? "s heslem" : "bez hesla"}</span>
            ${g.showTitle ? "" : `<span class="flag">název skrytý</span>`}
            ${g.hasReaction ? `<span class="flag unwrapped" title="Obdarovaný poslal video z rozbalování">▶ video z rozbalování</span>` : ""}
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
    stopClipCapture();
    cur = null; draft = null; snapshot = "";
    applyTheme(restTheme());
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
      items: g.items.map(i => ({ id: i.id, name: i.name, description: i.description, file: i.file ? { ...i.file } : null })),
      photo: g.photo ? { file: { ...g.photo.file }, caption: g.photo.caption || "", frame: g.photo.frame || "polaroid" } : null,
      theme: TH.keyOf(g.theme), recipientEmail: g.recipientEmail || "",
      clip: g.clip ? { ...g.clip, file: { ...g.clip.file } } : null,
      askReaction: !!g.askReaction
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
    applyTheme(draft.theme);
    pw = { on: g.hasPassword, editing: !g.hasPassword, value: "" };
    for (const k in uploads) delete uploads[k];
    stopClipCapture();
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
    if (draft.theme === "christmas" && d.getMonth() === 11 && d.getDate() === 24 && d.getHours() === 18 && d.getMinutes() === 0) return "christmas";
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
    $("fTheme").querySelectorAll("[data-k]").forEach(b => { const on = b.dataset.k === draft.theme; b.setAttribute("aria-checked", on); b.tabIndex = on ? 0 : -1; });
    $("fRecipientEmail").value = draft.recipientEmail;
    renderOccasion();
    renderStats();
    renderLook();
    photoUpload = null;
    renderPhoto();
    clipState = null; renderClip();
    $("fAskReaction").checked = !!draft.askReaction;
    renderReaction();
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

  /* texts that follow the box's occasion: unlock choices, message hint, the ring button */
  function renderOccasion() {
    const T = TH.get(draft.theme);
    $("fTheme").querySelectorAll("[data-k]").forEach(b => { const on = b.dataset.k === draft.theme; b.setAttribute("aria-checked", on); b.tabIndex = on ? 0 : -1; });
    const card = v => document.querySelector(`input[name="when"][value="${v}"]`).closest(".when-card");
    card("christmas").hidden = draft.theme !== "christmas";
    card("custom").querySelector(".wc-title").textContent = T.when.custom[0];
    card("custom").querySelector(".wc-sub").textContent = T.when.custom[1];
    card("anytime").querySelector(".wc-sub").textContent = T.when.anytime;
    $("fMessage").placeholder = T.messagePh;
    $("ringLabel").textContent = T.ring.label;
    $("ringIcon").innerHTML = TH.RING_ICONS[draft.theme];
    $("recipientHint").textContent = info.mail
      ? "V čase odemčení mu pošleme e-mail s odkazem na dárek. Heslo v e-mailu nebude."
      : "Posílání e-mailů zatím není na serveru zapnuté. Adresa se uloží a použije, až ho zapneš.";
  }
  $("fRecipientEmail").addEventListener("input", e => { draft.recipientEmail = e.target.value; updateDirty(); });

  /* ---------- voice / video message (max 30 s): record here or pick a file ---------- */
  const R = window.XDrec;
  const MIC = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>`;
  const CAM = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6.5" width="12.5" height="11" rx="2"/><path d="M15.5 10.5l5-3v9l-5-3z"/></svg>`;
  const FILE = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V4M7.5 8.5L12 4l4.5 4.5"/><path d="M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14"/></svg>`;
  let clipState = null;      // null | { busy, mode: "lead"|"rec"|"upload", kind, stream, rec } | { error }
  let clipUrl = null, clipUrlFor = null;
  const clipMax = () => ws?.limits?.clipSeconds || 30;

  function stopClipCapture() {
    if (clipState?.rec) { clipState.cancelled = true; clipState.rec.stop(); }
    clearInterval(clipState?.lead);
    R.stopStream(clipState?.stream);
  }
  async function startClip(kind) {
    if (!R.supported(kind)) { clipState = { error: "Tenhle prohlížeč nahrávat neumí. Vyber hotový soubor." }; renderClip(); return; }
    let stream;
    try { stream = await R.open({ video: kind === "video", audio: true }); }
    catch (err) { clipState = { error: R.explain(err, kind === "video" ? "kameře a mikrofonu" : "mikrofonu") }; renderClip(); return; }
    const code = cur.code;
    clipState = { busy: true, mode: "lead", kind, stream, n: 3 };
    renderClip(); updateDirty();
    clipState.lead = setInterval(() => {
      if (!clipState || cur?.code !== code) return;
      if (--clipState.n > 0) { $("clipLead").textContent = clipState.n; return; }
      clearInterval(clipState.lead);
      const st = clipState;
      st.mode = "rec";
      st.rec = R.record(stream, { kind, maxSeconds: clipMax(), maxBytes: ws.limits.uploadBytes, onTick: el => {
        const left = Math.max(0, Math.ceil(clipMax() - el));
        for (const id of ["clipLeft", "clipLeft2"]) { const t = $(id); if (t) t.textContent = left; }
        const ring = $("clipRing"); if (ring) ring.style.setProperty("--p", el / clipMax());
      } });
      renderClip();
      st.rec.done.then(out => {
        R.stopStream(stream);
        if (st.cancelled || clipState !== st) return;
        uploadClip(out.blob, kind, out.duration, kind === "audio" ? "hlasový vzkaz" : "video vzkaz");
      }).catch(() => { R.stopStream(stream); clipState = { error: "Nahrávání se přerušilo. Zkus to znovu." }; renderClip(); updateDirty(); });
    }, 800);
  }
  async function pickClip(file) {
    if (!file) return;
    const kind = file.type.startsWith("audio/") ? "audio" : "video";
    if (file.size > ws.limits.uploadBytes) { clipState = { error: `Soubor má ${formatSize(file.size)}, nejvíc jde ${formatSize(ws.limits.uploadBytes)}. Zkus ho natočit přímo tady, vyjde menší.` }; renderClip(); return; }
    const d = await R.durationOf(file, kind);
    if (d && d > clipMax() + 1) { clipState = { error: `Vzkaz má ${Math.round(d)} s, nejvíc jde ${clipMax()} s.` }; renderClip(); return; }
    uploadClip(file, kind, d || 0, file.name);
  }
  function uploadClip(blob, kind, duration, name) {
    const code = cur.code;
    clipState = { busy: true, mode: "upload", progress: 0 };
    renderClip(); updateDirty();
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "api/admin/files");
    xhr.setRequestHeader("X-Admin", "1");
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(name));
    xhr.setRequestHeader("X-Media-Kind", kind);
    xhr.setRequestHeader("X-Media-Duration", String(duration || 0));
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = e => { const bar = document.querySelector("#clipArea .progress i"); if (bar && e.lengthComputable) bar.style.width = `${Math.round(e.loaded / e.total * 100)}%`; };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* not json */ }
      if (cur?.code !== code) return;
      if (xhr.status === 201 && data?.id) {
        clipState = null;
        draft.clip = { file: { id: data.id, name: data.name, size: data.size, type: data.type }, kind: data.type.startsWith("audio/") ? "audio" : "video", duration: data.duration };
        if (clipUrl) URL.revokeObjectURL(clipUrl);
        clipUrl = URL.createObjectURL(blob); clipUrlFor = data.id;
      } else if (xhr.status === 401) { clipState = null; showLogin("Přihlášení tady už neplatí. Otevři dílnu svým tajným odkazem."); }
      else clipState = { error: data?.message || `Nahrání se nepovedlo (chyba ${xhr.status}).` };
      renderClip(); updateDirty();
    };
    xhr.onerror = () => { clipState = { error: "Nahrání se nepovedlo. Zkontroluj připojení." }; renderClip(); updateDirty(); };
    xhr.send(blob);
  }
  /** the saved recording as a blob URL (works in every browser, no streaming needed) */
  async function mediaUrl(path) {
    const r = await fetch(`api/${path}`, { headers: { "X-Admin": "1" }, credentials: "same-origin" });
    if (!r.ok) throw new Error("media");
    return URL.createObjectURL(await r.blob());
  }
  function player(kind, url) {
    return kind === "audio" ? `<audio controls preload="metadata" src="${url}"></audio>` : `<video controls playsinline preload="metadata" src="${url}"></video>`;
  }
  function renderClip() {
    const area = $("clipArea");
    $("clipMax").textContent = clipMax();
    const st = clipState;
    if (st?.busy && st.mode === "upload") {
      area.innerHTML = `<div class="photo-drop busy"><span>Ukládám vzkaz…</span><span class="progress"><i style="width:0%"></i></span></div>`;
      return;
    }
    if (st?.busy) {
      area.innerHTML = `
        <div class="clip-rec ${st.kind}">
          ${st.kind === "video" ? `<video id="clipLive" autoplay muted playsinline></video>` : `<div class="clip-mic">${MIC}</div>`}
          <div class="clip-rec-bar">
            ${st.mode === "lead"
              ? `<span class="clip-lead">Začínáme za <b id="clipLead">${st.n}</b></span>`
              : `<span class="clip-ring" id="clipRing"><b id="clipLeft">${clipMax()}</b></span><span class="clip-live"><i></i>Nahrávám, zbývá&nbsp;<b id="clipLeft2">${clipMax()}</b>&nbsp;s</span>`}
            <button type="button" class="btn small gold" id="clipStop">${st.mode === "lead" ? "Zrušit" : "Hotovo"}</button>
            ${st.mode === "rec" ? `<button type="button" class="chip" id="clipCancel">Zahodit</button>` : ""}
          </div>
        </div>`;
      if (st.kind === "video") $("clipLive").srcObject = st.stream;
      $("clipStop").addEventListener("click", () => {
        if (st.mode === "lead") { stopClipCapture(); clipState = null; renderClip(); updateDirty(); }
        else st.rec.stop();
      });
      $("clipCancel")?.addEventListener("click", () => { stopClipCapture(); clipState = null; renderClip(); updateDirty(); });
      return;
    }
    const err = st?.error ? `<p class="photo-err" role="alert">${esc(st.error)}</p>` : "";
    if (!draft.clip) {
      area.innerHTML = `
        <div class="clip-start">
          <button type="button" class="clip-opt" data-rec="audio">${MIC}<b>Namluvit</b><small>jen hlas</small></button>
          <button type="button" class="clip-opt" data-rec="video">${CAM}<b>Natočit</b><small>video se zvukem</small></button>
          <button type="button" class="clip-opt" data-rec="file">${FILE}<b>Vybrat soubor</b><small>zvuk nebo video</small></button>
        </div>${err}`;
      area.querySelectorAll("[data-rec]").forEach(b => b.addEventListener("click", () => {
        if (b.dataset.rec === "file") { $("clipInput").value = ""; $("clipInput").click(); }
        else startClip(b.dataset.rec);
      }));
      return;
    }
    const c = draft.clip;
    area.innerHTML = `
      <div class="clip-have ${c.kind}">
        <div class="clip-player" id="clipPlayer"><span class="hint">Načítám vzkaz…</span></div>
        <div class="clip-meta">
          <span>${c.kind === "audio" ? MIC : CAM}<b>${c.kind === "audio" ? "Hlasový vzkaz" : "Video vzkaz"}</b>${c.duration ? ` · ${R.clock(c.duration)}` : ""} · ${formatSize(c.file.size)}</span>
          <button type="button" class="chip" id="clipRemove">Odebrat</button>
        </div>
      </div>${err}`;
    $("clipRemove").addEventListener("click", () => { draft.clip = null; clipState = null; renderClip(); updateDirty(); });
    const show = url => { const p = $("clipPlayer"); if (!p || draft.clip?.file.id !== c.file.id) return; p.innerHTML = player(c.kind, url); R.fixLength(p.firstElementChild); };
    if (clipUrlFor === c.file.id && clipUrl) show(clipUrl);
    else mediaUrl(`admin/files/${encodeURIComponent(c.file.id)}`).then(url => { if (clipUrl) URL.revokeObjectURL(clipUrl); clipUrl = url; clipUrlFor = c.file.id; show(url); })
      .catch(() => { const p = $("clipPlayer"); if (p) p.innerHTML = `<span class="hint">Vzkaz se nepodařilo načíst.</span>`; });
  }
  $("clipInput").addEventListener("change", e => pickClip(e.target.files[0]));

  /* ---------- the recipient's unwrapping video ---------- */
  let reactionUrl = null, reactionUrlFor = null;
  $("fAskReaction").addEventListener("change", e => { draft.askReaction = e.target.checked; updateDirty(); });
  function renderReaction() {
    const area = $("reactionArea"), r = cur.reaction;
    area.hidden = !r;
    if (!r) { area.innerHTML = ""; return; }
    area.innerHTML = `
      <div class="reaction">
        <div class="reaction-head"><b>Video z rozbalování</b><span>${esc(formatShort(r.at))}${r.duration ? ` · ${R.clock(r.duration)}` : ""} · ${formatSize(r.file.size)}</span></div>
        <div class="clip-player" id="reactionPlayer"><button type="button" class="btn small gold" id="reactionPlay">Přehrát video</button></div>
        <div class="reaction-actions">
          <a class="chip" id="reactionSave" hidden download="rozbalovani-${esc(cur.code)}.${r.file.type.includes("mp4") ? "mp4" : "webm"}">Stáhnout</a>
          <button type="button" class="chip" id="reactionDelete">Smazat video</button>
        </div>
      </div>`;
    const show = url => {
      const p = $("reactionPlayer"); if (!p) return;
      p.innerHTML = player("video", url); R.fixLength(p.firstElementChild);
      $("reactionSave").href = url; $("reactionSave").hidden = false;
    };
    const load = () => mediaUrl(`admin/gifts/${encodeURIComponent(cur.code)}/reaction`).then(url => { if (reactionUrl) URL.revokeObjectURL(reactionUrl); reactionUrl = url; reactionUrlFor = r.file.id; show(url); })
      .catch(() => toast("Video se nepodařilo načíst.", true));
    if (reactionUrlFor === r.file.id && reactionUrl) show(reactionUrl);
    else $("reactionPlay").addEventListener("click", e => { e.target.disabled = true; e.target.textContent = "Načítám…"; load(); });
    $("reactionDelete").addEventListener("click", async () => {
      if (!(await confirmDialog({ title: "Smazat video z rozbalování?", text: "Video se smaže natrvalo. Obdarovaný ho může natočit znovu, když dárek zabalí a rozbalí.", ok: "Smazat video" }))) return;
      try {
        await api(`admin/gifts/${encodeURIComponent(cur.code)}/reaction`, { method: "DELETE" });
        cur.reaction = null;
        renderReaction(); updateDirty(); loadList();
        toast("Video smazáno");
      } catch (err) { if (err.status !== 401) toast(err.message, true); }
    });
  }

  /* who looked: views and unwraps (the creator's own visits don't count) */
  function renderStats() {
    const s = cur.stats || {};
    const eye = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`;
    const box = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3.5" y="9" width="17" height="11.5" rx="1.5"/><path d="M2.5 6.5h19V9h-19zM12 6.5v14"/></svg>`;
    const parts = [];
    if (!s.views && !s.opens) parts.push(`<span class="stat">${eye}Odkaz zatím nikdo neotevřel</span>`);
    else {
      parts.push(`<span class="stat">${eye}<span>Otevřeno <b>${s.views}×</b>${s.firstViewAt ? `, poprvé ${esc(formatShort(s.firstViewAt))}` : ""}${s.views > 1 ? `, naposledy ${esc(formatShort(s.lastViewAt))}` : ""}</span></span>`);
      parts.push(s.opens
        ? `<span class="stat ok">${box}<span><b>Rozbaleno</b> ${esc(formatShort(s.firstOpenAt))}${s.opens > 1 ? ` (${s.opens}×)` : ""}</span></span>`
        : `<span class="stat">${box}Zatím nerozbaleno</span>`);
    }
    if (cur.notifiedAt) parts.push(`<span class="stat">✉ Upozornění odešlo ${esc(formatShort(cur.notifiedAt))}</span>`);
    $("statsLine").innerHTML = parts.join("");
  }

  /* "Zazvonit zvonečkem" */
  $("ringBtn").addEventListener("click", () => busy($("ringBtn"), async () => {
    if (isDirty() && draft.recipientEmail.trim() !== (cur.recipientEmail || "")) { toast("Nejdřív ulož e-mail obdarovaného.", true); return; }
    const btn = $("ringBtn");
    btn.classList.remove("ringing"); void btn.offsetWidth; btn.classList.add("ringing");
    try {
      const r = await api(`admin/gifts/${encodeURIComponent(cur.code)}/ring`, { method: "POST" });
      const T = TH.get(cur.theme);
      const how = [r.mailed && "e-mailem", r.pushed && `upozorněním (${r.pushed}×)`].filter(Boolean).join(" a ");
      toast(how ? `${T.ring.done} Dali jsme vědět ${how}.` : `${T.ring.done} Uslyší to, pokud má dárek otevřený.`);
    } catch (err) { if (err.status !== 401) toast(err.message, true); }
  }));

  function updateDirty() {
    const dirty = isDirty();
    $("savebar").classList.toggle("dirty", dirty);
    $("savebar").classList.toggle("saving", saving);
    $("saveState").textContent = saving ? "Ukládám…" : dirty ? "Uložit změny" : "Uloženo";
    $("save").disabled = !dirty || saving;
    $("save").title = dirty ? "Neuložené změny · Ctrl+S" : "Všechno je uložené";
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
  /* patterns + decorations come in groups by occasion: the general ones always (no heading),
     the box's occasion unfolded, the others folded */
  function grouped(el, map, cls, item) {
    el.classList.add("pick-groups");
    const by = g => Object.entries(map).filter(([, v]) => v.g === g);
    el.innerHTML = `<div class="${cls}">${by("general").map(item).join("")}</div>` + W.GROUPS.filter(g => g !== "general").map(g =>
      `<details class="pick-group" data-g="${g}"><summary>${TH.ICONS[g]}<span>${esc(TH.get(g).name)}</span><span class="count">${by(g).length}</span></summary><div class="${cls}">${by(g).map(item).join("")}</div></details>`).join("");
  }
  const groupState = new Map();          // picker → "<code>:<theme>" the folds were last arranged for
  function arrangeGroups(el, selectedG) {
    const sig = `${cur?.code}:${draft.theme}`;
    if (groupState.get(el) === sig) return;
    groupState.set(el, sig);
    const groups = [...el.querySelectorAll(".pick-group")];
    groups.sort((x, y) => (y.dataset.g === draft.theme) - (x.dataset.g === draft.theme) || W.GROUPS.indexOf(x.dataset.g) - W.GROUPS.indexOf(y.dataset.g));
    for (const d of groups) { el.appendChild(d); d.open = d.dataset.g === draft.theme || d.dataset.g === selectedG; }
  }
  grouped($("patternPicker"), W.PATTERNS, "swatches tiles", ([k, v]) =>
    `<button type="button" class="sw tile" role="radio" data-k="${k}" aria-label="${esc(v.name)}" title="${esc(v.name)}"><span>${esc(v.name)}</span></button>`);
  for (const [el, field, keys] of [[$("patternPicker"), "pattern", Object.keys(W.PATTERNS)]]) {
    el.addEventListener("click", e => {
      const b = e.target.closest("[data-k]");
      if (!b || !draft) return;
      draft.appearance[field] = b.dataset.k;
      renderLook(); updateDirty();
    });
    el.addEventListener("keydown", e => {
      if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key) || !draft || !e.target.closest("[data-k]")) return;
      e.preventDefault();
      const shown = [...el.querySelectorAll("[data-k]")].filter(b => b.offsetParent).map(b => b.dataset.k);
      const list = shown.length ? shown : keys, i = list.indexOf(draft.appearance[field]);
      draft.appearance[field] = list[(i + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length];
      renderLook(); updateDirty();
      el.querySelector(`[data-k="${draft.appearance[field]}"]`)?.focus();
    });
  }
  buildPicker($("ribbonPicker"), Object.entries(W.RIBBONS), "ribbon", "ribbon");

  /* pattern colour: any of them, the paper's own colour too (tone on tone, its sheen makes it show) */
  const INK_ORDER = ["paper", "white", "cream", "gold", "silver", "bronze", "red", "pink", "green", "mint", "sky", "navy", "lilac", "brown", "black"];
  let inkKeys = [], inkPaper = "";
  function buildInks() {
    const a = draft.appearance;
    if (inkPaper === a.paper && inkKeys.length) return;
    inkPaper = a.paper;
    const sug = W.PAPERS[a.paper].inks;
    inkKeys = INK_ORDER.filter(k => W.INKS[k]);
    $("inkPicker").innerHTML = inkKeys.map(k =>
      `<button type="button" class="sw ink${k === "paper" ? " tone" : ""}${sug.includes(k) ? " fits" : ""}" role="radio" data-k="${k}" aria-label="${esc(W.INKS[k].name)}" title="${esc(W.INKS[k].name)}${sug.includes(k) ? " · sedí k papíru" : ""}" style="--ink:rgb(${W.inkRgb(k, a.paper)})"></button>`).join("");
  }
  $("inkPicker").addEventListener("click", e => {
    const b = e.target.closest("[data-k]");
    if (!b || !draft) return;
    // the paper's own default stays "automatic", so changing the paper later still picks a fitting colour
    draft.appearance.patternColor = b.dataset.k === W.PAPERS[draft.appearance.paper].inks[0] ? null : b.dataset.k;
    renderLook(); updateDirty();
  });
  $("inkPicker").addEventListener("keydown", e => {
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key) || !draft) return;
    e.preventDefault();
    const cur = W.inkOf(draft.appearance).key, i = inkKeys.indexOf(cur);
    const next = inkKeys[(i + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1) + inkKeys.length) % inkKeys.length];
    draft.appearance.patternColor = next === W.PAPERS[draft.appearance.paper].inks[0] ? null : next;
    renderLook(); updateDirty();
    $("inkPicker").querySelector(`[data-k="${next}"]`)?.focus();
  });
  let opacityTick = 0;
  $("fOpacity").addEventListener("input", () => {
    if (!draft) return;
    const v = Number($("fOpacity").value);
    draft.appearance.patternOpacity = v;
    $("opacityOut").textContent = `${v} %`;
    $("fOpacity").style.setProperty("--fill", `${(v - W.OPACITY.min) / (W.OPACITY.max - W.OPACITY.min) * 100}%`);
    updateDirty();
    // swap the previews only once the new tile is decoded, skipping steps the slider has already passed
    const id = ++opacityTick;
    W.ready(draft.appearance).then(() => { if (id === opacityTick && draft) renderLook(); });
  });

  /* bow + decoration */
  $("bowPicker").innerHTML = Object.entries(W.BOWS).map(([k, v]) => `<button type="button" class="chip-pick" role="radio" data-k="${k}">${esc(v.name)}</button>`).join("");
  grouped($("decoPicker"), W.DECOS, "deco-pick", ([k, v]) =>
    `<button type="button" class="deco-sw" role="radio" data-k="${k}" aria-label="${esc(v.name)}" title="${esc(v.name)}">${W.DECO_SVG[k] || `<svg viewBox="0 0 100 70" aria-hidden="true"><path d="M30 20l40 30M70 20L30 50" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity=".45"/></svg>`}</button>`);
  for (const [id, field] of [["bowPicker", "bow"], ["decoPicker", "deco"]]) {
    const el = $(id), keys = Object.keys(field === "bow" ? W.BOWS : W.DECOS);
    el.addEventListener("click", e => {
      const b = e.target.closest("[data-k]");
      if (!b || !draft) return;
      draft.appearance[field] = b.dataset.k;
      renderLook(); updateDirty();
      if (!reduce && field !== "bow") { lookGift.classList.remove("pop"); void lookGift.offsetWidth; lookGift.classList.add("pop"); }
    });
    el.addEventListener("keydown", e => {
      if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key) || !draft || !e.target.closest("[data-k]")) return;
      e.preventDefault();
      const shown = [...el.querySelectorAll("[data-k]")].filter(b => b.offsetParent).map(b => b.dataset.k);
      const list = shown.length ? shown : keys, i = list.indexOf(draft.appearance[field]);
      draft.appearance[field] = list[(i + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length];
      renderLook(); updateDirty();
      el.querySelector(`[data-k="${draft.appearance[field]}"]`)?.focus();
    });
  }
  $("stylePicker").innerHTML = Object.entries(W.RIBBON_STYLES).map(([k, name]) =>
    `<button type="button" role="radio" data-k="${k}"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="1" y="1" width="12" height="12" rx="1.5" fill="none" stroke="currentColor"/>${
      k === "cross" ? `<path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="2"/>` : k === "single" ? `<path d="M7 1v12" stroke="currentColor" stroke-width="2"/>` : ""}</svg>${esc(name)}</button>`).join("");
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
    mark($("bowPicker"), a.bow);
    mark($("decoPicker"), a.deco);
    arrangeGroups($("patternPicker"), W.PATTERNS[a.pattern].g);
    arrangeGroups($("decoPicker"), W.DECOS[a.deco].g);
    $("paperName").textContent = W.PAPERS[a.paper].name;
    $("patternName").textContent = W.PATTERNS[a.pattern].name;
    $("ribbonName").textContent = W.RIBBONS[a.ribbon].name;
    $("decoName").textContent = a.deco === "none" ? "" : W.DECOS[a.deco].name;
    // pattern colour + strength (nothing to colour on plain paper)
    const ink = W.inkOf(a);
    $("inkRow").hidden = a.pattern === "plain";
    buildInks();
    mark($("inkPicker"), ink.key);
    $("inkName").textContent = W.INKS[ink.key].name;
    $("fOpacity").value = ink.opacity;
    $("opacityOut").textContent = `${ink.opacity} %`;
    $("fOpacity").style.setProperty("--fill", `${(ink.opacity - W.OPACITY.min) / (W.OPACITY.max - W.OPACITY.min) * 100}%`);
  }

  /* ---------- photo / postcard ---------- */
  let photoUpload = null;   // { progress } | { error }
  const PHOTO_MAX = 1600;   // px, longer side

  /** Downscales in the browser: smaller upload, and the re-encode drops EXIF (incl. GPS position) */
  async function shrinkImage(file) {
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); }
    catch { throw new Error(`„${file.name}“ se nepodařilo otevřít. Zkus fotku ve formátu JPEG nebo PNG.`); }
    const k = Math.min(1, PHOTO_MAX / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);          // transparent PNG → white, not black
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const blob = await new Promise(r => c.toBlob(r, "image/jpeg", .86));
    if (!blob) throw new Error("Fotku se nepodařilo zpracovat.");
    return { blob, w, h };
  }

  async function uploadPhoto(file) {
    if (!file) return;
    if (file.type && !file.type.startsWith("image/")) { photoUpload = { error: `„${file.name}“ není obrázek.` }; renderPhoto(); return; }
    photoUpload = { progress: 0 };
    renderPhoto(); updateDirty();
    let img;
    try { img = await shrinkImage(file); }
    catch (err) { photoUpload = { error: err.message }; renderPhoto(); updateDirty(); return; }
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "api/admin/files");
    xhr.setRequestHeader("X-Admin", "1");
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name.replace(/\.[^.]+$/, "") + ".jpg"));
    xhr.setRequestHeader("X-Image-Width", String(img.w));
    xhr.setRequestHeader("X-Image-Height", String(img.h));
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = e => {
      if (!e.lengthComputable || !photoUpload) return;
      photoUpload.progress = e.loaded / e.total;
      const bar = $("photoArea").querySelector(".progress i");
      if (bar) bar.style.width = `${Math.round(photoUpload.progress * 100)}%`;
    };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* not json */ }
      if (xhr.status === 201 && data?.id) {
        photoUpload = null;
        draft.photo = { file: { id: data.id, name: data.name, size: data.size, type: data.type, w: data.w, h: data.h }, caption: draft.photo?.caption || "", frame: draft.photo?.frame || "polaroid" };
        toast("Fotka nahraná. Nezapomeň box uložit.");
      } else if (xhr.status === 401) {
        photoUpload = null;
        showLogin("Přihlášení vypršelo. Přihlas se prosím znovu.");
        return;
      } else {
        photoUpload = { error: data?.message || (xhr.status === 413 ? "Fotka je na server příliš velká." : `Nahrání se nepovedlo (chyba ${xhr.status}).`) };
      }
      renderPhoto(); updateDirty();
    };
    xhr.onerror = () => { photoUpload = { error: "Nahrání se nepovedlo. Zkontroluj připojení." }; renderPhoto(); updateDirty(); };
    xhr.send(img.blob);
  }

  function renderPhoto() {
    const area = $("photoArea"), p = draft.photo;
    if (photoUpload && !photoUpload.error) {
      area.innerHTML = `<div class="photo-drop busy"><span>Zmenšuju a nahrávám fotku…</span><span class="progress"><i style="width:${Math.round((photoUpload.progress || 0) * 100)}%"></i></span></div>`;
      return;
    }
    const err = photoUpload?.error ? `<p class="photo-err" role="alert">${esc(photoUpload.error)}</p>` : "";
    if (!p) {
      area.innerHTML = `<button type="button" class="photo-drop" id="photoPick">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 8"/></svg>
          <span><b>Vložit fotku</b> nebo ji sem přetáhni</span>
          <small>JPEG, PNG nebo WebP. Zmenšíme ji a odstraníme z ní údaje o místě pořízení.</small>
        </button>${err}`;
    } else {
      const src = `api/admin/files/${encodeURIComponent(p.file.id)}`;
      area.innerHTML = `<div class="photo-edit">
          <figure class="photo-thumb ${p.frame}"><img src="${src}" alt="" loading="lazy"></figure>
          <div class="photo-fields">
            <div class="picker">
              <span class="label">Podoba</span>
              <div class="segmented" id="frameSeg" role="radiogroup" aria-label="Podoba fotky">
                ${Object.entries(W.PHOTO_FRAMES).map(([k, n]) => `<button type="button" role="radio" data-k="${k}" aria-checked="${k === p.frame}">${esc(n)}</button>`).join("")}
              </div>
            </div>
            <div class="field">
              <label class="label" for="fCaption">${p.frame === "postcard" ? "Věnování na pohled" : "Popisek pod fotkou"}</label>
              <input id="fCaption" class="input" type="text" maxlength="200" placeholder="${p.frame === "postcard" ? "např. Ať se ti splní, co si přeješ" : "např. Krkonoše, léto 2025"}">
            </div>
            <div class="photo-actions">
              <button type="button" class="chip" id="photoReplace">Vyměnit fotku</button>
              <button type="button" class="chip danger" id="photoRemove">Odebrat</button>
            </div>
          </div>
        </div>${err}`;
      $("fCaption").value = p.caption;
      $("fCaption").addEventListener("input", e => { draft.photo.caption = e.target.value; updateDirty(); });
      $("frameSeg").addEventListener("click", e => {
        const b = e.target.closest("[data-k]");
        if (!b) return;
        draft.photo.frame = b.dataset.k;
        renderPhoto(); updateDirty();
      });
      $("photoReplace").addEventListener("click", () => $("photoInput").click());
      $("photoRemove").addEventListener("click", () => { draft.photo = null; photoUpload = null; renderPhoto(); updateDirty(); });
    }
    $("photoPick")?.addEventListener("click", () => $("photoInput").click());
  }
  $("photoInput").addEventListener("change", e => { const f = e.target.files?.[0]; e.target.value = ""; uploadPhoto(f); });
  $("photoBlock").addEventListener("dragover", e => { if (draft && e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); $("photoBlock").classList.add("drag"); } });
  $("photoBlock").addEventListener("dragleave", e => { if (!$("photoBlock").contains(e.relatedTarget)) $("photoBlock").classList.remove("drag"); });
  $("photoBlock").addEventListener("drop", e => {
    $("photoBlock").classList.remove("drag");
    const f = e.dataTransfer?.files?.[0];
    if (!f || !draft) return;
    e.preventDefault();
    uploadPhoto(f);
  });

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
  /** checks the draft before it goes to the server; false = told the user what's missing */
  function readyToSend() {
    if (Object.values(uploads).some(u => !u.error)) { toast("Počkej, až se PDF nahraje.", true); return false; }
    if (photoUpload && !photoUpload.error) { toast("Počkej, až se fotka nahraje.", true); return false; }
    if (clipState?.busy) { toast("Nejdřív dokonči nahrávání vzkazu.", true); return false; }
    if (pw.on && !cur.hasPassword && !pw.value) {
      $("fPw").classList.add("invalid");
      $("fPw").focus();
      $("fPw").scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
      toast("Zadej heslo, nebo ochranu heslem vypni.", true);
      return false;
    }
    if (!draft.anytime && isNaN(Date.parse(draft.openAt))) { toast("Doplň datum a čas odemčení.", true); $("fOpenAt").focus(); return false; }
    return true;
  }
  /** the PUT body for the draft; newPw = the password typed in, if any */
  function draftBody() {
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
      items: draft.items.map(i => ({ id: i.id, name: i.name.trim(), description: i.description.trim(), file: i.file ? { id: i.file.id } : null })),
      photo: draft.photo ? { file: { id: draft.photo.file.id }, caption: draft.photo.caption.trim(), frame: draft.photo.frame } : null,
      clip: draft.clip ? { file: { id: draft.clip.file.id } } : null,
      askReaction: !!draft.askReaction,
      theme: draft.theme,
      recipientEmail: draft.recipientEmail.trim()
    };
    let newPw = null;
    if (!pw.on && cur.hasPassword) body.password = null;
    if (pw.on && pw.value) { newPw = normalizePassword(pw.value); body.password = newPw; }
    return { body, newPw };
  }

  async function save() {
    if (!draft || saving || !isDirty()) return;
    if (!readyToSend()) return;
    const { body, newPw } = draftBody();

    const movedTo = draft.theme !== TH.keyOf(cur.theme) ? draft.theme : null;   // the box was moved to another occasion
    saving = true; updateDirty();
    try {
      const g = await api(`admin/gifts/${encodeURIComponent(cur.code)}`, { method: "PUT", body });
      if (newPw) fresh[g.code] = newPw;
      if (body.password === null) delete fresh[g.code];
      saving = false;
      setCurrent(g);
      await loadList();
      if (movedTo && filter !== "all" && movedTo !== filter) setFilter(movedTo);   // keep the box in sight
      toast("Uloženo");
    } catch (err) {
      saving = false; updateDirty();
      if (err.status !== 401) toast(err.message, true);
    }
  }

  $("save").addEventListener("click", save);

  /* duplicate: a copy with a new code opens right away; unsaved edits move over to the copy */
  async function duplicate() {
    if (!cur || saving) return;
    const dirty = isDirty();
    if (dirty && !readyToSend()) return;
    if (!(await confirmDialog(dirty ? {
      title: "Duplikovat i s neuloženými změnami?",
      text: `Kopie dostane všechno, co máš teď rozpracované. „${cur.title}“ zůstane tak, jak byl naposledy uložený, a neuložené změny se v něm neuloží.`,
      ok: "Duplikovat se změnami"
    } : {
      title: `Duplikovat „${cur.title}“?`,
      text: "Vznikne kopie s novým kódem a stejným obsahem, vzhledem i heslem. E-mail obdarovaného a statistiky se nepřenesou.",
      ok: "Duplikovat"
    }))) return;
    saving = true; updateDirty();
    const from = cur.code;
    let copy = null;
    try {
      copy = await api(`admin/gifts/${encodeURIComponent(from)}/duplicate`, { method: "POST" });
      let g = copy;
      if (dirty) {
        const { body, newPw } = draftBody();
        body.title = `${body.title} (kopie)`.slice(0, 120);
        body.recipientEmail = "";
        g = await api(`admin/gifts/${encodeURIComponent(copy.code)}`, { method: "PUT", body });
        if (newPw) fresh[g.code] = newPw;
        else if (body.password !== null && fresh[from]) fresh[g.code] = fresh[from];
      } else if (fresh[from]) fresh[g.code] = fresh[from];
      saving = false;
      setCurrent(g);
      await loadList();
      if (filter !== "all" && TH.keyOf(g.theme) !== filter) setFilter(g.theme);
      $("layout").classList.add("show-editor");
      scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
      const ti = $("fTitle");
      ti.focus({ preventScroll: true }); ti.select();
      toast(`Kopie je připravená. Kód ${g.code}`);
    } catch (err) {
      saving = false; updateDirty();
      // the edits didn't make it into the copy: don't leave a half-made copy behind
      if (copy) { try { await api(`admin/gifts/${encodeURIComponent(copy.code)}`, { method: "DELETE" }); } catch { /* ignore */ } }
      if (err.status !== 401) toast(err.message, true);
    }
  }
  $("dupGift").addEventListener("click", duplicate);
  $("discard").addEventListener("click", async () => {
    if (await confirmDialog({ title: "Vrátit neuložené změny?", text: "Box se vrátí do stavu z posledního uložení. Smazaný nebude.", ok: "Vrátit změny" })) { setCurrent(cur); toast("Změny vráceny"); }
  });

  /* ---------- share / send ---------- */
  const giftUrl = () => appBase() + cur.code;
  const SHARE_LEAD = { christmas: "Ježíšek ti nechal dárek 🎄", birthday: "Mám pro tebe dárek k narozeninám 🎂", wedding: "Máme pro vás svatební dar 💍", general: "Mám pro tebe dárek 🎁" };
  function shareText() {
    const pwTxt = cur.hasPassword ? (fresh[cur.code] ? ` Heslo: ${fresh[cur.code]}` : " Heslo ti řeknu zvlášť.") : "";
    return `${SHARE_LEAD[TH.keyOf(cur.theme)]} Rozbalíš ho tady: ${giftUrl()} (kód ${cur.code}).${pwTxt}`;
  }
  function openShare() {
    if (!cur) return;
    const st = statusOf(cur);
    $("shareCode").textContent = cur.code;
    $("shareUrl").textContent = giftUrl();
    $("shareUnsaved").hidden = !isDirty();
    $("sharePw").textContent = !cur.hasPassword ? "Dárek je bez hesla: stačí odkaz nebo kód."
      : fresh[cur.code] ? `Heslo: ${fresh[cur.code]} (pošli ho třeba zvlášť, nebo napiš do přáníčka).`
      : "Dárek je chráněný heslem. To mu řekni zvlášť, v odkazu není.";
    $("shareWhen").textContent = st.ok ? "Dárek už jde rozbalit." : `${st.text}. Do té doby uvidí jen odpočet.`;
    $("shareNative").hidden = !navigator.share;
    $("sharePreview").href = `${giftUrl()}?preview=1`;
    $("shareMail").href = `mailto:${encodeURIComponent(cur.recipientEmail || "")}?subject=${encodeURIComponent("Mám pro tebe dárek")}&body=${encodeURIComponent(shareText())}`;
    $("shareDlg").showModal();
  }
  $("shareBtn").addEventListener("click", openShare);
  $("shareInline").addEventListener("click", openShare);
  $("shareClose").addEventListener("click", () => $("shareDlg").close());
  $("shareDlg").addEventListener("click", e => { if (e.target === $("shareDlg")) $("shareDlg").close(); });
  $("shareCopyLink").addEventListener("click", async () => { if (await copy(giftUrl())) toast("Odkaz zkopírován"); });
  $("shareCopyText").addEventListener("click", async () => { if (await copy(shareText())) toast("Zkopírováno i se vzkazem"); });
  $("shareNative").addEventListener("click", async () => {
    try { await navigator.share({ title: cur.showTitle ? cur.title : "Dárek", text: shareText(), url: giftUrl() }); }
    catch (err) { if (err?.name !== "AbortError") toast("Sdílení se nepovedlo, zkopíruj odkaz.", true); }
  });
  document.addEventListener("keydown", e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && !$("editor").hidden) { e.preventDefault(); save(); }
  });
  addEventListener("beforeunload", e => { if (isDirty()) { e.preventDefault(); e.returnValue = ""; } });

  async function createGift() {
    if (isDirty() && !(await confirmDialog({ title: "Zahodit neuložené změny?", text: `V boxu „${draft.title}“ máš neuložené změny.`, ok: "Zahodit" }))) return;
    try {
      // other occasions than Christmas: tomorrow at 18:00 as a starting point
      const t = new Date(now()); t.setDate(t.getDate() + 1); t.setHours(18, 0, 0, 0);
      const th = restTheme();
      const g = await api("admin/gifts", { method: "POST", body: {
        title: "Nový dárek", theme: th, appearance: TH.get(th).appearance,
        ...(th === "christmas" ? {} : { openAt: t.toISOString() })
      } });
      await loadList();
      setCurrent(g);
      $("layout").classList.add("show-editor");
      const ti = $("fTitle");
      ti.focus(); ti.select();
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

  /* ---------- boot ----------
     Opening the secret link (…/dilna#klic=KEY) signs in and removes the key from the address bar,
     so it doesn't stay in history or on a screenshot. Otherwise the session cookie decides. */
  (async () => {
    const key = keyFrom(location.hash);
    if (key) {
      history.replaceState(null, "", location.pathname + location.search);
      try {
        await loginWithKey(key);
        showApp();
        toast(`Vítej v dílně ${ws.name}`);
      } catch (err) {
        showLogin(err.message);
      }
      return;
    }
    // …/dilna#nova comes from "Zabalit dárek" on the landing page and after unwrapping
    // #nova=<e-mail>: the address typed under "Zabalit svůj dárek" after unwrapping
    const wantNew = /^#nova(=|$)/.test(location.hash);
    if (wantNew) { try { $("cEmail").value = decodeURIComponent(location.hash.slice(6)).slice(0, 200); } catch { /* ignore */ } }
    if (wantNew) history.replaceState(null, "", location.pathname + location.search);
    try {
      setWorkshop((await rawApi("workshop", { admin: true })).workshop);
      showApp();
    } catch (err) {
      showLogin(err.status === 401 ? "" : err.message);
      if (wantNew && err.status === 401) setTimeout(() => $("cName").focus({ preventScroll: true }), 60);
    }
  })();
})();
