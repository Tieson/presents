/* Shared helpers for the recipient page and the workshop (admin). */
(function () {
  const API = "api/";

  /* ---------- trial workshop: the backend runs in this browser (see local/local.js) ---------- */
  const LOCAL_FLAG = "xd:local";
  let local = null;
  const localMarked = () => { try { return localStorage.getItem(LOCAL_FLAG) === "1"; } catch { return false; } };
  const loadLocal = () => import("./local/local.js");
  /** Switches every api/ call of this page to the trial workshop (created on first use) */
  async function useLocal(name) {
    const m = await loadLocal();
    await m.start(name);
    local = m;
    try { localStorage.setItem(LOCAL_FLAG, "1"); } catch { /* ignore */ }
    watchUrls();
    return m;
  }
  function leaveLocal(forget = false) {
    local = null;
    if (forget) { try { localStorage.removeItem(LOCAL_FLAG); } catch { /* ignore */ } }
  }

  /** fetch("api/<path>"), or the trial workshop's answer; { remote: true } always asks the server */
  function xfetch(path, init = {}, { remote = false } = {}) {
    if (local && !remote) return local.request(path, init);
    return fetch(API + path, { credentials: "same-origin", ...init });
  }

  /** XMLHttpRequest for uploads (progress); in the trial workshop a stand-in with the same few members */
  function xhr() {
    if (!local) return new XMLHttpRequest();
    const m = local;
    return {
      upload: {}, status: 0, responseText: "", _h: {},
      open(method, url) { this._m = method; this._u = url.replace(/^api\//, ""); },
      setRequestHeader(k, v) { this._h[k] = v; },
      send(body) {
        m.request(this._u, { method: this._m, headers: this._h, body }).then(async r => {
          this.status = r.status; this.responseText = await r.text();
          this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 1 });
          this.onload?.();
        }, () => this.onerror?.());
      }
    };
  }

  /* src/href="api/…" can't reach a backend that lives in the page: swap them for blob URLs as they appear */
  const blobUrls = new Map();
  let watching = false;
  function swapUrl(el, attr) {
    const v = el.getAttribute(attr);
    if (!v || !v.startsWith(API) || !local) return;
    el.removeAttribute(attr);
    if (!blobUrls.has(v)) {
      blobUrls.set(v, local.request(v.slice(API.length)).then(async r => (r.ok ? URL.createObjectURL(await r.blob()) : null), () => null));
    }
    blobUrls.get(v).then(u => {
      if (!u) return;
      if (attr === "href" && /[?&]dl=1/.test(v)) el.setAttribute("download", "");
      el.setAttribute(attr, u);
    });
  }
  function swapIn(node) {
    if (node.nodeType !== 1) return;
    for (const attr of ["src", "href"]) {
      if (node.hasAttribute?.(attr)) swapUrl(node, attr);
      node.querySelectorAll?.(`[${attr}^="${API}"]`).forEach(el => swapUrl(el, attr));
    }
  }
  function watchUrls() {
    if (watching) return;
    watching = true;
    swapIn(document.documentElement);
    new MutationObserver(list => {
      for (const m of list) {
        if (m.type === "attributes") swapUrl(m.target, m.attributeName);
        else m.addedNodes.forEach(swapIn);
      }
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["src", "href"] });
  }

  async function api(path, { method = "GET", body, admin = false, raw = false, headers = {}, remote = false } = {}) {
    const opts = { method, headers: { ...headers } };
    if (admin) opts.headers["X-Admin"] = "1";
    if (body !== undefined) {
      if (raw) opts.body = body;
      else { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    }
    let res;
    try { res = await xfetch(path, opts, { remote }); }
    catch { throw Object.assign(new Error("Nepodařilo se spojit se serverem. Zkontroluj připojení."), { status: 0, code: "network" }); }
    let data = null;
    try { data = await res.json(); } catch { /* not json */ }
    if (!res.ok) {
      const err = new Error(data?.message || `Chyba serveru (${res.status}).`);
      err.status = res.status; err.code = data?.error; err.data = data;
      throw err;
    }
    return data;
  }

  /** "Vánoce " → "vanoce" – same rule when setting and when typing the password */
  function normalizePassword(s) {
    return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
  }

  function normalizeCode(raw) {
    const s = String(raw ?? "").toLowerCase().normalize("NFD").replace(/[^a-z]/g, "");
    return s.length === 12 ? `${s.slice(0, 6)}-${s.slice(6)}` : null;
  }

  const dtLong = new Intl.DateTimeFormat("cs-CZ", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  const dtShort = new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
  const dtYear = new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });

  function formatLong(iso) {
    const d = new Date(iso);
    // "čtvrtek 24. prosince v 18:00"
    return dtLong.format(d).replace(/\s+(\d{1,2}:\d{2})$/, " v $1").replace(/ v v /, " v ");
  }
  const formatShort = iso => dtShort.format(new Date(iso)).replace(/\s+/g, " ");
  const formatWithYear = iso => dtYear.format(new Date(iso)).replace(/\s+/g, " ");

  function plural(n, one, few, many) {
    const a = Math.abs(n);
    if (a === 1) return one;
    if (a >= 2 && a <= 4) return few;
    return many;
  }

  function formatSize(bytes) {
    if (!bytes && bytes !== 0) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${Math.round(bytes / 1024)} kB`;
    return `${(bytes / 1048576).toFixed(1).replace(".", ",")} MB`;
  }

  /** Remaining time → "59 dní", "3 dny 4 h", "2 h 15 min", "45 s" */
  function relative(ms) {
    if (ms <= 0) return "teď";
    const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
    if (d >= 2) return `${d} ${plural(d, "den", "dny", "dní")}`;
    if (d === 1) return `1 den ${h} h`;
    if (h) return `${h} h ${m} min`;
    if (m) return `${m} min`;
    return `${s} s`;
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch { return null; }
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch { /* ignore */ }
      ta.remove();
      return ok;
    }
  }

  /** Base URL of the app (works when installed in a sub-folder too) */
  function appBase() {
    const p = location.pathname.replace(/[^/]*$/, "");
    return location.origin + p;
  }

  window.XD = { api, fetch: xfetch, xhr, useLocal, leaveLocal, loadLocal, localMarked, isLocal: () => !!local, normalizePassword, normalizeCode, formatLong, formatShort, formatWithYear, plural, formatSize, relative, esc, store, copy, appBase };
})();

/* ---------- system notifications (Web Push) ---------- */
window.XDpush = (function () {
  const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  // iPhone/iPad: Web Push works only once the page is added to the home screen (iOS 16.4+)
  const iosNeedsInstall = () => /iP(hone|ad|od)/.test(navigator.userAgent) && !navigator.standalone && !matchMedia("(display-mode: standalone)").matches;
  let reg;
  const register = () => (reg ??= navigator.serviceWorker.register("sw.js"));
  const keyBytes = b64 => Uint8Array.from(atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4)), c => c.charCodeAt(0));
  async function current() {
    if (!supported()) return null;
    const r = await navigator.serviceWorker.getRegistration();
    return r ? r.pushManager.getSubscription() : null;
  }
  /** Asks for permission (must run from a click) and returns the push endpoint */
  async function subscribe(publicKey) {
    if (!supported()) throw new Error(iosNeedsInstall() ? "Na iPhonu nejdřív přidej stránku na plochu (Sdílet → Přidat na plochu) a otevři ji odtamtud." : "Tenhle prohlížeč upozornění neumí.");
    const perm = await Notification.requestPermission();
    if (perm !== "granted") throw new Error("Upozornění jsou v prohlížeči zakázaná. Povol je v nastavení stránky.");
    const r = await register();
    await navigator.serviceWorker.ready;
    let sub = await r.pushManager.getSubscription();
    if (!sub) sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
    return sub.endpoint;
  }
  return { supported, iosNeedsInstall, subscribe, current, register };
})();
