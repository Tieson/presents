/**
 * E-mails with the secret workshop link, sent over SMTP (e.g. the hosting's mailbox).
 *
 * Enabled only when SMTP_HOST, MAIL_FROM and APP_URL are set. APP_URL is the public address
 * of the site (https://darky.example.cz) and is the only base used for links in e-mails,
 * so a forged Host header can never put someone else's domain into a message.
 *
 *   SMTP_HOST, SMTP_PORT (465 = TLS, 587/25 = STARTTLS), SMTP_SECURE (tls | starttls | none),
 *   SMTP_USER, SMTP_PASS, MAIL_FROM ("Ježíškova dílna <dilna@example.cz>"), MAIL_REPLY_TO, APP_URL
 */

export function mailConfigFromEnv(env = process.env) {
  const host = (env.SMTP_HOST || "").trim();
  const from = (env.MAIL_FROM || "").trim();
  const appUrl = (env.APP_URL || "").trim().replace(/\/+$/, "");
  if (!host || !from || !appUrl) return null;
  const port = Number(env.SMTP_PORT || 587);
  const secure = (env.SMTP_SECURE || (port === 465 ? "tls" : "starttls")).toLowerCase();
  return {
    host, port, secure,
    user: env.SMTP_USER || "", pass: env.SMTP_PASS || "",
    from, replyTo: (env.MAIL_REPLY_TO || "").trim(), appUrl
  };
}

/** transport: optional { send({ from, to, replyTo, subject, text, html }) } – tests only */
export function createMailer(cfg, transport = null) {
  if (!cfg) return { enabled: false, async send() { throw new Error("E-maily nejsou nastavené."); } };
  let tx = transport;
  async function getTransport() {
    if (tx) return tx;
    const nodemailer = (await import("nodemailer")).default;
    const t = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure === "tls",
      requireTLS: cfg.secure === "starttls",
      ignoreTLS: cfg.secure === "none",
      auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000
    });
    tx = { send: m => t.sendMail(m) };
    return tx;
  }
  return {
    enabled: true,
    appUrl: cfg.appUrl,
    linkFor: key => `${cfg.appUrl}/dilna#klic=${key}`,
    async send({ to, subject, text, html }) {
      const t = await getTransport();
      await t.send({ from: cfg.from, to, replyTo: cfg.replyTo || undefined, subject, text, html });
    }
  };
}

/* ---------- message text (same wording in php/api.php) ---------- */

const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * kind: "welcome" (just created), "link" (asked for it in the workshop),
 *       "recover" (lost link, asked by e-mail), "rotated" (link was replaced)
 */
export function linkMessage(kind, { name, link }) {
  const subject = {
    welcome: `Tvoje Ježíškova dílna „${name}“`,
    link: `Odkaz do dílny „${name}“`,
    recover: `Odkaz do dílny „${name}“`,
    rotated: `Nový odkaz do dílny „${name}“`
  }[kind];
  const lead = {
    welcome: "dílna je připravená. Tímhle odkazem se do ní dostaneš z jakéhokoli zařízení:",
    link: "posíláme odkaz do tvé dílny, jak sis řekl(a):",
    recover: "někdo (nejspíš ty) požádal o odkaz do dílny s touhle e-mailovou adresou. Tady je:",
    rotated: "odkaz do dílny byl právě vyměněn za nový. Starý už neplatí. Nový je tady:"
  }[kind];
  const foot = kind === "recover"
    ? "Pokud jsi o odkaz nežádal(a), tenhle e-mail klidně smaž. Bez odkazu se do dílny nikdo nedostane."
    : "Kdo má odkaz, může dárky upravovat, tak ho nikomu nepřeposílej.";

  const text = `Ahoj,\n\n${lead}\n\n${link}\n\n${foot}\n\nVeselé Vánoce\nJežíškova dílna\n`;
  const html = `<!doctype html><html lang="cs"><body style="margin:0;padding:0;background:#05140e">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#05140e;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#0b241a;border:1px solid #d6b26a;font-family:Georgia,'Times New Roman',serif;color:#f3ead6">
<tr><td style="padding:36px 32px 8px;text-align:center">
<p style="margin:0;font:12px/1 Arial,sans-serif;letter-spacing:4px;text-transform:uppercase;color:#d6b26a">Ježíškova dílna</p>
<h1 style="margin:14px 0 0;font-weight:normal;font-style:italic;font-size:30px;line-height:1.15;color:#f6e3ad">${escHtml(name)}</h1>
</td></tr>
<tr><td style="padding:18px 32px 0;font:16px/1.55 Arial,sans-serif;color:#e8e0cc">Ahoj,<br>${escHtml(lead)}</td></tr>
<tr><td align="center" style="padding:24px 32px">
<a href="${escHtml(link)}" style="display:inline-block;padding:15px 26px;background:#d6b26a;color:#2a1a10;font:bold 13px/1 Arial,sans-serif;letter-spacing:3px;text-transform:uppercase;text-decoration:none;border-radius:3px">Otevřít dílnu</a>
</td></tr>
<tr><td style="padding:0 32px;font:12px/1.5 'Courier New',monospace;color:#b7b29a;word-break:break-all;text-align:center">${escHtml(link)}</td></tr>
<tr><td style="padding:22px 32px 32px;font:13px/1.55 Arial,sans-serif;color:#b7b29a">${escHtml(foot)}<br><br>Veselé Vánoce<br>Ježíškova dílna</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}

/* ---------- gift e-mails (same wording in php/api.php) ---------- */

const GIFT_TEXT = {
  christmas: {
    unlocked: ["Ježíšek ti nadělil dárek", "Ježíšek ti nadělil dárek. Už je pod stromečkem a můžeš si ho rozbalit."],
    ring: ["Cinkylink! Ježíšek zazvonil", "Ježíšek právě zazvonil zvonečkem. Dárek už je pod stromečkem."]
  },
  birthday: {
    unlocked: ["Máš narozeninový dárek", "Narozeninový dárek je připravený a můžeš si ho rozbalit. Všechno nejlepší!"],
    ring: ["Frrrk! Někdo na tebe troubí", "Někdo ti zatroubil na frkačku. Narozeninový dárek na tebe čeká."]
  },
  wedding: {
    unlocked: ["Váš svatební dar je připravený", "Svatební dar je připravený k rozbalení. Hodně štěstí na společné cestě!"],
    ring: ["Cink! Někdo si s vámi připíjí", "Někdo vám cinkl skleničkou. Svatební dar na vás čeká."]
  },
  general: {
    unlocked: ["Máš dárek", "Někdo ti poslal dárek a teď už si ho můžeš rozbalit."],
    ring: ["Ťuk ťuk! Dárek na tebe čeká", "Někdo ti zaťukal na dveře. Dárek na tebe čeká."]
  }
};

function mailHtml({ eyebrow, heading, lead, button, link, foot }) {
  return `<!doctype html><html lang="cs"><body style="margin:0;padding:0;background:#05140e">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#05140e;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#0b241a;border:1px solid #d6b26a;font-family:Georgia,'Times New Roman',serif;color:#f3ead6">
<tr><td style="padding:36px 32px 8px;text-align:center">
<p style="margin:0;font:12px/1 Arial,sans-serif;letter-spacing:4px;text-transform:uppercase;color:#d6b26a">${escHtml(eyebrow)}</p>
<h1 style="margin:14px 0 0;font-weight:normal;font-style:italic;font-size:30px;line-height:1.15;color:#f6e3ad">${escHtml(heading)}</h1>
</td></tr>
<tr><td style="padding:18px 32px 0;font:16px/1.55 Arial,sans-serif;color:#e8e0cc;text-align:center">${escHtml(lead)}</td></tr>
<tr><td align="center" style="padding:24px 32px">
<a href="${escHtml(link)}" style="display:inline-block;padding:15px 26px;background:#d6b26a;color:#2a1a10;font:bold 13px/1 Arial,sans-serif;letter-spacing:3px;text-transform:uppercase;text-decoration:none;border-radius:3px">${escHtml(button)}</a>
</td></tr>
<tr><td style="padding:0 32px 32px;font:13px/1.55 Arial,sans-serif;color:#b7b29a;text-align:center">${escHtml(foot)}</td></tr>
</table></td></tr></table></body></html>`;
}

/**
 * kind "unlocked" | "ring": to the recipient, link = the box
 * kind "opened": to the creator, link = the workshop (never the secret key)
 */
export function giftMessage(kind, theme, { title, link, hasPassword }) {
  if (kind === "opened") {
    const subject = `Dárek „${title}“ je rozbalený`;
    const lead = `Obdarovaný si právě rozbalil tvůj dárek „${title}“. V dílně uvidíš, kdy dárek otevřel a rozbalil.`;
    const foot = "Tohle upozornění vypneš v dílně v okně Moje dílna.";
    return { subject, text: `Ahoj,\n\n${lead}\n\n${link}\n\n${foot}\n`, html: mailHtml({ eyebrow: "Dárek je rozbalený", heading: title, lead, button: "Otevřít dílnu", link, foot }) };
  }
  const t = (GIFT_TEXT[theme] || GIFT_TEXT.christmas)[kind === "ring" ? "ring" : "unlocked"];
  const subject = title ? `${t[0]}: ${title}` : t[0];
  const foot = hasPassword ? "Dárek je zamčený heslem. Prozradí ti ho ten, kdo ho balil." : "Stačí kliknout na tlačítko.";
  return {
    subject,
    text: `Ahoj,\n\n${t[1]}\n\n${link}\n\n${foot}\n`,
    html: mailHtml({ eyebrow: t[0], heading: title || "Dárek pro tebe", lead: t[1], button: "Rozbalit dárek", link, foot })
  };
}

/** Short texts for system notifications (the service worker shows them) */
export const PUSH_TEXT = {
  unlocked: (theme, title) => ({ title: (GIFT_TEXT[theme] || GIFT_TEXT.christmas).unlocked[0], body: title ? `„${title}“ už jde rozbalit.` : "Dárek už jde rozbalit." }),
  ring: (theme, title) => ({ title: (GIFT_TEXT[theme] || GIFT_TEXT.christmas).ring[0], body: title ? `„${title}“ na tebe čeká.` : "Dárek na tebe čeká." }),
  viewed: (_, title) => ({ title: "Dárek si někdo otevřel", body: `Odkaz na „${title}“ se právě poprvé otevřel.` }),
  opened: (_, title) => ({ title: "Dárek je rozbalený 🎁", body: `„${title}“ si obdarovaný právě rozbalil.` })
};
