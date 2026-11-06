# API (společné pro Node i PHP)

Všechny cesty jsou relativní k `/api/`. Těla požadavků i odpovědí jsou JSON, pokud není uvedeno jinak.
Chyby mají tvar `{ "error": "kod_chyby", "message": "lidsky čitelný text" }`.

## Veřejné (příjemce)

| Metoda | Cesta | Popis |
|---|---|---|
| GET | `gifts/{code}` | Obálka dárku: `{ code, title, hasPassword, locked, openAt, serverNow }`. `title` je `null`, pokud ho tvůrce skryl. |
| POST | `gifts/{code}/open` | Tělo `{ password }` nebo `{ token }` (dříve vydaný token, aby příjemce nemusel heslo psát znovu). Vrací `{ gift, token }`. `401 bad_password`, `423 locked` (+ `openAt`, `serverNow`), `404 not_found`. Přihlášená dílna, které box patří, obejde s `{ preview: true }` zámek i heslo. |
| GET | `gifts/{code}/items/{itemId}/file?t={token}[&dl=1]` | PDF položky. Server znovu ověří token i časový zámek. |
| GET | `gifts/{code}/photo?t={token}` | Fotka boxu (JPEG/PNG/WebP). Stejná kontrola tokenu a zámku. V `open` je jen `gift.photo = { caption, frame, w, h }`, id souboru se nezveřejňuje. |

`gift` = `{ code, title, message, signature, items: [{ id, name, description, file: { name, size } | null }] }`

## Dílny (účty bez hesla)

Všechny zápisy (vše kromě `GET` a cest `gifts/…`) potřebují hlavičku `X-Admin: 1` (ochrana proti CSRF).
Přihlášení drží HttpOnly cookie `xd_ws` (rok). Bez ní vrací chráněné cesty `401 unauthorized`.

| Metoda | Cesta | Popis |
|---|---|---|
| GET | `info` | `{ mail, signupCode }`: jestli server posílá e-maily a jestli zakládání chce kód. Bez přihlášení. |
| POST | `workshop` | Založí dílnu. Tělo `{ name?, email?, signupCode? }` (`signupCode` jen pokud je nastavený `SIGNUP_CODE`). Vrátí `{ workshop, mailed }` včetně `key` a přihlásí. `mailed` = odešel uvítací e-mail s odkazem. `400 bad_email`, `403 bad_signup_code`. |
| POST | `workshop/recover` | `{ email }`: pošle odkaz do všech dílen s touto adresou. Odpověď je vždy `{ ok: true }`, ať adresa dílnu má, nebo ne. `400 bad_email`, `503 mail_off`. Bez přihlášení. |
| POST | `workshop/login` | `{ key }` z tajného odkazu `…/dilna#klic=KEY`. Přihlásí, vrátí `{ workshop }`. `401 bad_key`. |
| POST | `workshop/logout` | Odhlásí toto zařízení. |
| GET | `workshop` | `{ workshop }` |
| PUT | `workshop` | `{ name?, email? }` |
| POST | `workshop/send-link` | Pošle odkaz na uložený e-mail. `{ ok, email }`. `400 no_email`, `429 too_soon` (víc než 1 e-mail za minutu), `502 mail_failed`, `503 mail_off`. |
| POST | `workshop/rotate-key` | Nový klíč, starý přestane platit a ostatní zařízení se odhlásí. Vrátí `{ workshop, mailed }` s novým `key`. Má-li dílna e-mail, pošle na něj nový odkaz. |
| DELETE | `workshop` | Smaže dílnu se všemi boxy a PDF. |

`workshop` = `{ id, name, email, key, createdAt, giftCount, usedBytes, limits: { gifts, storageBytes, uploadBytes } }`

## Boxy a PDF dílny

Vyžadují přihlášenou dílnu. Cizí box nebo PDF vrací `404`, jako by neexistoval.

| Metoda | Cesta | Popis |
|---|---|---|
| GET | `admin/gifts` | seznam boxů dílny (souhrn) |
| POST | `admin/gifts` | vytvoří nový box, vrátí ho celý. `409 limit` při překročení `MAX_GIFTS` |
| GET | `admin/gifts/{code}` | celý box |
| PUT | `admin/gifts/{code}` | uloží box. `password`: řetězec = nastavit nové, `null` = bez hesla, vynecháno = beze změny. Připojit jde jen PDF vlastní dílny. |
| DELETE | `admin/gifts/{code}` | smaže box i jeho PDF |
| POST | `admin/gifts/{code}/regenerate-code` | nový kód (adresa), vrátí box |
| POST | `admin/files` | tělo = surové PDF nebo obrázek (`application/octet-stream`), hlavička `X-File-Name` (URL-encoded), u obrázku volitelně `X-Image-Width` / `X-Image-Height`. Typ server pozná z prvních bajtů (PDF, JPEG, PNG, WebP; nic jiného, ani SVG). Vrátí `{ id, name, size, type, w, h }`. `415 bad_type`, `413 too_large` / `413 quota` |
| GET | `admin/files/{id}` | náhled PDF nebo fotky pro dílnu |

## Uložená dílna

```json
{
  "id": "…",
  "name": "Tomova dílna",
  "email": "",
  "keyHash": "<sha256 hex klíče>",
  "keyEnc": "<base64(iv12 | tag16 | AES-256-GCM(klíč))>",
  "usedBytes": 12345,
  "mailedAt": "…",
  "createdAt": "…", "updatedAt": "…"
}
```

Index e-mailů pro obnovu odkazu: `sha256("email|" + email.toLowerCase())` → seznam id dílen (soubory `emails/<hash>.json`, v Redisu hash `<prefix>emails`).

Klíč šifruje AES-256-GCM s klíčem `sha256("xd-key-enc|" + APP_SECRET)`. Formát je stejný v Node i PHP.
Přihlašovací cookie = `<id>.<exp>.<HMAC(APP_SECRET, "ws|id|keyHash[0..16]|exp")>`, takže výměna klíče zneplatní všechna starší přihlášení.

## Datový model boxu (uložený)

```json
{
  "code": "bekalo-mitusa",
  "owner": "<id dílny>",
  "title": "Dárek pro sestřičku",
  "showTitle": true,
  "message": "…",
  "signature": "…",
  "passwordHash": "pbkdf2_sha256$210000$<salt b64>$<hash b64>" ,
  "anytime": false,
  "openAt": "2026-12-24T17:00:00.000Z",
  "manualUnlock": false,
  "appearance": { "paper": "burgundy", "pattern": "stripes", "patternColor": null, "patternOpacity": null, "ribbon": "gold", "ribbonStyle": "cross", "bow": "classic", "deco": "none", "seal": "V" },
  "reveal": "all",
  "items": [{ "id": "…", "name": "…", "description": "…", "file": { "id": "…", "name": "poukaz.pdf", "size": 12345 } }],
  "photo": { "file": { "id": "…", "name": "hory.jpg", "size": 234567, "type": "image/jpeg", "w": 1600, "h": 1067 }, "caption": "Krkonoše 2025", "frame": "polaroid" },
  "createdAt": "…", "updatedAt": "…"
}
```

`appearance`:
- `paper` ∈ burgundy, scarlet, emerald, fir, midnight, plum, charcoal, ivory, frost, champagne, gold, blush, silver, kraft
- `pattern` ∈ plain, stripes, dots, tartan, stars, snow, trees, baubles, holly, candy, gingerbread, deer, hearts
- `patternColor` ∈ white, cream, gold, silver, bronze, red, green, navy, brown, black, nebo `null` = výchozí barva papíru
- `patternOpacity` = 5–90 (%), nebo `null` = výchozí výraznost papíru
- `ribbon` ∈ gold, silver, copper, red, burgundy, pink, green, navy, white, black · `ribbonStyle` ∈ cross, single, none
- `bow` ∈ classic, double, rosette, small, none · `deco` ∈ none, holly, pine, candy, bauble, star, bells, orange · `seal` = 0–2 znaky

`photo` (nebo `null`): obrázek nahraný stejnou dílnou, `caption` do 200 znaků, `frame` ∈ polaroid, postcard. V `PUT` vynechané `photo` = beze změny, `null` = odebrat (soubor se smaže).
`reveal` ∈ `all` (najednou), `sequential` (postupně), `choice` (vybere příjemce). Neplatné hodnoty server nahradí výchozími; boxy uložené před zavedením těchto polí je dostanou automaticky.
Veřejné `GET gifts/{code}` vrací i `appearance` (krabice se kreslí před otevřením), `open` vrací v `gift` i `reveal` a `appearance`.

Dárek je odemčený, když platí `manualUnlock || anytime || now >= openAt` (čas serveru).
Hash hesla používá PBKDF2-SHA256 ve stejném formátu v Node i PHP, takže data jsou mezi backendy přenositelná.
Heslo se před odesláním normalizuje v prohlížeči (malá písmena, bez diakritiky, bez mezer na okrajích).
