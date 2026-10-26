/* Gift wrapping: papers, patterns, ribbons. Keys must match the backend whitelists. */
(function () {
  const PAPERS = {
    burgundy:  { name: "Bordó",          base: ["#82162b", "#6d0f20", "#3f0712"], lid: ["#951a32", "#7a1427", "#5c0d1c"], ink: "rgba(255,255,255,.1)" },
    emerald:   { name: "Smaragd",        base: ["#1f7350", "#155639", "#0a2e1f"], lid: ["#26825c", "#1b6646", "#124a33"], ink: "rgba(255,255,255,.11)" },
    midnight:  { name: "Půlnoční modř",  base: ["#233c72", "#182c57", "#0b1730"], lid: ["#2a4785", "#1e366a", "#152a52"], ink: "rgba(255,255,255,.12)" },
    ivory:     { name: "Sněhobílá",      base: ["#f8f2e4", "#ebe0c8", "#c9b994"], lid: ["#fffaf0", "#f1e7d1", "#dccfae"], ink: "rgba(140,104,44,.18)", light: true },
    champagne: { name: "Šampaňská",      base: ["#ead39f", "#d4b77a", "#a3844a"], lid: ["#f3dfb2", "#dfc28b", "#c4a467"], ink: "rgba(255,255,255,.28)", light: true },
    blush:     { name: "Pudrová",        base: ["#ecc0bb", "#d9a09c", "#a86a66"], lid: ["#f4ccc7", "#e4aca8", "#cb8b86"], ink: "rgba(255,255,255,.3)", light: true },
    charcoal:  { name: "Uhlová",         base: ["#323238", "#232327", "#111113"], lid: ["#3c3c43", "#2c2c31", "#1d1d21"], ink: "rgba(255,255,255,.1)" },
    silver:    { name: "Stříbrná",       base: ["#dde1e7", "#bcc3cc", "#858e9a"], lid: ["#e9ecf0", "#cdd2d9", "#a9b1bc"], ink: "rgba(255,255,255,.45)", light: true }
  };
  const RIBBONS = {
    gold:   { name: "Zlatá",      c: ["#8c6a2c", "#d6b26a", "#f6e3ad"] },
    silver: { name: "Stříbrná",   c: ["#737b86", "#c4cad2", "#f5f7f9"] },
    red:    { name: "Červená",    c: ["#5e0a17", "#b3203a", "#ec7486"] },
    green:  { name: "Jedlová",    c: ["#0c3a27", "#1f7a50", "#6cc697"] },
    white:  { name: "Bílá",       c: ["#b9b09d", "#ece6d8", "#ffffff"] },
    black:  { name: "Černá",      c: ["#050506", "#26262a", "#5e5e66"] }
  };
  const PATTERNS = {
    plain:   { name: "Hladký" },
    stripes: { name: "Proužky" },
    dots:    { name: "Puntíky" },
    stars:   { name: "Hvězdičky" },
    snow:    { name: "Vločky" },
    tartan:  { name: "Kostka" }
  };
  const RIBBON_STYLES = { cross: "Do kříže", single: "Jedna stuha" };
  const REVEALS = {
    all:        { name: "Najednou",            sub: "Po otevření boxu se ukážou všechny položky." },
    sequential: { name: "Postupně",            sub: "Každá položka je malá krabička, rozbaluje se jedna po druhé." },
    choice:     { name: "Ať vybere příjemce",  sub: "Po otevření boxu si příjemce zvolí, jak chce rozbalovat." }
  };
  const DEFAULT = { paper: "burgundy", pattern: "stripes", ribbon: "gold", ribbonStyle: "cross", seal: "V" };

  function normalize(a) {
    a = a || {};
    return {
      paper: PAPERS[a.paper] ? a.paper : DEFAULT.paper,
      pattern: PATTERNS[a.pattern] ? a.pattern : DEFAULT.pattern,
      ribbon: RIBBONS[a.ribbon] ? a.ribbon : DEFAULT.ribbon,
      ribbonStyle: RIBBON_STYLES[a.ribbonStyle] ? a.ribbonStyle : DEFAULT.ribbonStyle,
      seal: typeof a.seal === "string" ? [...a.seal].slice(0, 2).join("") : DEFAULT.seal
    };
  }

  const svg = s => `url("data:image/svg+xml,${encodeURIComponent(s)}")`;
  const u = k => `calc(var(--w, 270px) * ${k})`; // pattern scale follows box size

  /** Returns [images, sizes] for background layers of the chosen pattern */
  function pattern(key, ink) {
    switch (key) {
      case "stripes":
        return [[`repeating-linear-gradient(45deg, ${ink} 0 ${u(.024)}, transparent 0 ${u(.052)})`], ["auto"]];
      case "dots":
        return [[`radial-gradient(circle, ${ink} 0 22%, transparent 24%)`], [`${u(.075)} ${u(.075)}`]];
      case "stars":
        return [[svg(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'><path fill='${ink}' d='M10 3l1.9 5.1L17 10l-5.1 1.9L10 17l-1.9-5.1L3 10l5.1-1.9zM30 23l1.3 3.7L35 28l-3.7 1.3L30 33l-1.3-3.7L25 28l3.7-1.3z'/><circle cx='31' cy='9' r='1.2' fill='${ink}'/><circle cx='9' cy='31' r='1.2' fill='${ink}'/></svg>`)], [`${u(.16)} ${u(.16)}`]];
      case "snow":
        return [[svg(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'><g stroke='${ink}' stroke-width='1.5' stroke-linecap='round' fill='none'><path d='M13 4v18M4 13h18M6.6 6.6l12.8 12.8M19.4 6.6L6.6 19.4M10.5 5.5L13 8l2.5-2.5M10.5 20.5L13 18l2.5 2.5M5.5 10.5L8 13l-2.5 2.5M20.5 10.5L18 13l2.5 2.5'/><path d='M36 28v14M29 35h14M31 30l10 10M41 30L31 40'/></g></svg>`)], [`${u(.2)} ${u(.2)}`]];
      case "tartan":
        return [[
          `repeating-linear-gradient(0deg, ${ink} 0 ${u(.03)}, transparent 0 ${u(.1)}, ${ink} 0 ${u(.106)}, transparent 0 ${u(.14)})`,
          `repeating-linear-gradient(90deg, ${ink} 0 ${u(.03)}, transparent 0 ${u(.1)}, ${ink} 0 ${u(.106)}, transparent 0 ${u(.14)})`
        ], ["auto", "auto"]];
      default:
        return [["none"], ["auto"]];
    }
  }

  /** CSS custom properties for an element containing a .gift */
  function vars(a) {
    a = normalize(a);
    const p = PAPERS[a.paper], r = RIBBONS[a.ribbon];
    const [imgs, sizes] = pattern(a.pattern, p.ink);
    return {
      "--pp-a": p.base[0], "--pp-b": p.base[1], "--pp-c": p.base[2],
      "--pl-a": p.lid[0], "--pl-b": p.lid[1], "--pl-c": p.lid[2],
      "--rb-d": r.c[0], "--rb-m": r.c[1], "--rb-l": r.c[2],
      "--pat": imgs.join(", "), "--pat-size": sizes.join(", "),
      "--seal-ink": p.light && a.ribbon !== "black" ? r.c[0] : r.c[2]
    };
  }

  function apply(el, a) {
    a = normalize(a);
    for (const [k, v] of Object.entries(vars(a))) el.style.setProperty(k, v);
    el.classList.toggle("rb-single", a.ribbonStyle === "single");
    el.classList.toggle("no-seal", !a.seal);
    const seal = el.querySelector(".seal");
    if (seal) seal.textContent = a.seal;
  }

  /** Inner markup of the present (wrap it in an element with class "gift") */
  function markup() {
    return `<span class="gift-shadow"></span>
      <span class="base"><span class="ribbon-v"></span><span class="ribbon-h"></span><span class="seal" aria-hidden="true"></span></span>
      <span class="lid"><span class="lid-body"></span><span class="ribbon-v"></span>
        <span class="bow" aria-hidden="true"><span class="tail l"></span><span class="tail r"></span><span class="loop l"></span><span class="loop r"></span><span class="knot"></span></span>
      </span>`;
  }

  window.XDwrap = { PAPERS, RIBBONS, PATTERNS, RIBBON_STYLES, REVEALS, DEFAULT, normalize, vars, apply, markup };
})();
