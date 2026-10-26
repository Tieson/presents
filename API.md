# API (společné pro Node i PHP)

Všechny cesty jsou relativní k `/api/`. Těla požadavků i odpovědí jsou JSON, pokud není uvedeno jinak.
Chyby mají tvar `{ "error": "kod_chyby", "message": "lidsky čitelný text" }`.

## Veřejné (příjemce)

| Metoda | Cesta | Popis |
|---|---|---|
| GET | `gifts/{code}` | Obálka dárku: `{ code, title, hasPassword, locked, openAt, serverNow }`. `title` je `null`, pokud ho tvůrce skryl. |
| POST | `gifts/{code}/open` | Tělo `{ password }` nebo `{ token }` (dříve vydaný token, aby příjemce nemusel heslo psát znovu). Vrací `{ gift, token }`. `401 bad_password`, `423 locked` (+ `openAt`, `serverNow`), `404 not_found`. S admin cookie a `{ preview: true }` obejde zámek i heslo. |
| GET | `gifts/{code}/items/{itemId}/file?t={token}[&dl=1]` | PDF položky. Server znovu ověří token i časový zámek. |

`gift` = `{ code, title, message, signature, items: [{ id, name, description, file: { name, size } | null }] }`

## Administrace (cookie `xd_admin` + hlavička `X-Admin: 1`)

| Metoda | Cesta | Popis |
|---|---|---|
| POST | `admin/login` | `{ password }` → nastaví cookie |
| POST | `admin/logout` | smaže cookie |
| GET | `admin/me` | `{ ok: true }` nebo 401 |
| GET | `admin/gifts` | seznam boxů (souhrn) |
| POST | `admin/gifts` | vytvoří nový box, vrátí ho celý |
| GET | `admin/gifts/{code}` | celý box |
| PUT | `admin/gifts/{code}` | uloží box. `password`: řetězec = nastavit nové, `null` = bez hesla, vynecháno = beze změny |
| DELETE | `admin/gifts/{code}` | smaže box i jeho PDF |
| POST | `admin/gifts/{code}/regenerate-code` | nový kód (adresa); vrátí box |
| POST | `admin/files` | tělo = surové PDF (`application/octet-stream`), hlavička `X-File-Name` (URL-encoded). Vrátí `{ id, name, size }` |
| GET | `admin/files/{id}` | náhled PDF pro tvůrce |

## Datový model boxu (uložený)

```json
{
  "code": "bekalo-mitusa",
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
