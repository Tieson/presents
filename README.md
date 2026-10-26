# Vánoční dárky 🎁

Online dárkové boxy s poukazy v PDF. Příjemce otevře odkaz (např. `https://darky.cz/bekalo-mitusa`),
zadá heslo a ve stanovený čas si dárek „rozbalí“. Tvůrce vše spravuje v **Ježíškově dílně** na `/admin`.

## Co umí

- **Dárkové boxy** s vlastním názvem („Dárek pro sestřičku“). U každého jde nastavit, jestli název uvidí i příjemce.
- **Položky** s názvem, popisem a PDF poukazem. Řadí se přetažením za úchyt, šipkami nebo klávesnicí (fokus na úchytu + ↑/↓). Příjemce je vidí vždy.
- **Adresa** = kód ze slabik (`bekalo-mitusa`), dobře se čte i opisuje. Kód jde kdykoli vygenerovat znovu.
- **Heslo**, nebo dárek bez hesla. Na velikosti písmen a diakritice nezáleží. Server ukládá jen otisk (PBKDF2).
- **Čas odemčení:** Štědrý večer (24. 12. 18:00), vlastní datum a čas, nebo „kdykoli“. Navíc **ruční odemčení** jedním přepínačem.
- **Vše kontroluje backend:** heslo, čas odemčení (podle hodin serveru) i stažení PDF. Odkaz na PDF má podepsaný token a server při každém stažení znovu ověří i zámek.
- **Vzhled krabice:** 8 papírů, 6 vzorů (hladký, proužky, puntíky, hvězdičky, vločky, kostka), 6 barev stuhy, převázání do kříže nebo jednou stuhou a pečeť s iniciálami. Živý náhled v dílně, ikonky v seznamu boxů mají stejné barvy.
- **Rozbalování:** najednou, postupně (každá položka je malá krabička) nebo ať si vybere příjemce. Postup se příjemci pamatuje i po zavření stránky. „Zabalit znovu“ ho vynuluje.
- Náhled jako příjemce pro přihlášeného tvůrce (obejde heslo i zámek).

## Struktura

```
web/      společný frontend (index.html = příjemce, admin.html = dílna, assets/)
node/     Node.js backend – samostatný server i Vercel funkce
php/      PHP backend se stejným API (PHP 7.4+, Apache + mod_rewrite)
build.mjs sestaví dist/node a dist/php
API.md    popis API a datového modelu
```

Data jsou mezi backendy přenositelná (stejný JSON i formát hashů hesel).

```bash
node build.mjs     # → dist/node, dist/php
```

---

## Nasazení na Vercel

1. Nahraj repozitář na GitHub a ve Vercelu vytvoř projekt.
   **Root Directory** nastav na `node` (build si sám zkopíruje `web/` do `public/`).
2. V záložce **Storage** připoj:
   - **Upstash for Redis** (Marketplace). Doplní `UPSTASH_REDIS_REST_URL` a `UPSTASH_REDIS_REST_TOKEN`, případně `KV_REST_API_*`. Oboje funguje.
   - **Blob** a zvol **Private** úložiště. Doplní `BLOB_READ_WRITE_TOKEN`.
3. V **Environment Variables** přidej:
   - `ADMIN_PASSWORD` = heslo do dílny
   - `APP_SECRET` = dlouhý náhodný řetězec (`openssl rand -base64 32`)
4. Deploy. Dílna běží na `https://<projekt>.vercel.app/admin`.

Alternativně bez gitu: `node build.mjs && cd dist/node && npx vercel --prod`.

> Vercel funkce přijmou požadavek do ~4,5 MB, proto je tam limit PDF **4 MB** (`MAX_UPLOAD_MB`).
> Jestli máš veřejné Blob úložiště, nastav `BLOB_ACCESS=public`. Soubory se i tak posílají jen přes API, URL blobu se nikam nedostane.

## Node.js server (VPS, Docker, lokálně)

```bash
cd dist/node
cp .env.example .env    # vyplň ADMIN_PASSWORD (a APP_SECRET)
npm install
npm start               # http://localhost:3000, dílna na /admin
```

Data se ukládají do `./data` (`DATA_DIR`). Za reverzní proxy (nginx/Caddy) posílej `X-Forwarded-Proto`, aby cookie dostala příznak `Secure`.

## PHP hosting (Wedos, Forpsi, Active24…)

1. `node build.mjs` a obsah `dist/php/` nahraj přes FTP do webroot (nebo podsložky).
2. Zkopíruj `config.sample.php` → `config.php` a vyplň `ADMIN_PASSWORD` a `APP_SECRET`.
3. Ideálně nastav `DATA_DIR` mimo veřejný webroot. Když zůstane uvnitř, chrání ho `.htaccess`.
4. Hosting musí mít zapnutý `mod_rewrite` (běžně ano). PHP rozšíření: `json`, `mbstring`, `hash` (standard).
5. U větších PDF zkontroluj `upload_max_filesize` a `post_max_size` v PHP.

Lokální test: `cd dist/php && php -S localhost:8000 router.php`.

## Bezpečnost v kostce

- Admin: podepsaná HttpOnly cookie (14 dní) a hlavička `X-Admin` proti CSRF.
- Hesla k dárkům: PBKDF2-SHA256, 210 000 iterací. Špatný pokus server zdrží o 0,6 s.
- Kód má 12 písmen ze 70 slabik, tedy zhruba 10¹¹ kombinací. Dárek bez hesla je chráněný jen tímhle kódem.
- Při změně hesla nebo kódu přestanou platit dřív vydané odkazy na PDF.
