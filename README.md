# Vánoční dárky 🎁

Online dárkové boxy s poukazy v PDF. Příjemce otevře odkaz (např. `https://darky.cz/bekalo-mitusa`),
zadá heslo a ve stanovený čas si dárek „rozbalí“. Dárky se balí v **Ježíškově dílně** na `/dilna`, kterou si může založit kdokoli.

## Co umí

- **Vlastní dílna pro každého, bez registrace a hesla.** Na `/dilna` si ji kdokoli založí jedním kliknutím (název a e-mail jsou nepovinné) a dostane **tajný odkaz** `…/dilna#klic=…`. Odkaz je jediný klíč: kdo ho má, může dárky upravovat, takže jde i sdílet. V dílně se dá kdykoli zobrazit a zkopírovat, nebo vyměnit za nový (starý přestane platit a ostatní zařízení se odhlásí). Na zařízení, kde se odkaz jednou otevřel, zůstane přihlášení rok. Dílnu jde smazat i se všemi boxy a PDF.
- **Dárkové boxy** s vlastním názvem („Dárek pro sestřičku“). U každého jde nastavit, jestli název uvidí i příjemce.
- **Položky** s názvem, popisem a PDF poukazem. Řadí se přetažením za úchyt, šipkami nebo klávesnicí (fokus na úchytu + ↑/↓). Příjemce je vidí vždy.
- **Adresa** = kód ze slabik (`bekalo-mitusa`), dobře se čte i opisuje. Kód jde kdykoli vygenerovat znovu.
- **Heslo**, nebo dárek bez hesla. Na velikosti písmen a diakritice nezáleží. Server ukládá jen otisk (PBKDF2).
- **Čas odemčení:** Štědrý večer (24. 12. 18:00), vlastní datum a čas, nebo „kdykoli“. Navíc **ruční odemčení** jedním přepínačem.
- **Vše kontroluje backend:** heslo, čas odemčení (podle hodin serveru) i stažení PDF. Odkaz na PDF má podepsaný token a server při každém stažení znovu ověří i zámek.
- **Vzhled krabice:** 14 papírů (i hnědý balicí, zlatý nebo mrazivě modrý) a 13 vzorů, z toho vánoční: stromky, baňky, cesmína, lízátka, perníčky, sobi, srdíčka, vločky a hvězdičky. U vzoru jde nastavit **barvu** (nabídka sedí k papíru) a **výraznost** posuvníkem. Dál 10 barev stuhy, převázání do kříže, jednou stuhou nebo bez stuhy, 5 druhů **mašle** (klasická, dvojitá, růžice, malá, bez mašle), 7 **ozdob** (cesmína, jehličí se šiškou, lízátko, baňka, hvězda, zvonečky, pomeranč se skořicí) a pečeť s iniciálami. Živý náhled v dílně, ikonky v seznamu boxů mají stejné barvy.
- **Fotka nebo pohled:** do boxu jde vložit vlastní fotku. Po rozbalení ji příjemce uvidí jako polaroid s popiskem, nebo jako pohlednici s věnováním a známkou. Prohlížeč fotku před nahráním zmenší (max. 1600 px) a uloží znovu jako JPEG, čímž z ní zmizí i údaje o místě pořízení (EXIF/GPS). Fotka je chráněná stejně jako PDF: až po hesle a v čase odemčení.
- **Rozbalování:** najednou, postupně (každá položka je malá krabička) nebo ať si vybere příjemce. Postup se příjemci pamatuje i po zavření stránky. „Zabalit znovu“ ho vynuluje.
- Náhled jako příjemce pro přihlášeného tvůrce (obejde heslo i zámek).
- **Úvodní stránka** je rozcestník: „Zabalit dárek“ (→ dílna) nebo „Mám kód dárku“. Po rozbalení celého dárku příjemce uvidí pozvánku zabalit vlastní dárek a tip uložit si stránku do záložek.
- **Příležitosti:** Vánoce, narozeniny, svatba a „Pro radost“ (cokoli jiného). Přepínají se nahoře v dílně. Každá má vlastní název dílny (Ježíškova, Narozeninová, Svatební, Dárková), barvy, texty, výchozí vzhled krabice, částice v pozadí (sníh, konfety, okvětní lístky, jiskry) a **doručení**: na Vánoce přiletí Ježíšek jako světýlko a zazvoní zvoneček, na narozeniny dárek přiletí na balóncích, na svatbu vykvete ze světla, jinak spadne a odrazí se. Box si příležitost pamatuje, takže ji příjemce vidí vždy ve stylu, ve kterém byl zabalený.
- **Kdo dárek viděl:** dílna ukazuje, kolikrát a kdy se odkaz otevřel a kdy byl dárek rozbalen. Tvůrcovy vlastní návštěvy a náhledy se nepočítají. V seznamu boxů je u každého zámek (zamčeno/odemčeno) a stav „Otevřeno 2×, nerozbaleno“ nebo „Rozbaleno 24. 12. 18:03“.
- **Upozornění:**
  - E-mail obdarovanému **v čas odemčení** (s odkazem, bez hesla), případně hned po ručním odemčení.
  - Tlačítko **Zazvonit zvonečkem** (u narozenin „Zatroubit na frkačku“, u svatby „Cinknout skleničkou“, jinak „Zaťukat na dveře“) pošle e-mail i systémové upozornění. Kdo má dárek otevřený, tomu zazvoní přímo na stránce.
  - Obdarovaný si na čekající stránce může zapnout **upozornění v prohlížeči/systému**, tvůrce v dílně taky (přijde, když někdo dárek poprvé otevře a rozbalí). Tvůrci navíc přijde e-mail při prvním rozbalení (jde vypnout).
- **E-maily s odkazem do dílny (nepovinné, přes SMTP).** Po založení přijde odkaz e-mailem. V dílně ho jde poslat znovu a po výměně přijde nový. Kdo odkaz ztratí, nechá si ho poslat na uložený e-mail. Bez nastaveného SMTP se e-mail jen uloží a nic se neposílá.

## Struktura

```
web/                 frontend (Vite): index.html = příjemce, admin.html = dílna, assets/
api/index.js         Vercel serverless funkce – vstup pro celé /api/*
server/              Node backend: app.js (API), security.js, mail.js (SMTP), storage/ (fs | Upstash+Blob),
                     standalone.js (vlastní server), node-adapter.js, env.js
php/                 PHP backend se stejným API (PHP 7.4+, Apache + mod_rewrite)
scripts/             build-php.mjs, test.mjs
tests/               end-to-end testy API a e-mailů (běží proti Node i PHP)
vite.config.js       build + dev server s API
vercel.json          nastavení Vercelu (build, přepisy adres, hlavičky)
```

| Příkaz | Co dělá |
|---|---|
| `npm run dev` | Vite na http://localhost:5173 i s API (data do `./data`), dílna na `/dilna` |
| `npm run build` | frontend do `dist/` (to nasazuje Vercel) |
| `npm run build:php` | hotová složka `build/php/` pro PHP hosting |
| `npm start` | samostatný Node server nad `dist/` (VPS, Docker) |
| `npm test` | testy API proti Node backendu (souborové úložiště + Redis/Blob v paměti); `npm test -- <url>` proti libovolnému běžícímu backendu, např. PHP |

Data jsou mezi backendy přenositelná (stejný JSON i formát hashů hesel). Popis API je v `API.md`.

---

## Vercel (hlavní nasazení, automaticky z repa)

Jednorázové nastavení:

1. Ve Vercelu **Add New → Project** a importuj tenhle repozitář. Root Directory nech prázdné (kořen), framework se načte z `vercel.json` (Vite).
2. **Storage → Create / Connect**:
   - **Upstash for Redis** (Marketplace). Doplní `KV_REST_API_URL` a `KV_REST_API_TOKEN` (nebo `UPSTASH_REDIS_REST_*`). Fungují obě varianty.
   - **Blob** a zvol **Private**. Doplní `BLOB_READ_WRITE_TOKEN`.
   - **Sdílená databáze nebo prefix proměnných:** když integraci dáš prefix (např. `present` → `present_KV_REST_API_URL`), aplikace proměnné najde sama. `STORAGE_ENV_PREFIX=present` je potřeba jen tehdy, když je v projektu připojených víc Redis databází. Všechny klíče v Redisu začínají na `xd:`, takže se s jiným projektem nepotkají. Jiný začátek jde nastavit přes `REDIS_KEY_PREFIX`.
3. **Settings → Environment Variables**:
   - `APP_SECRET` = dlouhý náhodný řetězec (`openssl rand -base64 32`), povinný
   - volitelně `SIGNUP_CODE`, pokud nechceš, aby si dílnu mohl založit kdokoli
4. Spusť **Redeploy**, aby se proměnné načetly.

Pak už každý push do `main` nasadí produkci a každá jiná větev nebo PR dostane náhledovou adresu.
Dílny se zakládají na `https://<projekt>.vercel.app/dilna`.

> **Limit PDF na Vercelu je 4 MB.** Víc Vercel funkce v jednom požadavku nepřijme. Změní se proměnnou `MAX_UPLOAD_MB`, ale nad ~4,5 MB to nepomůže.
> Při veřejném Blob úložišti nastav `BLOB_ACCESS=public`. Soubory se i tak posílají jen přes API, adresa blobu se nikam nedostane.

## PHP hosting (ruční nasazení)

```bash
npm ci
APP_URL=https://darky.example.cz npm run build:php        # → build/php/
```

`APP_URL` při sestavení doplní plnou adresu náhledového obrázku pro sdílení odkazu (Messenger, WhatsApp, Facebook). Bez něj zůstane relativní. Na Vercelu se vezme jeho produkční doména sama.

1. Obsah `build/php/` (včetně `.htaccess`) nahraj přes FTP do webrootu nebo podsložky.
2. Na serveru zkopíruj `config.sample.php` → `config.php` a vyplň `APP_SECRET` (případně `SIGNUP_CODE`).
3. Ideálně nastav `DATA_DIR` mimo veřejný webroot. Když zůstane uvnitř, chrání ho `.htaccess`.
4. Hosting musí mít zapnutý `mod_rewrite` (běžně ano) a PHP 7.4 nebo novější s `json`, `mbstring`, `hash`.
5. U větších PDF zkontroluj `upload_max_filesize` a `post_max_size`.

Lokální zkouška: `cd build/php && php -S localhost:8000 router.php`.

## Vlastní Node server (VPS, Docker)

```bash
cp .env.example .env     # vyplň APP_SECRET
npm ci && npm run build
npm start                # http://localhost:3000, data v ./data
```

Za reverzní proxy (nginx, Caddy) posílej `X-Forwarded-Proto`, aby cookie dostala příznak `Secure`.

## E-maily (SMTP)

Nepovinné. Zapnou se, když jsou nastavené `SMTP_HOST`, `MAIL_FROM` a `APP_URL`. Stačí obyčejná schránka u hostingu.

| Proměnná | Příklad | |
|---|---|---|
| `APP_URL` | `https://darky.example.cz` | veřejná adresa webu, z ní se skládá odkaz v e-mailu |
| `MAIL_FROM` | `Ježíškova dílna <dilna@example.cz>` | odesílatel, ideálně adresa z vlastní domény (kvůli SPF/DKIM) |
| `SMTP_HOST` | `smtp.example.cz` | |
| `SMTP_PORT` | `465` | 465 = TLS, 587 = STARTTLS |
| `SMTP_SECURE` | | prázdné = podle portu, jinak `tls` / `starttls` / `none` |
| `SMTP_USER`, `SMTP_PASS` | | přihlášení ke schránce |
| `MAIL_REPLY_TO` | | nepovinné |

V PHP se to samé vyplní v `config.php`. Když hosting SMTP nenabízí, jde v PHP nastavit `MAIL_TRANSPORT => 'mail'` (funkce `mail()`). Node verze posílá přes [nodemailer](https://nodemailer.com/), PHP má vlastního malého SMTP klienta bez závislostí. Texty e-mailů jsou v `server/mail.js` a `php/api.php` (stejné znění).

Test: `npm test` vyzkouší e-maily proti lokálnímu SMTP serveru. Pro PHP spusť server s `SMTP_HOST=127.0.0.1 SMTP_PORT=2525 SMTP_SECURE=none APP_URL=https://darky.example.cz MAIL_GAP_SECONDS=1 MAIL_FROM=…` a pak `npm test -- http://127.0.0.1:8080 --mail 2525`.

## Upozornění (Web Push) a cron

**Web Push** (systémová upozornění) se zapne s klíči `VAPID_PUBLIC_KEY` a `VAPID_PRIVATE_KEY` (vygeneruje je `npm run vapid`) a s `VAPID_SUBJECT` (`mailto:…`). Push nenese žádná data, jen „zaklepe“. Service worker si text vyzvedne z `api/push/inbox`, takže není potřeba šifrovat obsah a Node i PHP jsou stejně jednoduché. Server posílá pushe jen na známé push služby (Google, Mozilla, Apple, Microsoft), nic jiného nevolá. Na iPhonu fungují jen ze stránky přidané na plochu (iOS 16.4+), stránka to uživateli řekne.

**E-maily v čas odemčení** hlídá endpoint `api/cron`:
- **Vercel:** `vercel.json` má cron jednou denně v 17:00 UTC (= 18:00 na Štědrý večer, víc tarif Hobby nedovolí). Nastav `CRON_SECRET`, Vercel ho posílá sám. Pro přesnější časy přidej externí cron, třeba [cron-job.org](https://cron-job.org) každých 5 minut na `https://tvuj-web/api/cron?key=CRON_SECRET`.
- **PHP hosting:** cron na hostingu, např. `*/5 * * * * curl -s "https://tvuj-web/api/cron?key=CRON_SECRET"`.
- Bez cronu se upozornění pošlou při nejbližší návštěvě webu (každý požadavek nejvýš jednou za minutu zkontroluje, co je na řadě). Každé upozornění odejde jen jednou, i když cron běží víckrát naráz.

## Bezpečnost v kostce

- Dílny: tajný klíč má 192 bitů náhody. Server si ukládá jeho otisk (SHA-256) pro vyhledání a kopii šifrovanou AES-256-GCM klíčem odvozeným z `APP_SECRET`, aby šel odkaz v dílně znovu ukázat. Klíč je v části adresy za `#`, takže se neposílá na server v adrese a nezůstane v jeho logech. Po přihlášení ho stránka z adresního řádku hned odstraní.
- Přihlášení: podepsaná HttpOnly cookie na rok. Výměnou odkazu se zneplatní všechna ostatní přihlášení. Hlavička `X-Admin` chrání proti CSRF.
- Každá dílna vidí jen svoje boxy a PDF. Cizí box vypadá stejně jako neexistující (404).
- Limity na dílnu: `MAX_GIFTS` boxů (50) a `MAX_STORAGE_MB` místa na PDF (100 MB). Volitelný `SIGNUP_CODE` omezí zakládání dílen.
- E-maily: adresa pro odkazy v e-mailu se bere jen z `APP_URL`, nikdy z hlavičky `Host`. Obnova ztraceného odkazu odpoví vždy stejně, takže nejde zjistit, které adresy mají dílnu. Jedna dílna dostane nejvýš jeden e-mail za minutu.
- Hesla k dárkům: PBKDF2-SHA256, 210 000 iterací. Špatný pokus server zdrží o 0,6 s.
- Kód má 12 písmen ze 70 slabik, tedy zhruba 10¹¹ kombinací. Dárek bez hesla je chráněný jen tímhle kódem.
- Při změně hesla nebo kódu přestanou platit dřív vydané odkazy na PDF.
- Postupné rozbalování hlídá jen stránka. Server po otevření pošle všechny položky naráz.
