# API (společné pro Node i PHP)

Všechny cesty jsou relativní k `/api/`. Těla požadavků i odpovědí jsou JSON, pokud není uvedeno jinak.
Chyby mají tvar `{ "error": "kod_chyby", "message": "lidsky čitelný text" }`.

## Veřejné (příjemce)

| Metoda | Cesta | Popis |
|---|---|---|
| GET | `gifts/{code}` | Obálka dárku: `{ code, title, hasPassword, locked, openAt, serverNow }`. `title` je `null`, pokud ho tvůrce skryl. |
| POST | `gifts/{code}/open` | Tělo `{ password }` nebo `{ token }` (dříve vydaný token, aby příjemce nemusel heslo psát znovu). Vrací `{ gift, token }`. `401 bad_password`, `423 locked` (+ `openAt`, `serverNow`), `404 not_found`. Přihlášená dílna, které box patří, obejde s `{ preview: true }` zámek i heslo. |
| GET | `gifts/{code}/items/{itemId}/file?t={token}[&dl=1]` | PDF položky. Server znovu ověří token i časový zámek. |

`gift` = `{ code, title, message, signature, items: [{ id, name, description, file: { name, size } | null }] }`

## Dílny (účty bez hesla)

Všechny zápisy (vše kromě `GET` a cest `gifts/…`) potřebují hlavičku `X-Admin: 1` (ochrana proti CSRF).
Přihlášení drží HttpOnly cookie `xd_ws` (rok). Bez ní vrací chráněné cesty `401 unauthorized`.

| Metoda | Cesta | Popis |
|---|---|---|
| POST | `workshop` | Založí dílnu. Tělo `{ name?, email?, signupCode? }` (`signupCode` jen pokud je nastavený `SIGNUP_CODE`). Vrátí `{ workshop }` včetně `key` a přihlásí. `400 bad_email`, `403 bad_signup_code`. |
| POST | `workshop/login` | `{ key }` z tajného odkazu `…/dilna#klic=KEY`. Přihlásí, vrátí `{ workshop }`. `401 bad_key`. |
| POST | `workshop/logout` | Odhlásí toto zařízení. |
| GET | `workshop` | `{ workshop }` |
| PUT | `workshop` | `{ name?, email? }` |
| POST | `workshop/rotate-key` | Nový klíč, starý přestane platit a ostatní zařízení se odhlásí. Vrátí `{ workshop }` s novým `key`. |
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
| POST | `admin/files` | tělo = surové PDF (`application/octet-stream`), hlavička `X-File-Name` (URL-encoded). Vrátí `{ id, name, size }`. `413 too_large` / `413 quota` |
| GET | `admin/files/{id}` | náhled PDF pro dílnu |

## Uložená dílna

```json
{
  "id": "…",
  "name": "Tomova dílna",
  "email": "",
  "keyHash": "<sha256 hex klíče>",
  "keyEnc": "<base64(iv12 | tag16 | AES-256-GCM(klíč))>",
  "usedBytes": 12345,
  "createdAt": "…", "updatedAt": "…"
}
```

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
  "appearance": { "paper": "burgundy", "pattern": "stripes", "ribbon": "gold", "ribbonStyle": "cross", "seal": "V" },
  "reveal": "all",
  "items": [{ "id": "…", "name": "…", "description": "…", "file": { "id": "…", "name": "poukaz.pdf", "size": 12345 } }],
  "createdAt": "…", "updatedAt": "…"
}
```

`appearance`: `paper` ∈ burgundy, emerald, midnight, ivory, champagne, blush, charcoal, silver · `pattern` ∈ plain, stripes, dots, stars, snow, tartan · `ribbon` ∈ gold, silver, red, green, white, black · `ribbonStyle` ∈ cross, single · `seal` = 0–2 znaky.
`reveal` ∈ `all` (najednou), `sequential` (postupně), `choice` (vybere příjemce). Neplatné hodnoty server nahradí výchozími; boxy uložené před zavedením těchto polí je dostanou automaticky.
Veřejné `GET gifts/{code}` vrací i `appearance` (krabice se kreslí před otevřením), `open` vrací v `gift` i `reveal` a `appearance`.

Dárek je odemčený, když platí `manualUnlock || anytime || now >= openAt` (čas serveru).
Hash hesla používá PBKDF2-SHA256 ve stejném formátu v Node i PHP, takže data jsou mezi backendy přenositelná.
Heslo se před odesláním normalizuje v prohlížeči (malá písmena, bez diakritiky, bez mezer na okrajích).
