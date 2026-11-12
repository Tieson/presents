/* Gift wrapping: papers, patterns, ribbons, bows, decorations.
   Keys must match the backend whitelists (server/app.js, php/api.php). */
(function () {
  /* Pattern colours. Each paper suggests a few that suit it (first = default). */
  const INKS = {
    white:  { name: "Bílá",       rgb: "255,255,255" },
    cream:  { name: "Krémová",    rgb: "246,231,196" },
    gold:   { name: "Zlatá",      rgb: "222,186,110" },
    silver: { name: "Stříbrná",   rgb: "200,206,214" },
    bronze: { name: "Bronzová",   rgb: "140,104,44" },
    red:    { name: "Červená",    rgb: "182,30,52" },
    green:  { name: "Zelená",     rgb: "28,110,72" },
    navy:   { name: "Modrá",      rgb: "34,58,112" },
    brown:  { name: "Hnědá",      rgb: "92,58,30" },
    black:  { name: "Černá",      rgb: "22,22,26" },
    pink:   { name: "Růžová",     rgb: "240,150,172" },
    sky:    { name: "Blankytná",  rgb: "126,182,228" },
    mint:   { name: "Mátová",     rgb: "122,206,170" },
    lilac:  { name: "Levandulová", rgb: "176,154,214" },
    paper:  { name: "Barva papíru", rgb: null }            // tone on tone: the paper's own colour, the sheen shows it
  };
  const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(",");
  /** rgb of a pattern colour on the given paper */
  const inkRgb = (key, paper) => (key === "paper" ? hexRgb(PAPERS[paper].base[0]) : INKS[key].rgb);

  const PAPERS = {
    burgundy:  { name: "Bordó",            base: ["#82162b", "#6d0f20", "#3f0712"], lid: ["#951a32", "#7a1427", "#5c0d1c"], inks: ["white", "gold", "cream", "green"], alpha: .1 },
    scarlet:   { name: "Vánoční červená",  base: ["#c4202f", "#a31523", "#640b14"], lid: ["#d42a39", "#b31a29", "#86101c"], inks: ["white", "gold", "green", "cream"], alpha: .16 },
    emerald:   { name: "Smaragd",          base: ["#1f7350", "#155639", "#0a2e1f"], lid: ["#26825c", "#1b6646", "#124a33"], inks: ["white", "gold", "red", "cream"], alpha: .11 },
    fir:       { name: "Jedlová",          base: ["#18402f", "#103223", "#071a12"], lid: ["#1f4d39", "#153c2b", "#0d2a1d"], inks: ["gold", "white", "red", "cream"], alpha: .22 },
    midnight:  { name: "Půlnoční modř",    base: ["#233c72", "#182c57", "#0b1730"], lid: ["#2a4785", "#1e366a", "#152a52"], inks: ["white", "silver", "gold", "cream"], alpha: .12 },
    plum:      { name: "Švestková",        base: ["#5a2148", "#451737", "#250a1d"], lid: ["#682a54", "#521d41", "#3b132f"], inks: ["gold", "white", "cream", "silver"], alpha: .18 },
    charcoal:  { name: "Uhlová",           base: ["#323238", "#232327", "#111113"], lid: ["#3c3c43", "#2c2c31", "#1d1d21"], inks: ["white", "gold", "red", "silver"], alpha: .1 },
    ivory:     { name: "Sněhobílá",        base: ["#f8f2e4", "#ebe0c8", "#c9b994"], lid: ["#fffaf0", "#f1e7d1", "#dccfae"], inks: ["bronze", "red", "green", "gold", "navy"], alpha: .18, light: true },
    frost:     { name: "Mrazivá",          base: ["#dfeaf2", "#c3d5e3", "#8ea7bb"], lid: ["#ebf2f7", "#d2e1ec", "#adc3d4"], inks: ["white", "navy", "silver", "red"], alpha: .5, light: true },
    champagne: { name: "Šampaňská",        base: ["#ead39f", "#d4b77a", "#a3844a"], lid: ["#f3dfb2", "#dfc28b", "#c4a467"], inks: ["white", "brown", "red", "green"], alpha: .28, light: true },
    gold:      { name: "Zlatá",            base: ["#e1bd6c", "#c39a48", "#8a6526"], lid: ["#ebcb82", "#d0a857", "#a87f37"], inks: ["white", "brown", "red", "black"], alpha: .26, light: true },
    blush:     { name: "Pudrová",          base: ["#ecc0bb", "#d9a09c", "#a86a66"], lid: ["#f4ccc7", "#e4aca8", "#cb8b86"], inks: ["white", "red", "gold", "green"], alpha: .3, light: true },
    silver:    { name: "Stříbrná",         base: ["#dde1e7", "#bcc3cc", "#858e9a"], lid: ["#e9ecf0", "#cdd2d9", "#a9b1bc"], inks: ["white", "navy", "red", "black"], alpha: .45, light: true },
    kraft:     { name: "Balicí papír",     base: ["#c49a6c", "#a97f52", "#6e4f2f"], lid: ["#cfa679", "#b48a5c", "#8d6a44"], inks: ["white", "red", "green", "black"], alpha: .45, light: true }
  };

  const RIBBONS = {
    gold:     { name: "Zlatá",     c: ["#8c6a2c", "#d6b26a", "#f6e3ad"] },
    silver:   { name: "Stříbrná",  c: ["#737b86", "#c4cad2", "#f5f7f9"] },
    copper:   { name: "Měděná",    c: ["#6b3418", "#b86b3c", "#f0b98d"] },
    red:      { name: "Červená",   c: ["#5e0a17", "#b3203a", "#ec7486"] },
    burgundy: { name: "Bordó",     c: ["#3a0610", "#7a1427", "#c0566b"] },
    pink:     { name: "Růžová",    c: ["#9a4c5c", "#e29aa8", "#fde0e6"] },
    green:    { name: "Jedlová",   c: ["#0c3a27", "#1f7a50", "#6cc697"] },
    navy:     { name: "Modrá",     c: ["#0d1a3a", "#284a8f", "#8eaee6"] },
    white:    { name: "Bílá",      c: ["#b9b09d", "#ece6d8", "#ffffff"] },
    black:    { name: "Černá",     c: ["#050506", "#26262a", "#5e5e66"] }
  };

  /* g = the occasion it belongs to; "general" ones are offered always */
  const PATTERNS = {
    plain:       { name: "Hladký",      g: "general" },
    stripes:     { name: "Proužky",     g: "general" },
    dots:        { name: "Puntíky",     g: "general" },
    tartan:      { name: "Kostka",      g: "general" },
    stars:       { name: "Hvězdičky",   g: "general" },
    chevron:     { name: "Cik-cak",     g: "general" },
    waves:       { name: "Vlnky",       g: "general" },
    snow:        { name: "Vločky",      g: "christmas" },
    trees:       { name: "Stromky",     g: "christmas" },
    baubles:     { name: "Baňky",       g: "christmas" },
    holly:       { name: "Cesmína",     g: "christmas" },
    candy:       { name: "Lízátka",     g: "christmas" },
    gingerbread: { name: "Perníčky",    g: "christmas" },
    deer:        { name: "Sobi",        g: "christmas" },
    confetti:    { name: "Konfety",     g: "birthday" },
    balloons:    { name: "Balónky",     g: "birthday" },
    cupcakes:    { name: "Dortíky",     g: "birthday" },
    streamers:   { name: "Serpentýny",  g: "birthday" },
    hearts:      { name: "Srdíčka",     g: "wedding" },
    rings:       { name: "Prstýnky",    g: "wedding" },
    flowers:     { name: "Kvítky",      g: "wedding" },
    lace:        { name: "Krajka",      g: "wedding" }
  };

  const RIBBON_STYLES = { cross: "Do kříže", single: "Jedna stuha", none: "Bez stuhy" };
  const BOWS = {
    classic: { name: "Klasická" },
    double:  { name: "Dvojitá" },
    rosette: { name: "Růžice" },
    small:   { name: "Malá" },
    none:    { name: "Bez mašle" }
  };
  const DECOS = {
    none:     { name: "Bez ozdoby",          g: "general" },
    star:     { name: "Hvězda",              g: "general" },
    tag:      { name: "Jmenovka",            g: "general" },
    holly:    { name: "Cesmína",             g: "christmas" },
    pine:     { name: "Jehličí a šiška",     g: "christmas" },
    candy:    { name: "Lízátko",             g: "christmas" },
    bauble:   { name: "Baňka",               g: "christmas" },
    bells:    { name: "Zvonečky",            g: "christmas" },
    orange:   { name: "Pomeranč a skořice",  g: "christmas" },
    balloons: { name: "Balónky",             g: "birthday" },
    candle:   { name: "Svíčka",              g: "birthday" },
    partyhat: { name: "Čepička",             g: "birthday" },
    rings:    { name: "Prstýnky",            g: "wedding" },
    rose:     { name: "Růže",                g: "wedding" },
    heart:    { name: "Srdce",               g: "wedding" }
  };
  /** pickers group by occasion: general first, without a heading */
  const GROUPS = ["general", "christmas", "birthday", "wedding"];
  const PHOTO_FRAMES = { polaroid: "Polaroid", postcard: "Pohlednice" };
  const REVEALS = {
    all:        { name: "Najednou",            sub: "Po otevření boxu se ukážou všechny položky." },
    sequential: { name: "Postupně",            sub: "Každá položka je malá krabička, rozbaluje se jedna po druhé." },
    choice:     { name: "Ať vybere příjemce",  sub: "Po otevření boxu si příjemce zvolí, jak chce rozbalovat." }
  };
  const DEFAULT = {
    paper: "burgundy", pattern: "stripes", patternColor: null, patternOpacity: null,
    ribbon: "gold", ribbonStyle: "cross", bow: "classic", deco: "none", seal: "V"
  };
  const OPACITY = { min: 5, max: 90 };   // % for the "Výraznost vzoru" slider

  const pick = (map, v, d) => (Object.prototype.hasOwnProperty.call(map, v) ? v : d);

  function normalize(a) {
    a = a || {};
    const paper = pick(PAPERS, a.paper, DEFAULT.paper);
    const op = Number(a.patternOpacity);
    return {
      paper,
      pattern: pick(PATTERNS, a.pattern, DEFAULT.pattern),
      // a colour that doesn't suit the paper is kept (the creator chose it), unknown keys fall back
      patternColor: INKS[a.patternColor] ? a.patternColor : null,
      patternOpacity: a.patternOpacity != null && Number.isFinite(op) ? Math.min(OPACITY.max, Math.max(OPACITY.min, Math.round(op))) : null,
      ribbon: pick(RIBBONS, a.ribbon, DEFAULT.ribbon),
      ribbonStyle: pick(RIBBON_STYLES, a.ribbonStyle, DEFAULT.ribbonStyle),
      bow: pick(BOWS, a.bow, DEFAULT.bow),
      deco: pick(DECOS, a.deco, DEFAULT.deco),
      seal: typeof a.seal === "string" ? [...a.seal].slice(0, 2).join("") : DEFAULT.seal
    };
  }
  /** the colour and opacity actually used (defaults come from the paper) */
  function inkOf(a) {
    const p = PAPERS[a.paper];
    const key = a.patternColor || p.inks[0];
    const alpha = a.patternOpacity != null ? a.patternOpacity / 100 : key === "paper" ? .9 : p.alpha;
    return { key, alpha, opacity: Math.round(alpha * 100), css: `rgba(${inkRgb(key, a.paper)},${alpha})` };
  }

  const svg = s => `url("data:image/svg+xml,${encodeURIComponent(s)}")`;
  const u = k => `calc(var(--w, 270px) * ${k})`; // pattern scale follows box size
  const tile = (vb, body, size) => [[svg(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${vb} ${vb}'>${body}</svg>`)], [`${u(size)} ${u(size)}`]];

  /** Returns [images, sizes] for background layers of the chosen pattern */
  function pattern(key, ink) {
    const f = `fill='${ink}'`, s = `stroke='${ink}'`;
    switch (key) {
      case "stripes":
        return [[`repeating-linear-gradient(45deg, ${ink} 0 ${u(.024)}, transparent 0 ${u(.052)})`], ["auto"]];
      case "dots":
        return [[`radial-gradient(circle, ${ink} 0 22%, transparent 24%)`], [`${u(.075)} ${u(.075)}`]];
      case "tartan":
        return [[
          `repeating-linear-gradient(0deg, ${ink} 0 ${u(.03)}, transparent 0 ${u(.1)}, ${ink} 0 ${u(.106)}, transparent 0 ${u(.14)})`,
          `repeating-linear-gradient(90deg, ${ink} 0 ${u(.03)}, transparent 0 ${u(.1)}, ${ink} 0 ${u(.106)}, transparent 0 ${u(.14)})`
        ], ["auto", "auto"]];
      case "stars":
        return tile(40, `<path ${f} d='M10 3l1.9 5.1L17 10l-5.1 1.9L10 17l-1.9-5.1L3 10l5.1-1.9zM30 23l1.3 3.7L35 28l-3.7 1.3L30 33l-1.3-3.7L25 28l3.7-1.3z'/><circle cx='31' cy='9' r='1.2' ${f}/><circle cx='9' cy='31' r='1.2' ${f}/>`, .16);
      case "snow":
        return tile(48, `<g ${s} stroke-width='1.5' stroke-linecap='round' fill='none'><path d='M13 4v18M4 13h18M6.6 6.6l12.8 12.8M19.4 6.6L6.6 19.4M10.5 5.5L13 8l2.5-2.5M10.5 20.5L13 18l2.5 2.5M5.5 10.5L8 13l-2.5 2.5M20.5 10.5L18 13l2.5 2.5'/><path d='M36 28v14M29 35h14M31 30l10 10M41 30L31 40'/></g>`, .2);
      case "trees":
        return tile(60, `<g ${f}><path d='M15 4l7 9h-3.5l6 8h-4l6.5 9H3l6.5-9h-4l6-8H8z'/><rect x='13.5' y='30' width='3' height='4'/><path d='M45 34l5.5 7h-2.8l4.8 6.5h-3.2l5.2 7.5H35.5l5.2-7.5h-3.2l4.8-6.5h-2.8z'/><rect x='43.8' y='55' width='2.4' height='3.4'/><circle cx='44' cy='12' r='1.3'/><circle cx='9' cy='48' r='1.3'/><circle cx='54' cy='22' r='.9'/><circle cx='26' cy='44' r='.9'/></g>`, .22);
      case "baubles":
        return tile(60, `<g ${f}><path d='M13 5h4v3h-4z'/><circle cx='15' cy='16' r='8'/><path d='M43 33h3.4v2.6H43z'/><circle cx='44.7' cy='42.5' r='7'/></g><g ${s} fill='none' stroke-width='1'><path d='M15 0v5M44.7 26v7'/></g><g fill='none' stroke='white' stroke-opacity='.35' stroke-width='1.2'><path d='M8.5 14.5q6.5 3 13 0'/><path d='M38.6 41q6.1 2.6 12.2 0'/></g>`, .22);
      case "holly": {
        const leaf = "M0 0C2.5-2.6 4.6-2 5.6-4.6 6.4-2 9-1.8 10.4-4.4 11.2-1.8 13.8-1.6 15.4-4.2 16-1.4 18.4-.6 21 0 18.4.6 16 1.4 15.4 4.2 13.8 1.6 11.2 1.8 10.4 4.4 9 1.8 6.4 2 5.6 4.6 4.6 2 2.5 2.6 0 0Z";
        const sprig = (x, y, r) => `<g transform='translate(${x} ${y}) rotate(${r})'><path ${f} d='${leaf}' transform='rotate(-160) scale(1 1.25)'/><path ${f} d='${leaf}' transform='rotate(35) scale(1 1.25)'/><path ${f} d='${leaf}' transform='rotate(-75) scale(.7 .95)'/><circle ${f} cx='-1.6' cy='2.6' r='2.6'/><circle ${f} cx='2.4' cy='3.4' r='2.6'/><circle ${f} cx='.3' cy='6.6' r='2.6'/></g>`;
        return tile(64, sprig(16, 16, 0) + sprig(48, 46, 30), .24);
      }
      case "candy": {
        const cane = "<path d='M0 30V6a6.5 6.5 0 0 1 13 0v3' fill='none' stroke-width='4.6' stroke-dasharray='4.2 2.6'/>";
        return tile(56, `<g ${s}><g transform='translate(9 12)'>${cane}</g><g transform='translate(47 36) scale(-.8 .8)'>${cane}</g></g>`, .22);
      }
      case "gingerbread":
        return tile(64, `<g ${f}><circle cx='18' cy='9' r='5.2'/><path d='M12 14h12c2 0 2.6 1.4 1.6 2.6L22 20v6l4.5 9c.7 1.6-.6 2.8-2.1 2l-5.4-6.5-5.4 6.5c-1.5.8-2.8-.4-2.1-2L14 26v-6l-3.6-3.4c-1-1.2-.4-2.6 1.6-2.6z'/><circle cx='46' cy='36' r='4.2'/><path d='M41 40h10c1.6 0 2.1 1.2 1.3 2.1L49.4 45v5l3.6 7.2c.6 1.3-.5 2.3-1.7 1.6L46.5 53.6l-4.8 5.2c-1.2.7-2.3-.3-1.7-1.6l3.6-7.2v-5l-2.9-2.9c-.8-.9-.3-2.1 1.3-2.1z'/></g>`, .25);
      case "deer":
        return tile(64, `<g ${f}><path d='M8 30c-1.2-2.6.6-5.2 3.4-5.2l1.6-4.6-3-3.2 1.4-1 2.4 2.4.8-3.8h1.8l-.8 4.6 1.8 1 1-3.8h1.8l-.8 4.6-2.8 2-1 4.2c2.8.2 4.8 2.2 5 5h9.6c2.6 0 4.4 1.8 4.4 4.4v4.4l1.8 8h-2.6l-1.8-6.2h-1.6l-.8 6.2h-2.6l-.8-7h-7.4l-.8 7h-2.6l-.8-7-1.8 7h-2.6l.9-10.6C9.4 34 8.4 32.2 8 30z'/><path d='M8 30c-1.2-2.6.6-5.2 3.4-5.2l1.6-4.6-3-3.2 1.4-1 2.4 2.4.8-3.8h1.8l-.8 4.6 1.8 1 1-3.8h1.8l-.8 4.6-2.8 2-1 4.2c2.8.2 4.8 2.2 5 5h9.6c2.6 0 4.4 1.8 4.4 4.4v4.4l1.8 8h-2.6l-1.8-6.2h-1.6l-.8 6.2h-2.6l-.8-7h-7.4l-.8 7h-2.6l-.8-7-1.8 7h-2.6l.9-10.6C9.4 34 8.4 32.2 8 30z' transform='translate(64 26) scale(-.72 .72)'/><circle cx='50' cy='12' r='1.2'/><circle cx='12' cy='56' r='1.2'/><circle cx='58' cy='60' r='.9'/></g>`, .28);
      case "hearts":
        return tile(48, `<g ${f}><path d='M12 21s-8-5-8-10.5C4 7 6.4 5 9 5c1.6 0 2.5.9 3 1.8C12.5 5.9 13.4 5 15 5c2.6 0 5 2 5 5.5C20 16 12 21 12 21z'/><path d='M36 43s-6-3.8-6-7.9C30 32.5 31.8 31 33.8 31c1.2 0 1.9.7 2.2 1.4.3-.7 1-1.4 2.2-1.4 2 0 3.8 1.5 3.8 4.1C42 39.2 36 43 36 43z'/></g>`, .17);
      case "chevron":
        return tile(40, `<path ${s} fill='none' stroke-width='3' stroke-linejoin='round' d='M-1 12.8L0 12l10-8 10 8 10-8 10 8 1-.8M-1 32.8L0 32l10-8 10 8 10-8 10 8 1-.8'/>`, .13);
      case "waves":
        return tile(40, `<path ${s} fill='none' stroke-width='2.6' stroke-linecap='round' d='M0 10c5 0 5-6 10-6s5 6 10 6 5-6 10-6 5 6 10 6M0 30c5 0 5-6 10-6s5 6 10 6 5-6 10-6 5 6 10 6'/>`, .15);
      case "confetti":
        return tile(60, `<g ${f}><rect x='6' y='8' width='8' height='3.4' rx='1' transform='rotate(-30 10 9.7)'/><rect x='38' y='6' width='8' height='3.4' rx='1' transform='rotate(40 42 7.7)'/><rect x='21' y='34' width='8' height='3.4' rx='1' transform='rotate(15 25 35.7)'/><rect x='47' y='44' width='8' height='3.4' rx='1' transform='rotate(-55 51 45.7)'/><circle cx='28' cy='14' r='2.3'/><circle cx='10' cy='47' r='2.3'/><circle cx='53' cy='26' r='1.7'/><circle cx='36' cy='54' r='1.7'/></g><path ${s} fill='none' stroke-width='1.8' stroke-linecap='round' d='M7 27q3-4 6 0t6 0M39 33q3-4 6 0t6 0'/>`, .22);
      case "balloons":
        return tile(64, `<g ${f}><ellipse cx='16' cy='14' rx='8' ry='9.6'/><path d='M14.4 23.4h3.2l-1.6 2.4z'/><ellipse cx='46' cy='38' rx='7' ry='8.4'/><path d='M44.6 46.2h2.8l-1.4 2.2z'/><circle cx='42' cy='10' r='1.2'/><circle cx='10' cy='52' r='1.2'/></g><path ${s} fill='none' stroke-width='1.1' d='M16 25.8q-3 6 0 12t0 12M46 48.4q3 5 0 10'/>`, .24);
      case "cupcakes": {
        const cake = `<path d='M3 13h18l-2.6 12H5.6z'/><path d='M2 13c0-5 3.4-7.6 6-7.6C9 3 10.8 2 12 2s3 1 4 3.4c2.6 0 6 2.6 6 7.6z' opacity='.7'/><circle cx='12' cy='1' r='1.8'/>`;
        return tile(64, `<g ${f}><g transform='translate(6 8)'>${cake}</g><g transform='translate(36 36) scale(.85)'>${cake}</g><circle cx='50' cy='12' r='1.3'/><circle cx='14' cy='50' r='1.3'/></g>`, .25);
      }
      case "streamers":
        return tile(64, `<g ${s} fill='none' stroke-width='2' stroke-linecap='round'><path d='M2 10c6 0 6 8 12 8s6-8 12-8 6 8 12 8'/><path d='M26 42c6 0 6 8 12 8s6-8 12-8 6 8 12 8'/><path d='M12 46a3.5 3.5 0 1 1 3.5 3.5 7 7 0 1 1 7-7'/><path d='M50 18a3 3 0 1 0-3-3 6 6 0 1 0 6-6'/></g>`, .26);
      case "rings":
        return tile(64, `<g ${s} fill='none' stroke-width='2.2'><circle cx='13' cy='17' r='6.4'/><circle cx='21.5' cy='17' r='6.4'/><circle cx='42' cy='45' r='5.2'/><circle cx='49' cy='45' r='5.2'/></g><g ${f}><path d='M21.5 6.6l2.2 2.4-2.2 2.2-2.2-2.2z'/><circle cx='50' cy='14' r='1.2'/><circle cx='12' cy='50' r='1.2'/></g>`, .22);
      case "flowers": {
        const fl = (x, y, r) => [0, 72, 144, 216, 288].map(d => { const a = (d - 90) * Math.PI / 180; return `<circle cx='${(x + r * Math.cos(a)).toFixed(1)}' cy='${(y + r * Math.sin(a)).toFixed(1)}' r='${(r * .62).toFixed(1)}'/>`; }).join("");
        return tile(56, `<g ${f}>${fl(14, 14, 5.4)}${fl(42, 40, 4.4)}<circle cx='42' cy='12' r='1.3'/><circle cx='12' cy='44' r='1.3'/><circle cx='28' cy='28' r='.9'/></g>`, .2);
      }
      case "lace":
        return tile(40, `<g ${s} fill='none' stroke-width='1.3'><path d='M0 6a5 5 0 0 0 10 0 5 5 0 0 0 10 0 5 5 0 0 0 10 0 5 5 0 0 0 10 0M0 26a5 5 0 0 0 10 0 5 5 0 0 0 10 0 5 5 0 0 0 10 0 5 5 0 0 0 10 0'/></g><g ${f}><circle cx='5' cy='14' r='1.3'/><circle cx='15' cy='14' r='1.3'/><circle cx='25' cy='14' r='1.3'/><circle cx='35' cy='14' r='1.3'/><circle cx='5' cy='34' r='1.3'/><circle cx='15' cy='34' r='1.3'/><circle cx='25' cy='34' r='1.3'/><circle cx='35' cy='34' r='1.3'/></g>`, .13);
      default:
        return [["none"], ["auto"]];
    }
  }

  /** CSS custom properties for an element containing a .gift */
  function vars(a) {
    a = normalize(a);
    const p = PAPERS[a.paper], r = RIBBONS[a.ribbon];
    const [imgs, sizes] = pattern(a.pattern, inkOf(a).css);
    return {
      "--pp-a": p.base[0], "--pp-b": p.base[1], "--pp-c": p.base[2],
      "--pl-a": p.lid[0], "--pl-b": p.lid[1], "--pl-c": p.lid[2],
      "--rb-d": r.c[0], "--rb-m": r.c[1], "--rb-l": r.c[2],
      "--pat": imgs.join(", "), "--pat-size": sizes.join(", "),
      "--seal-ink": p.light && a.ribbon !== "black" ? r.c[0] : r.c[2]
    };
  }

  /** Resolves once the pattern's image tiles are decoded, so swapping them in doesn't flash blank (a new colour/strength is a new image) */
  const decoded = new Map();
  function ready(a) {
    a = normalize(a);
    const urls = pattern(a.pattern, inkOf(a).css)[0].filter(v => v.startsWith("url("));
    return Promise.all(urls.map(v => {
      if (!decoded.has(v)) {
        const img = new Image();
        img.src = v.slice(5, -2);
        decoded.set(v, (img.decode ? img.decode() : Promise.resolve()).catch(() => {}));
        if (decoded.size > 60) decoded.delete(decoded.keys().next().value);
      }
      return decoded.get(v);
    }));
  }

  const CLASSES = [
    ...Object.keys(RIBBON_STYLES).map(k => `rb-${k}`),
    ...Object.keys(BOWS).map(k => `bow-${k}`),
    ...Object.keys(DECOS).map(k => `deco-${k}`)
  ];
  function apply(el, a) {
    a = normalize(a);
    for (const [k, v] of Object.entries(vars(a))) el.style.setProperty(k, v);
    el.classList.remove(...CLASSES);
    el.classList.add(`rb-${a.ribbonStyle}`, `bow-${a.bow}`, `deco-${a.deco}`);
    el.classList.toggle("no-seal", !a.seal);
    const seal = el.querySelector(".seal");
    if (seal) seal.textContent = a.seal;
    const deco = el.querySelector(".deco");
    if (deco && deco.dataset.k !== a.deco) { deco.dataset.k = a.deco; deco.innerHTML = DECO_SVG[a.deco] || ""; }
  }
  /** class list for a static mini box (the list in the workshop) */
  const classes = a => { a = normalize(a); return `rb-${a.ribbonStyle} bow-${a.bow} deco-${a.deco}${a.seal ? "" : " no-seal"}`; };

  /* Decorations tucked under the bow. Drawn on a 100×70 canvas. */
  const DECO_SVG = {
    holly: `<svg viewBox="0 0 100 70" aria-hidden="true"><g stroke="#0b3a22" stroke-width="1" stroke-linejoin="round"><path fill="#1f6b3f" d="M50 40C40 30 30 33 18 24c4 0 6-3 6-6 3 2 6 2 8 0 0 3 3 5 6 5-2 3-1 6 2 7-3 1-3 4-1 6 3-2 6-1 8 1z"/><path fill="#2b8450" d="M50 40c10-12 22-10 33-19-4 0-6-3-5-6-3 2-6 1-8-1 0 3-3 5-6 4 2 3 1 6-2 7 3 1 3 4 1 6-3-2-6-1-8 2z"/></g><circle cx="45" cy="42" r="6" fill="#b3122a"/><circle cx="56" cy="43" r="6" fill="#c8162f"/><circle cx="50" cy="51" r="6" fill="#a50f25"/><g fill="#fff" opacity=".55"><circle cx="43" cy="40" r="1.6"/><circle cx="54" cy="41" r="1.6"/><circle cx="48" cy="49" r="1.6"/></g></svg>`,
    pine: `<svg viewBox="0 0 100 70" aria-hidden="true"><g stroke="#123d27" stroke-width="2.2" stroke-linecap="round"><path d="M50 44L14 22M22 27l-2-8M22 27l-8 0M30 32l-2-8M30 32l-9 1M38 37l-1-8M38 37l-9 2M18 24l-6-5"/><path d="M50 44L86 24M78 29l1-8M78 29l8 1M70 34l1-8M70 34l9 1M62 38l0-8M62 38l9 2M82 26l6-5" stroke="#1d5a3a"/></g><g transform="translate(50 50)"><ellipse rx="10" ry="14" fill="#6b4224"/><g fill="#8e5b32" stroke="#4a2c15" stroke-width=".8"><path d="M-8-6q8 4 16 0q-8 6-16 0z"/><path d="M-9 1q9 4 18 0q-9 6-18 0z"/><path d="M-7 8q7 3 14 0q-7 5-14 0z"/><path d="M-5-12q5 3 10 0q-5 4-10 0z"/></g></g></svg>`,
    candy: `<svg viewBox="0 0 100 70" aria-hidden="true"><defs><clipPath id="xdcc"><path d="M58 66V22a14 14 0 0 0-28 0v4h8v-4a6 6 0 0 1 12 0v44z"/></clipPath></defs><path d="M58 66V22a14 14 0 0 0-28 0v4h8v-4a6 6 0 0 1 12 0v44z" fill="#fbf6ee"/><g clip-path="url(#xdcc)" fill="#c4182f"><path d="M24 30l40-20v7L24 37zM24 46l40-20v7L24 53zM24 62l40-20v7L24 69zM20 18l18-14 4 4-18 14z"/></g><path d="M58 66V22a14 14 0 0 0-28 0v4h8v-4a6 6 0 0 1 12 0v44z" fill="none" stroke="#7a0e1d" stroke-width="1"/><g stroke="#1d5a3a" stroke-width="2.4" stroke-linecap="round"><path d="M50 40L22 54M30 50l-6 0M36 47l-4-5"/><path d="M50 40L76 52M68 49l2-6M62 46l7 0"/></g></svg>`,
    bauble: `<svg viewBox="0 0 100 70" aria-hidden="true"><defs><radialGradient id="xdbb" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#ff8e9e"/><stop offset=".35" stop-color="#c8162f"/><stop offset="1" stop-color="#5e0a17"/></radialGradient></defs><path d="M50 2v20" stroke="var(--rb-m)" stroke-width="1.6"/><rect x="45" y="20" width="10" height="7" rx="1.5" fill="#d6b26a" stroke="#8c6a2c"/><circle cx="50" cy="45" r="21" fill="url(#xdbb)"/><path d="M31 41q19 8 38 0" fill="none" stroke="#f6e3ad" stroke-width="2.4" opacity=".85"/><path d="M33 51q17 7 34 0" fill="none" stroke="#f6e3ad" stroke-width="1.4" opacity=".6"/><ellipse cx="42" cy="36" rx="5" ry="3" fill="#fff" opacity=".55" transform="rotate(-30 42 36)"/></svg>`,
    star: `<svg viewBox="0 0 100 70" aria-hidden="true"><defs><linearGradient id="xdst" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3c8"/><stop offset=".5" stop-color="#e6bf68"/><stop offset="1" stop-color="#9a7228"/></linearGradient></defs><path d="M50 4l9.4 19 21 3-15.2 14.8 3.6 20.9L50 51.8l-18.8 9.9 3.6-20.9L19.6 26l21-3z" fill="url(#xdst)" stroke="#7d5b1e" stroke-width="1.2" stroke-linejoin="round"/><path d="M50 4l-4 26 4 22 4-22z" fill="#fff" opacity=".25"/></svg>`,
    bells: `<svg viewBox="0 0 100 70" aria-hidden="true"><defs><linearGradient id="xdbl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0bf"/><stop offset=".45" stop-color="#d9b25e"/><stop offset="1" stop-color="#8a6422"/></linearGradient></defs><g transform="rotate(-18 38 34)"><path d="M38 14c-9 0-13 8-13 18 0 8-4 11-6 13h38c-2-2-6-5-6-13 0-10-4-18-13-18z" fill="url(#xdbl)" stroke="#7d5b1e"/><circle cx="38" cy="47" r="4" fill="#8a6422"/></g><g transform="rotate(16 62 34)"><path d="M62 14c-9 0-13 8-13 18 0 8-4 11-6 13h38c-2-2-6-5-6-13 0-10-4-18-13-18z" fill="url(#xdbl)" stroke="#7d5b1e"/><circle cx="62" cy="47" r="4" fill="#8a6422"/></g><path d="M50 12c-8-8-16-6-14 0 2 5 10 3 14 0zm0 0c8-8 16-6 14 0-2 5-10 3-14 0z" fill="#b3122a" stroke="#6d0b19"/><circle cx="50" cy="12" r="3.4" fill="#8e0f22"/></svg>`,
    orange: `<svg viewBox="0 0 100 70" aria-hidden="true"><g transform="rotate(-12 50 40)"><rect x="22" y="44" width="58" height="7" rx="3.5" fill="#7b4321" stroke="#4a2611"/><rect x="24" y="50" width="56" height="7" rx="3.5" fill="#8d4f27" stroke="#4a2611"/><path d="M26 47h52M28 53h50" stroke="#a9693a" stroke-width="1"/></g><circle cx="48" cy="34" r="22" fill="#d9761c" stroke="#9a4a0e" stroke-width="1.5"/><circle cx="48" cy="34" r="18.5" fill="#f2a43a"/><g stroke="#fbe0a6" stroke-width="1.6"><path d="M48 34V16M48 34l12.7-12.7M48 34h18M48 34l12.7 12.7M48 34v18M48 34L35.3 46.7M48 34H30M48 34L35.3 21.3"/></g><circle cx="48" cy="34" r="2.4" fill="#fbe0a6"/><path d="M70 22l6-6m-3 9l7-3" stroke="#2b6b3f" stroke-width="2.6" stroke-linecap="round"/></svg>`,
    tag: `<svg viewBox="0 0 100 70" aria-hidden="true"><path d="M50 2C42 2 40 10 46 14s2 10-6 12" fill="none" stroke="#efe6d2" stroke-width="1.6" stroke-linecap="round"/><g transform="rotate(14 50 44)"><path d="M38 24h24l6 8v34H32V32z" fill="#d7b98a" stroke="#8d6a44" stroke-width="1.2" stroke-linejoin="round"/><path d="M38 24h24l6 8v34H32V32z" fill="url(#xdtg)" opacity=".35"/><circle cx="50" cy="32" r="3" fill="#6e4f2f"/><circle cx="50" cy="32" r="3.8" fill="none" stroke="#efe6d2" stroke-width="1.2"/><path d="M38 46h24M38 53h18" stroke="#8d6a44" stroke-width="1.6" stroke-linecap="round" opacity=".55"/></g><defs><linearGradient id="xdtg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient></defs></svg>`,
    balloons: `<svg viewBox="0 0 100 70" aria-hidden="true"><g fill="none" stroke="#efe6d2" stroke-width="1"><path d="M50 69C44 56 30 48 30 34"/><path d="M50 69c0-14 2-26 2-40"/><path d="M50 69c6-13 22-20 22-32"/></g><g stroke-linejoin="round"><ellipse cx="30" cy="20" rx="11" ry="13" fill="#ff5d8f"/><path d="M28 32.6h4l-2 3z" fill="#d1376b"/><ellipse cx="52" cy="14" rx="11" ry="13" fill="#ffd166"/><path d="M50 26.6h4l-2 3z" fill="#e0a93a"/><ellipse cx="72" cy="23" rx="10" ry="12" fill="#5ad1c7"/><path d="M70 34.6h4l-2 3z" fill="#2fa59b"/></g><g fill="#fff" opacity=".55"><ellipse cx="26" cy="14" rx="3" ry="4.6" transform="rotate(-20 26 14)"/><ellipse cx="48" cy="8" rx="3" ry="4.6" transform="rotate(-20 48 8)"/><ellipse cx="68.6" cy="17.6" rx="2.6" ry="4.2" transform="rotate(-20 68.6 17.6)"/></g></svg>`,
    candle: `<svg viewBox="0 0 100 70" aria-hidden="true"><defs><clipPath id="xdcd"><rect x="43" y="26" width="14" height="44" rx="2"/></clipPath><radialGradient id="xdfl" cx=".5" cy=".7" r=".6"><stop offset="0" stop-color="#fff6c8"/><stop offset=".55" stop-color="#ffc23d"/><stop offset="1" stop-color="#ff7a1a"/></radialGradient></defs><circle cx="50" cy="15" r="13" fill="#ffd166" opacity=".22"/><rect x="43" y="26" width="14" height="44" rx="2" fill="#fbf2ff"/><g clip-path="url(#xdcd)" fill="#ff5d8f"><path d="M40 34l20-10v6L40 40zM40 48l20-10v6L40 54zM40 62l20-10v6L40 68z"/></g><rect x="43" y="26" width="14" height="44" rx="2" fill="none" stroke="#a3245e" stroke-width=".8"/><path d="M50 26v-4" stroke="#3a2a20" stroke-width="1.4"/><path d="M50 4c-5 6-6 10-6 13a6 6 0 0 0 12 0c0-3-1-7-6-13z" fill="url(#xdfl)"/></svg>`,
    partyhat: `<svg viewBox="0 0 100 70" aria-hidden="true"><defs><linearGradient id="xdph" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff7aa8"/><stop offset=".55" stop-color="#d13b77"/><stop offset="1" stop-color="#7b2a8f"/></linearGradient><clipPath id="xdphc"><path d="M50 9L30 64h40z"/></clipPath></defs><path d="M50 9L30 64h40z" fill="url(#xdph)" stroke="#5b1e66" stroke-width="1" stroke-linejoin="round"/><g clip-path="url(#xdphc)"><path d="M26 30l50 14v6L26 36zM26 48l50 14v6L26 54z" fill="#ffd166" opacity=".9"/><g fill="#fff"><circle cx="45" cy="24" r="1.6"/><circle cx="54" cy="40" r="1.6"/><circle cx="42" cy="44" r="1.4"/></g></g><rect x="28" y="62" width="44" height="6" rx="3" fill="#ffd166" stroke="#c48a1e" stroke-width=".8"/><g fill="#5ad1c7"><circle cx="50" cy="8" r="6"/></g><g stroke="#2fa59b" stroke-width="1.2" stroke-linecap="round"><path d="M46 4l8 8M54 4l-8 8M50 2v12M44 8h12"/></g></svg>`,
    rings: `<svg viewBox="0 0 100 70" aria-hidden="true"><defs><linearGradient id="xdrg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3c8"/><stop offset=".45" stop-color="#e2b866"/><stop offset="1" stop-color="#8a6422"/></linearGradient><linearGradient id="xdrs" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#c9ced6"/><stop offset="1" stop-color="#6c737e"/></linearGradient></defs><circle cx="40" cy="44" r="17" fill="none" stroke="url(#xdrg)" stroke-width="5.5"/><circle cx="60" cy="40" r="17" fill="none" stroke="url(#xdrs)" stroke-width="5.5"/><path d="M28.5 31.5a17 17 0 0 1 11.5-4.5" fill="none" stroke="url(#xdrg)" stroke-width="5.5"/><path d="M60 23l-5-6 5-6 5 6z" fill="#e8f4ff" stroke="#8fb3d9" stroke-width="1"/><path d="M60 11l-2 6h4z" fill="#fff" opacity=".8"/></svg>`,
    rose: `<svg viewBox="0 0 100 70" aria-hidden="true"><g fill="#2b7a4b" stroke="#164a2c" stroke-width=".8"><path d="M50 46C38 40 26 44 16 36c8-4 22-4 34 10z"/><path d="M50 46c12-8 24-6 34-14-8-3-22-2-34 14z"/><path d="M48 50c-6 6-14 8-20 16 8 0 16-4 20-16z"/></g><g transform="translate(40 40)"><circle r="13" fill="#b3123a"/><path d="M-9-4a10 10 0 0 1 18 0M-6 1a7 7 0 0 1 12 0M-3 5a4 4 0 0 1 6 0" fill="none" stroke="#6d0b22" stroke-width="1.6" stroke-linecap="round"/><path d="M-11 3c3 8 19 8 22 0" fill="none" stroke="#7d0e27" stroke-width="1.4"/></g><g transform="translate(62 44) scale(.82)"><circle r="13" fill="#e889a2"/><path d="M-9-4a10 10 0 0 1 18 0M-6 1a7 7 0 0 1 12 0M-3 5a4 4 0 0 1 6 0" fill="none" stroke="#b04d68" stroke-width="1.6" stroke-linecap="round"/><path d="M-11 3c3 8 19 8 22 0" fill="none" stroke="#b04d68" stroke-width="1.4"/></g></svg>`,
    heart: `<svg viewBox="0 0 100 70" aria-hidden="true"><defs><radialGradient id="xdhr" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#ff9fb2"/><stop offset=".45" stop-color="#d81b48"/><stop offset="1" stop-color="#7a0b25"/></radialGradient></defs><path d="M50 66S20 48 20 28c0-10 7-17 15-17 7 0 12 4 15 10 3-6 8-10 15-10 8 0 15 7 15 17 0 20-30 38-30 38z" fill="url(#xdhr)" stroke="#5e0a1c" stroke-width="1.2"/><ellipse cx="34" cy="24" rx="6" ry="3.6" fill="#fff" opacity=".5" transform="rotate(-35 34 24)"/></svg>`,
  };

  /** Inner markup of the present (wrap it in an element with class "gift") */
  function markup() {
    return `<span class="gift-shadow"></span>
      <span class="base"><span class="ribbon-v"></span><span class="ribbon-h"></span><span class="seal" aria-hidden="true"></span></span>
      <span class="lid"><span class="lid-body"></span><span class="ribbon-v"></span>
        <span class="deco" aria-hidden="true"></span>
        <span class="bow" aria-hidden="true"><span class="tail l"></span><span class="tail r"></span>
          <span class="loop l2"></span><span class="loop r2"></span>
          ${Array.from({ length: 8 }, (_, i) => `<span class="loop p p${i}"></span>`).join("")}
          <span class="loop l"></span><span class="loop r"></span><span class="knot"></span></span>
      </span>`;
  }

  window.XDwrap = { GROUPS, inkRgb, PAPERS, INKS, RIBBONS, PATTERNS, RIBBON_STYLES, BOWS, DECOS, DECO_SVG, PHOTO_FRAMES, REVEALS, DEFAULT, OPACITY, normalize, ready, inkOf, vars, apply, classes, markup };
})();
