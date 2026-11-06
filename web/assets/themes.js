/* Occasions: Christmas, birthday, wedding and "just because".
   A box remembers its occasion, so the recipient always sees the style it was made in.
   Keys must match THEMES in server/app.js and php/api.php. */
(function () {
  const plural = (n, one, few, many) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);

  const THEMES = {
    christmas: {
      name: "Vánoce",
      workshop: ["Ježíškova", "dílna"],
      eyebrow: "Štědrý večer",
      h1: ["Šťastné a veselé", "Vánoce"],
      lede: "Pod stromečkem na tebe něco čeká. Rozbal si svůj dárek.",
      ledeTitle: "Pod stromečkem na tebe něco čeká.",
      ledeLocked: "Ježíšek už ti dárek nadělil. Rozbalit ho půjde na Štědrý večer.",
      docTitle: "Vánoční dárek",
      defaultTitle: "Veselé Vánoce",
      postcard: "Veselé Vánoce",
      pwNote: "Ježíšek ti ho pošeptal. Napiš ho sem.",
      messagePh: "Ať jsou letošní Vánoce plné klidu a vůně cukroví…",
      ring: { label: "Zazvonit zvonečkem", done: "Cinkylink! Zvoneček zazvonil.", note: "Ježíšek zazvonil. Dárek je pod stromečkem!" },
      when: { first: "christmas", custom: ["Vlastní čas", "Slavíte jindy? Nastav datum a hodinu."], anytime: "I před Štědrým dnem" },
      appearance: { paper: "burgundy", pattern: "stripes", ribbon: "gold", ribbonStyle: "cross", bow: "classic", deco: "none", seal: "V" },
      fx: "snow", delivery: "jezisek",
      /** footline: days to Christmas Eve */
      footline(now = new Date()) {
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const days = Math.round((new Date(now.getFullYear(), 11, 24) - today) / 86400000);
        if (days > 0) return `Do Štědrého večera ${days >= 2 && days <= 4 ? "zbývají" : "zbývá"} <b>${days}</b> ${plural(days, "den", "dny", "dní")}`;
        if (days === 0) return "Dnes je <b>Štědrý den</b>";
        return "Krásné <b>vánoční svátky</b>";
      }
    },
    birthday: {
      name: "Narozeniny",
      workshop: ["Narozeninová", "dílna"],
      eyebrow: "Narozeniny",
      h1: ["Všechno nejlepší", "k narozeninám"],
      lede: "Na oslavenkyni nebo oslavence čeká dárek. Rozbal si ho.",
      ledeTitle: "Oslava může začít.",
      ledeLocked: "Dárek už dorazil. Rozbalit ho půjde v den oslavy.",
      docTitle: "Narozeninový dárek",
      defaultTitle: "Všechno nejlepší",
      postcard: "Všechno nejlepší!",
      pwNote: "Heslo ti prozradil ten, kdo dárek balil.",
      messagePh: "Hodně zdraví, štěstí a ať se ti splní, co si přeješ…",
      ring: { label: "Zatroubit na frkačku", done: "Frrrk! Oslavenec to slyšel.", note: "Někdo zatroubil na frkačku. Dárek čeká!" },
      when: { first: null, custom: ["V den oslavy", "Nastav datum a hodinu, kdy se slaví."], anytime: "Hned, bez čekání" },
      appearance: { paper: "midnight", pattern: "dots", patternColor: "gold", ribbon: "pink", ribbonStyle: "cross", bow: "rosette", deco: "none", seal: "" },
      fx: "confetti", delivery: "balloons",
      footline: () => "Ať ti to <b>pořádně</b> oslaví"
    },
    wedding: {
      name: "Svatba",
      workshop: ["Svatební", "dílna"],
      eyebrow: "Svatba",
      h1: ["Hodně štěstí", "novomanželům"],
      lede: "Svatební dar je připravený. Rozbalte si ho.",
      ledeTitle: "S láskou pro novomanžele.",
      ledeLocked: "Svatební dar už je na místě. Rozbalit ho půjde v den svatby.",
      docTitle: "Svatební dar",
      defaultTitle: "Svatební dar",
      postcard: "Ať vám to spolu klape",
      pwNote: "Heslo vám prozradí ten, kdo dar chystal.",
      messagePh: "Ať je vaše společná cesta plná lásky, smíchu a porozumění…",
      ring: { label: "Cinknout skleničkou", done: "Cink! Novomanželé to slyšeli.", note: "Někdo si s vámi připíjí. Svatební dar čeká!" },
      when: { first: null, custom: ["V den svatby", "Nastav datum a hodinu obřadu nebo hostiny."], anytime: "Hned, bez čekání" },
      appearance: { paper: "ivory", pattern: "hearts", patternColor: "gold", patternOpacity: 30, ribbon: "white", ribbonStyle: "single", bow: "double", deco: "none", seal: "♥" },
      fx: "petals", delivery: "petals",
      footline: () => "S láskou <b>a přáním všeho dobrého</b>"
    },
    general: {
      name: "Pro radost",
      workshop: ["Dárková", "dílna"],
      eyebrow: "Pro radost",
      h1: ["Malá radost", "jen pro tebe"],
      lede: "Někdo ti poslal dárek. Rozbal si ho.",
      ledeTitle: "Někdo na tebe myslí.",
      ledeLocked: "Dárek už je tady. Rozbalit ho půjde v nastavený čas.",
      docTitle: "Dárek pro tebe",
      defaultTitle: "Dárek pro tebe",
      postcard: "S láskou",
      pwNote: "Heslo ti prozradil ten, kdo dárek balil.",
      messagePh: "Jen tak, pro radost…",
      ring: { label: "Zaťukat na dveře", done: "Ťuk ťuk! Upozornění odešlo.", note: "Ťuk ťuk! Dárek na tebe čeká." },
      when: { first: null, custom: ["V určitý čas", "Nastav datum a hodinu odemčení."], anytime: "Hned, bez čekání" },
      appearance: { paper: "emerald", pattern: "stars", patternColor: "gold", ribbon: "copper", ribbonStyle: "cross", bow: "classic", deco: "none", seal: "" },
      fx: "sparkle", delivery: "drop",
      footline: () => "Udělej někomu <b>radost</b> taky"
    }
  };
  const DEFAULT = "christmas";
  const get = k => THEMES[k] || THEMES[DEFAULT];
  const keyOf = k => (THEMES[k] ? k : DEFAULT);

  /** Small icons for the switcher (stroke = currentColor) */
  const ICONS = {
    christmas: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.5l2.2 3.6h-1.5l3 4.2h-1.9l3.4 4.9H6.8l3.4-4.9H8.3l3-4.2H9.8z"/><path d="M12 15.2v4.3M9 21h6"/></svg>`,
    birthday:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4 21h16M5 21v-7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7"/><path d="M5 16c1.2 1 2.5 1 3.5 0s2.3-1 3.5 0 2.3 1 3.5 0 2.3-1 3.5 0"/><path d="M8 12V9M12 12V9M16 12V9"/><path d="M8 6.2c-.6-.8 0-1.8 0-2.4.6.6 1 1.6 0 2.4zM12 6.2c-.6-.8 0-1.8 0-2.4.6.6 1 1.6 0 2.4zM16 6.2c-.6-.8 0-1.8 0-2.4.6.6 1 1.6 0 2.4z"/></svg>`,
    wedding:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="9" cy="14" r="5.5"/><circle cx="15" cy="14" r="5.5"/><path d="M13.2 5.5l1.8-2.5 1.8 2.5-1.8 1.8z" stroke-linejoin="round"/></svg>`,
    general:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="9" width="17" height="11.5" rx="1.5"/><path d="M2.5 6.5h19V9h-19zM12 6.5v14"/><path d="M12 6.5C10 3 6.5 3.4 7.3 5.4 8 7 12 6.5 12 6.5zm0 0c2-3.5 5.5-3.1 4.7-1.1C16 7 12 6.5 12 6.5z"/></svg>`
  };

  /** What "ringing" looks like on the recipient's page (and on the creator's button) */
  const RING_ICONS = {
    christmas: `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="xdrb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff2c4"/><stop offset=".5" stop-color="#dcb35c"/><stop offset="1" stop-color="#8a6422"/></linearGradient></defs><path d="M32 8c-11 0-16 9-16 21 0 9-4 13-7 16h46c-3-3-7-7-7-16 0-12-5-21-16-21z" fill="url(#xdrb)" stroke="#7d5b1e" stroke-width="1.5"/><circle cx="32" cy="50" r="5" fill="#8a6422"/><path d="M32 8c-7-7-15-5-13 1 2 5 9 3 13-1zm0 0c7-7 15-5 13 1-2 5-9 3-13-1z" fill="#b3122a" stroke="#6d0b19"/></svg>`,
    birthday:  `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M8 40l30-22 6 14z" fill="#ff5d8f" stroke="#a3245e" stroke-width="1.5" stroke-linejoin="round"/><path d="M15 35l6-4M22 30l6-4M29 25l5-4" stroke="#ffd166" stroke-width="3"/><path d="M41 25c6-2 9 2 6 6s1 9 7 7" fill="none" stroke="#5ad1c7" stroke-width="3" stroke-linecap="round"/><g fill="#ffd166"><circle cx="50" cy="14" r="2.5"/><circle cx="56" cy="24" r="2"/><path d="M44 8l1.5 3.5L49 13l-3.5 1.5L44 18l-1.5-3.5L39 13l3.5-1.5z"/></g></svg>`,
    wedding:   `<svg viewBox="0 0 64 64" aria-hidden="true"><g stroke="#e3c9a0" stroke-width="2" fill="rgba(248,234,210,.25)" stroke-linejoin="round"><path d="M14 12h14l-2 16a5 5 0 0 1-10 0z" transform="rotate(-14 21 30)"/><path d="M36 12h14l-2 16a5 5 0 0 1-10 0z" transform="rotate(14 43 30)"/><path d="M24 36v14m-6 0h12M40 36v14m-6 0h12" fill="none" transform="translate(0 0)"/></g><path d="M19 22h8M37 22h8" stroke="#f6d5da" stroke-width="5" transform="translate(0 2)" opacity=".7"/><g fill="#fff3c8"><path d="M32 4l1.5 4 4 1.5-4 1.5L32 15l-1.5-4-4-1.5 4-1.5z"/></g></svg>`,
    general:   `<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="14" y="8" width="36" height="50" rx="2" fill="#7a4a2a" stroke="#4a2611" stroke-width="1.5"/><rect x="19" y="13" width="26" height="18" rx="1" fill="none" stroke="#a9693a"/><rect x="19" y="35" width="26" height="18" rx="1" fill="none" stroke="#a9693a"/><circle cx="43" cy="34" r="2.5" fill="#e2b866"/><g stroke="#f8e2ad" stroke-width="2.5" stroke-linecap="round"><path d="M54 18l6-4M55 26h7M54 34l6 4"/></g></svg>`
  };

  /** Applies the occasion to the page: data-theme drives the palette in base.css, fx.js the particles */
  function applyPage(k) {
    k = keyOf(k);
    document.documentElement.dataset.theme = k;
    window.XDfx?.setMode?.(get(k).fx);
    return get(k);
  }

  window.XDthemes = { THEMES, ICONS, RING_ICONS, DEFAULT, get, keyOf, applyPage };
})();
