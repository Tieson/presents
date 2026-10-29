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
- **Vzhled krabice:** 8 papírů, 6 vzorů (hladký, proužky, puntíky, hvězdičky, vločky, kostka), 6 barev stuhy, převázání do kříže nebo jednou stuhou a pečeť s iniciálami. Živý náhled v dílně, ikonky v seznamu boxů mají stejné barvy.
- **Rozbalování:** najednou, postupně (každá položka je malá krabička) nebo ať si vybere příjemce. Postup se příjemci pamatuje i po zavření stránky. „Zabalit znovu“ ho vynuluje.
- Náhled jako příjemce pro přihlášeného tvůrce (obejde heslo i zámek).

## Struktura

```
web/                 frontend (Vite): index.html = příjemce, admin.html = dílna, assets/
api/index.js         Vercel serverless funkce – vstup pro celé /api/*
server/              Node backend: app.js (API), security.js, storage/ (fs | Upstash+Blob),
                     standalone.js (vlastní server), node-adapter.js, env.js
php/                 PHP backend se stejným API (PHP 7.4+, Apache + mod_rewrite)
scripts/             build-php.mjs, test.mjs
tests/api.mjs        end-to-end testy API (běží proti Node i PHP)
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
npm run build:php        # → build/php/
```

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

## Bezpečnost v kostce

- Dílny: tajný klíč má 192 bitů náhody. Server si ukládá jeho otisk (SHA-256) pro vyhledání a kopii šifrovanou AES-256-GCM klíčem odvozeným z `APP_SECRET`, aby šel odkaz v dílně znovu ukázat. Klíč je v části adresy za `#`, takže se neposílá na server v adrese a nezůstane v jeho logech. Po přihlášení ho stránka z adresního řádku hned odstraní.
- Přihlášení: podepsaná HttpOnly cookie na rok. Výměnou odkazu se zneplatní všechna ostatní přihlášení. Hlavička `X-Admin` chrání proti CSRF.
- Každá dílna vidí jen svoje boxy a PDF. Cizí box vypadá stejně jako neexistující (404).
- Limity na dílnu: `MAX_GIFTS` boxů (50) a `MAX_STORAGE_MB` místa na PDF (100 MB). Volitelný `SIGNUP_CODE` omezí zakládání dílen.
- E-mail se zatím jen ukládá, nic se neposílá.
- Hesla k dárkům: PBKDF2-SHA256, 210 000 iterací. Špatný pokus server zdrží o 0,6 s.
- Kód má 12 písmen ze 70 slabik, tedy zhruba 10¹¹ kombinací. Dárek bez hesla je chráněný jen tímhle kódem.
- Při změně hesla nebo kódu přestanou platit dřív vydané odkazy na PDF.
- Postupné rozbalování hlídá jen stránka. Server po otevření pošle všechny položky naráz.
