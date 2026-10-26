/* Shared helpers for the recipient page and the workshop (admin). */
(function () {
  const API = "api/";

  async function api(path, { method = "GET", body, admin = false, raw = false, headers = {} } = {}) {
    const opts = { method, headers: { ...headers }, credentials: "same-origin" };
    if (admin) opts.headers["X-Admin"] = "1";
    if (body !== undefined) {
      if (raw) opts.body = body;
      else { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    }
    let res;
    try { res = await fetch(API + path, opts); }
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

  window.XD = { api, normalizePassword, normalizeCode, formatLong, formatShort, formatWithYear, plural, formatSize, relative, esc, store, copy, appBase };
})();
