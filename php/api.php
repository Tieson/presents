<?php
/**
 * Vánoční dárky – PHP backend (PHP 7.4+). Same API and data format as the Node version, see API.md.
 *
 * Accounts are "workshops" (dílny) without passwords: creating one returns a secret key, the link
 * /dilna#klic=<key> is the only way in. Stored: sha256(key) to find the workshop, and an
 * AES-256-GCM copy so the owner can see the link again (same format as server/security.js).
 *
 * Data: JSON files in DATA_DIR
 *   workshops/<id>.json   keys/<sha256>.json   gifts/<code>.json   files/<id>.pdf + <id>.json
 *   emails/<sha256>.json  (workshops saved with an e-mail address, for lost-link e-mails)
 *
 * E-mails (optional): SMTP_HOST + MAIL_FROM + APP_URL in config.php, see config.sample.php.
 */
declare(strict_types=1);

$config = [];
if (is_file(__DIR__ . '/config.php')) $config = require __DIR__ . '/config.php';
function cfg(array $c, string $k, $default = null) {
    $env = getenv($k);
    if ($env !== false && $env !== '') return $env;
    return $c[$k] ?? $default;
}
$SECRET = (string) cfg($config, 'APP_SECRET', '');
$DATA_DIR = rtrim((string) cfg($config, 'DATA_DIR', __DIR__ . '/data'), '/');
$MAX_UPLOAD = (int) cfg($config, 'MAX_UPLOAD_MB', 15) * 1024 * 1024;
$MAX_GIFTS = (int) cfg($config, 'MAX_GIFTS', 50);
$MAX_STORAGE = (int) cfg($config, 'MAX_STORAGE_MB', 100) * 1024 * 1024;
$SIGNUP_CODE = trim((string) cfg($config, 'SIGNUP_CODE', ''));
$MAIL = [
    'transport' => strtolower((string) cfg($config, 'MAIL_TRANSPORT', 'smtp')),   // smtp | mail (PHP mail())
    'host' => trim((string) cfg($config, 'SMTP_HOST', '')),
    'port' => (int) cfg($config, 'SMTP_PORT', 587),
    'secure' => strtolower((string) cfg($config, 'SMTP_SECURE', '')),             // tls | starttls | none
    'user' => (string) cfg($config, 'SMTP_USER', ''),
    'pass' => (string) cfg($config, 'SMTP_PASS', ''),
    'from' => trim((string) cfg($config, 'MAIL_FROM', '')),
    'replyTo' => trim((string) cfg($config, 'MAIL_REPLY_TO', '')),
    'appUrl' => rtrim(trim((string) cfg($config, 'APP_URL', '')), '/'),
    'gap' => (int) cfg($config, 'MAIL_GAP_SECONDS', 60),
];
if ($MAIL['secure'] === '') $MAIL['secure'] = $MAIL['port'] === 465 ? 'tls' : 'starttls';
$MAIL['enabled'] = $MAIL['from'] !== '' && $MAIL['appUrl'] !== '' && ($MAIL['host'] !== '' || $MAIL['transport'] === 'mail');

const WS_COOKIE = 'xd_ws';
const WS_TTL = 31536000;     // stays signed in on a device for a year
const GIFT_TTL = 5184000;    // 60 days
const MAX_ITEMS = 50;
const PBKDF2_ITER = 210000;

/* ---------- helpers ---------- */

function b64url(string $raw): string { return rtrim(strtr(base64_encode($raw), '+/', '-_'), '='); }
function hmac(string $secret, string $data): string { return b64url(hash_hmac('sha256', $data, $secret, true)); }

function send_json($data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
function fail(int $status, string $error, string $message, array $extra = []): void {
    send_json(array_merge(['error' => $error, 'message' => $message], $extra), $status);
}
function body_json(): array {
    $d = json_decode((string) file_get_contents('php://input'), true);
    return is_array($d) ? $d : [];
}
function s($v, int $max): string {
    $v = str_replace("\r\n", "\n", (string) ($v ?? ''));
    return mb_substr($v, 0, $max, 'UTF-8');
}
function iso(int $ts): string { return gmdate('Y-m-d\TH:i:s.000\Z', $ts); }
function now_iso(): string { return iso(time()); }

function sign_token(string $secret, string $scope, int $ttl): string {
    $exp = time() + $ttl;
    return $exp . '.' . hmac($secret, $scope . '|' . $exp);
}
function check_token(string $secret, string $scope, ?string $token): bool {
    if (!$token || strpos($token, '.') === false) return false;
    [$exp, $sig] = explode('.', $token, 2);
    if ((int) $exp < time()) return false;
    return hash_equals(hmac($secret, $scope . '|' . (int) $exp), $sig);
}

function hash_password(string $pw): string {
    $salt = random_bytes(16);
    $hash = hash_pbkdf2('sha256', $pw, $salt, PBKDF2_ITER, 32, true);
    return 'pbkdf2_sha256$' . PBKDF2_ITER . '$' . base64_encode($salt) . '$' . base64_encode($hash);
}
function verify_password(string $pw, ?string $stored): bool {
    if (!$stored) return false;
    $p = explode('$', $stored);
    if (count($p) !== 4 || $p[0] !== 'pbkdf2_sha256') return false;
    $expected = base64_decode($p[3]);
    $got = hash_pbkdf2('sha256', $pw, base64_decode($p[2]), (int) $p[1], strlen($expected), true);
    return hash_equals($expected, $got);
}
function normalize_password($pw): string { return mb_strtolower(trim((string) ($pw ?? '')), 'UTF-8'); }

function random_id(int $bytes = 9): string { return b64url(random_bytes($bytes)); }

function generate_code(): string {
    $c = 'bdhjklmnprstvz'; $v = 'aeiou';
    $w = function () use ($c, $v) {
        $s = '';
        for ($i = 0; $i < 3; $i++) $s .= $c[random_int(0, strlen($c) - 1)] . $v[random_int(0, strlen($v) - 1)];
        return $s;
    };
    return $w() . '-' . $w();
}
function normalize_code($raw): ?string {
    $s = preg_replace('/[^a-z]/', '', strtolower((string) $raw));
    if (!preg_match('/^[a-z]{12}$/', $s)) return null;
    return substr($s, 0, 6) . '-' . substr($s, 6);
}

function default_open_at(): string {
    $y = (int) gmdate('Y');
    if (time() > gmmktime(23, 0, 0, 12, 26, $y)) $y++;
    return iso(gmmktime(17, 0, 0, 12, 24, $y)); // 24.12. 18:00 Prague (CET)
}
/* appearance & reveal – whitelists shared with web/assets/wrap.js */
const PAPERS = ['burgundy', 'emerald', 'midnight', 'ivory', 'champagne', 'blush', 'charcoal', 'silver'];
const PATTERNS = ['plain', 'stripes', 'dots', 'stars', 'snow', 'tartan'];
const RIBBONS = ['gold', 'silver', 'red', 'green', 'white', 'black'];
const RIBBON_STYLES = ['cross', 'single'];
const REVEALS = ['all', 'sequential', 'choice'];

function sanitize_appearance($a): array {
    $a = is_array($a) ? $a : [];
    $pick = function (array $list, $v, string $d) { return in_array($v, $list, true) ? $v : $d; };
    $seal = isset($a['seal']) && is_string($a['seal']) ? mb_substr(trim($a['seal']), 0, 2, 'UTF-8') : 'V';
    return [
        'paper' => $pick(PAPERS, $a['paper'] ?? null, 'burgundy'),
        'pattern' => $pick(PATTERNS, $a['pattern'] ?? null, 'stripes'),
        'ribbon' => $pick(RIBBONS, $a['ribbon'] ?? null, 'gold'),
        'ribbonStyle' => $pick(RIBBON_STYLES, $a['ribbonStyle'] ?? null, 'cross'),
        'seal' => $seal,
    ];
}
function with_defaults(?array $g): ?array {
    if (!$g) return $g;
    $g['appearance'] = sanitize_appearance($g['appearance'] ?? null);
    $g['reveal'] = in_array($g['reveal'] ?? null, REVEALS, true) ? $g['reveal'] : 'all';
    return $g;
}

function is_locked(array $g): bool {
    if (!empty($g['manualUnlock']) || !empty($g['anytime'])) return false;
    $t = strtotime((string) ($g['openAt'] ?? ''));
    return $t !== false && time() < $t;
}


/* ---------- workshop keys ---------- */

function generate_key(): string { return b64url(random_bytes(24)); }
function is_key_shaped($k): bool { return is_string($k) && (bool) preg_match('/^[A-Za-z0-9_-]{32}$/', $k); }
function aes_key(string $secret): string { return hash('sha256', 'xd-key-enc|' . $secret, true); }
/** base64(iv[12] | tag[16] | ciphertext) – identical to server/security.js */
function encrypt_str(string $secret, string $plain): string {
    $iv = random_bytes(12);
    $tag = '';
    $ct = openssl_encrypt($plain, 'aes-256-gcm', aes_key($secret), OPENSSL_RAW_DATA, $iv, $tag, '', 16);
    return base64_encode($iv . $tag . $ct);
}
function decrypt_str(string $secret, ?string $data): ?string {
    $raw = base64_decode((string) $data, true);
    if ($raw === false || strlen($raw) < 28) return null;
    $out = openssl_decrypt(substr($raw, 28), 'aes-256-gcm', aes_key($secret), OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, 12, 16));
    return $out === false ? null : $out;
}

/* ---------- storage (JSON files) ---------- */

$GIFTS = $DATA_DIR . '/gifts';
$FILES = $DATA_DIR . '/files';
$WORKSHOPS = $DATA_DIR . '/workshops';
$KEYS = $DATA_DIR . '/keys';
$EMAILS = $DATA_DIR . '/emails';
foreach ([$GIFTS, $FILES, $WORKSHOPS, $KEYS, $EMAILS] as $d) if (!is_dir($d)) @mkdir($d, 0775, true);
if (!is_file($DATA_DIR . '/.htaccess')) @file_put_contents($DATA_DIR . '/.htaccess', "Require all denied\nDeny from all\n");

function safe_name($s): bool { return is_string($s) && (bool) preg_match('/^[\w-]+$/', $s); }
function write_atomic(string $file, string $data): void {
    $tmp = $file . '.' . getmypid() . '.' . bin2hex(random_bytes(4)) . '.tmp';
    if (file_put_contents($tmp, $data, LOCK_EX) === false) throw new RuntimeException('write failed');
    rename($tmp, $file);
}
function read_json_file(string $file): ?array {
    if (!is_file($file)) return null;
    $d = json_decode((string) file_get_contents($file), true);
    return is_array($d) ? $d : null;
}
function enc($v): string { return json_encode($v, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); }
function read_all(string $dir): array {
    $out = [];
    foreach (glob("$dir/*.json") ?: [] as $f) { $v = read_json_file($f); if ($v) $out[] = $v; }
    return $out;
}

function get_workshop($id): ?array { global $WORKSHOPS; return safe_name($id) ? read_json_file("$WORKSHOPS/$id.json") : null; }
function put_workshop(array $w): void { global $WORKSHOPS; write_atomic("$WORKSHOPS/{$w['id']}.json", enc($w)); }
function delete_workshop(string $id): void { global $WORKSHOPS; if (safe_name($id)) @unlink("$WORKSHOPS/$id.json"); }
function get_key_owner(string $hash): ?string { global $KEYS; $v = safe_name($hash) ? read_json_file("$KEYS/$hash.json") : null; return $v['id'] ?? null; }
function set_key_owner(string $hash, string $id): void { global $KEYS; write_atomic("$KEYS/$hash.json", json_encode(['id' => $id])); }
function delete_key_owner(string $hash): void { global $KEYS; if (safe_name($hash)) @unlink("$KEYS/$hash.json"); }
function get_email_owners(string $hash): array { global $EMAILS; $v = safe_name($hash) ? read_json_file("$EMAILS/$hash.json") : null; return $v['ids'] ?? []; }
function set_email_owners(string $hash, array $ids): void {
    global $EMAILS;
    if (!safe_name($hash)) return;
    if ($ids) write_atomic("$EMAILS/$hash.json", json_encode(['ids' => array_values($ids)])); else @unlink("$EMAILS/$hash.json");
}

function get_gift($code): ?array { global $GIFTS; return safe_name($code) ? with_defaults(read_json_file("$GIFTS/$code.json")) : null; }
function put_gift(array $g): void { global $GIFTS; write_atomic("$GIFTS/{$g['code']}.json", enc($g)); }
function delete_gift(string $code): void { global $GIFTS; if (safe_name($code)) @unlink("$GIFTS/$code.json"); }
function gifts_by_owner(string $owner): array {
    global $GIFTS;
    return array_values(array_map('with_defaults', array_filter(read_all($GIFTS), function ($g) use ($owner) { return ($g['owner'] ?? null) === $owner; })));
}
function file_meta($id): ?array { global $FILES; return safe_name($id) ? read_json_file("$FILES/$id.json") : null; }
function files_by_owner(string $owner): array {
    global $FILES;
    return array_values(array_filter(read_all($FILES), function ($f) use ($owner) { return ($f['owner'] ?? null) === $owner; }));
}
function delete_file(string $id): void { global $FILES; if (safe_name($id)) { @unlink("$FILES/$id.pdf"); @unlink("$FILES/$id.json"); } }
/* ---------- views ---------- */

function admin_view(array $g): array {
    $out = $g; unset($out['passwordHash']);
    $out['hasPassword'] = !empty($g['passwordHash']);
    $out['locked'] = is_locked($g);
    return $out;
}
function summary(array $g): array {
    $files = 0; foreach ($g['items'] as $i) if (!empty($i['file'])) $files++;
    return [
        'code' => $g['code'], 'title' => $g['title'], 'showTitle' => (bool) $g['showTitle'],
        'hasPassword' => !empty($g['passwordHash']), 'anytime' => (bool) $g['anytime'], 'openAt' => $g['openAt'],
        'manualUnlock' => (bool) $g['manualUnlock'], 'locked' => is_locked($g),
        'appearance' => $g['appearance'], 'reveal' => $g['reveal'],
        'itemCount' => count($g['items']), 'fileCount' => $files,
        'createdAt' => $g['createdAt'], 'updatedAt' => $g['updatedAt'],
    ];
}
function public_gift(array $g): array {
    return [
        'code' => $g['code'],
        'title' => $g['showTitle'] ? $g['title'] : null,
        'message' => $g['message'],
        'signature' => $g['signature'],
        'reveal' => $g['reveal'],
        'appearance' => $g['appearance'],
        'items' => array_map(function ($i) {
            return [
                'id' => $i['id'], 'name' => $i['name'], 'description' => $i['description'],
                'file' => $i['file'] ? ['name' => $i['file']['name'], 'size' => $i['file']['size']] : null,
            ];
        }, $g['items']),
    ];
}
function gift_scope(array $g): string {
    return 'gift|' . $g['code'] . '|' . (!empty($g['passwordHash']) ? substr($g['passwordHash'], -16) : 'none');
}
function send_pdf(string $id, string $name, bool $download): void {
    global $FILES;
    $path = "$FILES/$id.pdf";
    if (!safe_name($id) || !is_file($path)) fail(404, 'not_found', 'Soubor nenalezen.');
    $safe = str_replace(["\r", "\n", '"'], '', $name ?: 'poukaz.pdf');
    $ascii = preg_replace('/[^\x20-\x7e]/', '', iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $safe) ?: '') ?: 'poukaz.pdf';
    header('Content-Type: application/pdf');
    header('Content-Length: ' . filesize($path));
    header('Content-Disposition: ' . ($download ? 'attachment' : 'inline') . '; filename="' . $ascii . "\"; filename*=UTF-8''" . rawurlencode($safe));
    header('Cache-Control: private, no-store');
    header('X-Content-Type-Options: nosniff');
    readfile($path);
    exit;
}


/* ---------- sessions ---------- */

function ws_scope(array $w, int $exp): string { return 'ws|' . $w['id'] . '|' . substr($w['keyHash'], 0, 16) . '|' . $exp; }
function session_token(array $w): string {
    global $SECRET;
    $exp = time() + WS_TTL;
    return $w['id'] . '.' . $exp . '.' . hmac($SECRET, ws_scope($w, $exp));
}
function current_workshop(): ?array {
    global $SECRET;
    $c = $_COOKIE[WS_COOKIE] ?? '';
    $p = explode('.', (string) $c);
    if (count($p) !== 3 || (int) $p[1] < time()) return null;
    $w = get_workshop($p[0]);
    if (!$w || !hash_equals(hmac($SECRET, ws_scope($w, (int) $p[1])), $p[2])) return null;
    return $w;
}
function set_session_cookie(string $value, int $maxAge): void {
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    setcookie(WS_COOKIE, $value, [
        'expires' => $maxAge > 0 ? time() + $maxAge : time() - 3600,
        'path' => '/', 'httponly' => true, 'samesite' => 'Lax', 'secure' => $secure,
    ]);
}
function sign_in(array $w): void { set_session_cookie(session_token($w), WS_TTL); }
function sign_out(): void { set_session_cookie('', 0); }

function workshop_view(array $w, ?string $key = null): array {
    global $SECRET, $MAX_GIFTS, $MAX_STORAGE, $MAX_UPLOAD;
    return [
        'id' => $w['id'], 'name' => $w['name'], 'email' => $w['email'],
        'key' => $key ?? decrypt_str($SECRET, $w['keyEnc'] ?? ''),
        'createdAt' => $w['createdAt'],
        'giftCount' => count(gifts_by_owner($w['id'])),
        'usedBytes' => (int) ($w['usedBytes'] ?? 0),
        'limits' => ['gifts' => $MAX_GIFTS, 'storageBytes' => $MAX_STORAGE, 'uploadBytes' => $MAX_UPLOAD],
    ];
}
function clean_name($v): string { return trim((string) preg_replace('/\s+/u', ' ', s($v, 80))); }
/** '' = no e-mail, null = invalid */
function clean_email($v): ?string {
    $e = trim(s($v, 200));
    if ($e === '') return '';
    return preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]+$/u', $e) ? $e : null;
}
function new_key_for(array &$w): string {
    global $SECRET;
    $key = generate_key();
    $w['keyHash'] = hash('sha256', $key);
    $w['keyEnc'] = encrypt_str($SECRET, $key);
    set_key_owner($w['keyHash'], $w['id']);
    return $key;
}
/* ---------- e-mail ---------- */

function email_hash(string $e): string { return hash('sha256', 'email|' . mb_strtolower(trim($e), 'UTF-8')); }
function index_email(string $id, string $old, string $new): void {
    if ($old !== '' && ($new === '' || email_hash($old) !== email_hash($new))) {
        $h = email_hash($old);
        set_email_owners($h, array_values(array_filter(get_email_owners($h), function ($x) use ($id) { return $x !== $id; })));
    }
    if ($new !== '') {
        $h = email_hash($new);
        $ids = get_email_owners($h);
        if (!in_array($id, $ids, true)) { $ids[] = $id; set_email_owners($h, array_slice($ids, -20)); }
    }
}

/** Same wording as server/mail.js */
function link_message(string $kind, string $name, string $link): array {
    $subject = [
        'welcome' => "Tvoje Ježíškova dílna „{$name}“",
        'link' => "Odkaz do dílny „{$name}“",
        'recover' => "Odkaz do dílny „{$name}“",
        'rotated' => "Nový odkaz do dílny „{$name}“",
    ][$kind];
    $lead = [
        'welcome' => 'dílna je připravená. Tímhle odkazem se do ní dostaneš z jakéhokoli zařízení:',
        'link' => 'posíláme odkaz do tvé dílny, jak sis řekl(a):',
        'recover' => 'někdo (nejspíš ty) požádal o odkaz do dílny s touhle e-mailovou adresou. Tady je:',
        'rotated' => 'odkaz do dílny byl právě vyměněn za nový. Starý už neplatí. Nový je tady:',
    ][$kind];
    $foot = $kind === 'recover'
        ? 'Pokud jsi o odkaz nežádal(a), tenhle e-mail klidně smaž. Bez odkazu se do dílny nikdo nedostane.'
        : 'Kdo má odkaz, může dárky upravovat, tak ho nikomu nepřeposílej.';
    $h = function (string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); };
    $text = "Ahoj,\n\n{$lead}\n\n{$link}\n\n{$foot}\n\nVeselé Vánoce\nJežíškova dílna\n";
    $html = '<!doctype html><html lang="cs"><body style="margin:0;padding:0;background:#05140e">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#05140e;padding:32px 12px"><tr><td align="center">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#0b241a;border:1px solid #d6b26a;font-family:Georgia,\'Times New Roman\',serif;color:#f3ead6">'
        . '<tr><td style="padding:36px 32px 8px;text-align:center">'
        . '<p style="margin:0;font:12px/1 Arial,sans-serif;letter-spacing:4px;text-transform:uppercase;color:#d6b26a">Ježíškova dílna</p>'
        . '<h1 style="margin:14px 0 0;font-weight:normal;font-style:italic;font-size:30px;line-height:1.15;color:#f6e3ad">' . $h($name) . '</h1>'
        . '</td></tr>'
        . '<tr><td style="padding:18px 32px 0;font:16px/1.55 Arial,sans-serif;color:#e8e0cc">Ahoj,<br>' . $h($lead) . '</td></tr>'
        . '<tr><td align="center" style="padding:24px 32px">'
        . '<a href="' . $h($link) . '" style="display:inline-block;padding:15px 26px;background:#d6b26a;color:#2a1a10;font:bold 13px/1 Arial,sans-serif;letter-spacing:3px;text-transform:uppercase;text-decoration:none;border-radius:3px">Otevřít dílnu</a>'
        . '</td></tr>'
        . '<tr><td style="padding:0 32px;font:12px/1.5 \'Courier New\',monospace;color:#b7b29a;word-break:break-all;text-align:center">' . $h($link) . '</td></tr>'
        . '<tr><td style="padding:22px 32px 32px;font:13px/1.55 Arial,sans-serif;color:#b7b29a">' . $h($foot) . '<br><br>Veselé Vánoce<br>Ježíškova dílna</td></tr>'
        . '</table></td></tr></table></body></html>';
    return [$subject, $text, $html];
}

/** "=?UTF-8?B?…?=" words, split on character boundaries so no line gets too long */
function mime_header(string $s): string {
    if (!preg_match('/[^\x20-\x7E]/', $s)) return $s;
    $words = []; $cur = '';
    foreach (preg_split('//u', $s, -1, PREG_SPLIT_NO_EMPTY) as $ch) {
        if (strlen($cur . $ch) > 45) { $words[] = $cur; $cur = ''; }
        $cur .= $ch;
    }
    if ($cur !== '') $words[] = $cur;
    return implode("\r\n ", array_map(function ($w) { return '=?UTF-8?B?' . base64_encode($w) . '?='; }, $words));
}
/** "Ježíškova dílna <dilna@example.cz>" → [display header, bare address] */
function mail_address(string $v): array {
    if (preg_match('/^\s*(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/u', $v, $m)) {
        $name = trim($m[1], " \"");
        return [$name !== '' ? mime_header($name) . " <{$m[2]}>" : $m[2], $m[2]];
    }
    return [trim($v), trim($v)];
}

function build_message(array $mail, string $to, string $subject, string $text, string $html): array {
    [$fromHeader, $fromAddr] = mail_address($mail['from']);
    $boundary = 'xd-' . bin2hex(random_bytes(12));
    $domain = substr(strrchr($fromAddr, '@') ?: '@localhost', 1);
    $headers = [
        'Date: ' . date(DATE_RFC2822),
        'From: ' . $fromHeader,
        'To: ' . $to,
        'Subject: ' . mime_header($subject),
        'Message-ID: <' . bin2hex(random_bytes(16)) . '@' . $domain . '>',
        'MIME-Version: 1.0',
        'Content-Type: multipart/alternative; boundary="' . $boundary . '"',
    ];
    if ($mail['replyTo'] !== '') $headers[] = 'Reply-To: ' . mail_address($mail['replyTo'])[0];
    $part = function (string $type, string $body) use ($boundary): string {
        return "--{$boundary}\r\nContent-Type: {$type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n"
            . rtrim(chunk_split(base64_encode($body), 76, "\r\n")) . "\r\n";
    };
    $body = $part('text/plain', $text) . $part('text/html', $html) . "--{$boundary}--\r\n";
    return [$headers, $body, $fromAddr, $domain];
}

/** Minimal SMTP client: implicit TLS (465) or STARTTLS (587), AUTH PLAIN / LOGIN. Throws on error. */
function smtp_send(array $mail, string $to, string $subject, string $text, string $html): void {
    [$headers, $body, $fromAddr, $domain] = build_message($mail, $to, $subject, $text, $html);
    $remote = ($mail['secure'] === 'tls' ? 'ssl://' : 'tcp://') . $mail['host'] . ':' . $mail['port'];
    $ctx = stream_context_create(['ssl' => ['peer_name' => $mail['host'], 'verify_peer' => true, 'verify_peer_name' => true]]);
    $fp = @stream_socket_client($remote, $errno, $errstr, 10, STREAM_CLIENT_CONNECT, $ctx);
    if (!$fp) throw new RuntimeException("SMTP: nepodařilo se připojit k {$mail['host']}:{$mail['port']} ({$errstr})");
    stream_set_timeout($fp, 15);
    $read = function () use ($fp): array {
        $all = '';
        while (($line = fgets($fp, 1024)) !== false) {
            $all .= $line;
            if (strlen($line) < 4 || $line[3] === ' ') break;
        }
        return [(int) substr($all, 0, 3), $all];
    };
    $cmd = function (?string $line, array $expect, string $hide = '') use ($fp, $read): string {
        if ($line !== null) fwrite($fp, $line . "\r\n");
        [$code, $resp] = $read();
        if (!in_array($code, $expect, true)) {
            throw new RuntimeException('SMTP: ' . ($hide ?: ($line ?? 'spojení')) . ' → ' . trim($resp));
        }
        return $resp;
    };
    try {
        $cmd(null, [220]);
        $ehlo = $cmd('EHLO ' . $domain, [250]);
        if ($mail['secure'] === 'starttls') {
            $cmd('STARTTLS', [220]);
            if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | (defined('STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT') ? STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT : 0))) {
                throw new RuntimeException('SMTP: STARTTLS se nepodařilo');
            }
            $ehlo = $cmd('EHLO ' . $domain, [250]);
        }
        if ($mail['user'] !== '') {
            if (preg_match('/AUTH[ =][^\r\n]*PLAIN/i', $ehlo)) {
                $cmd('AUTH PLAIN ' . base64_encode("\0{$mail['user']}\0{$mail['pass']}"), [235], 'AUTH PLAIN');
            } else {
                $cmd('AUTH LOGIN', [334]);
                $cmd(base64_encode($mail['user']), [334], 'AUTH LOGIN (jméno)');
                $cmd(base64_encode($mail['pass']), [235], 'AUTH LOGIN (heslo)');
            }
        }
        $cmd("MAIL FROM:<{$fromAddr}>", [250]);
        $cmd("RCPT TO:<{$to}>", [250, 251]);
        $cmd('DATA', [354]);
        $data = implode("\r\n", $headers) . "\r\n\r\n" . $body;
        $data = preg_replace('/^\./m', '..', $data);           // dot-stuffing
        fwrite($fp, $data . "\r\n.\r\n");
        $cmd(null, [250], 'DATA');
        fwrite($fp, "QUIT\r\n");
    } finally {
        fclose($fp);
    }
}

function send_mail(string $to, array $msg): void {
    global $MAIL;
    [$subject, $text, $html] = $msg;
    if ($MAIL['host'] === '' && $MAIL['transport'] === 'mail') {
        [$headers, $body, $fromAddr] = build_message($MAIL, $to, $subject, $text, $html);
        $headers = array_values(array_filter($headers, function ($h) { return strpos($h, 'To: ') !== 0 && strpos($h, 'Subject: ') !== 0; }));
        if (!mail($to, mime_header($subject), $body, implode("\r\n", $headers), '-f' . $fromAddr)) throw new RuntimeException('mail() selhalo');
        return;
    }
    smtp_send($MAIL, $to, $subject, $text, $html);
}

/** Sends the secret link; true when it went out. Never throws. */
function mail_link(array $w, string $kind, ?string $key = null): bool {
    global $MAIL, $SECRET;
    if (!$MAIL['enabled'] || ($w['email'] ?? '') === '') return false;
    if (!empty($w['mailedAt']) && time() - strtotime((string) $w['mailedAt']) < $MAIL['gap']) return false;
    $k = $key ?? decrypt_str($SECRET, $w['keyEnc'] ?? '');
    if (!$k) return false;
    try {
        send_mail((string) $w['email'], link_message($kind, (string) $w['name'], $MAIL['appUrl'] . '/dilna#klic=' . $k));
    } catch (Throwable $e) {
        error_log("E-mail ({$kind}) se nepodařilo odeslat: " . $e->getMessage());
        return false;
    }
    $fresh = get_workshop($w['id']);
    if ($fresh) { $fresh['mailedAt'] = now_iso(); put_workshop($fresh); }
    return true;
}

function adjust_usage(string $id, int $delta): void {
    $w = get_workshop($id);
    if (!$w) return;
    $w['usedBytes'] = max(0, (int) ($w['usedBytes'] ?? 0) + $delta);
    put_workshop($w);
}
function unique_code(): string {
    for ($i = 0; $i < 20; $i++) { $c = generate_code(); if (!get_gift($c)) return $c; }
    throw new RuntimeException('code');
}
function remove_orphan_files(string $owner, array $before, array $after): void {
    $keep = [];
    foreach ($after as $i) if (!empty($i['file'])) $keep[$i['file']['id']] = true;
    $freed = 0;
    foreach ($before as $i) {
        if (!empty($i['file']) && !isset($keep[$i['file']['id']])) { delete_file((string) $i['file']['id']); $freed += (int) ($i['file']['size'] ?? 0); }
    }
    if ($freed) adjust_usage($owner, -$freed);
}

/* ---------- request ---------- */

if (strlen($SECRET) < 16) fail(500, 'not_configured', 'Chybí APP_SECRET v config.php (aspoň 16 znaků). Podepisuje přihlášení a šifruje odkazy do dílen.');

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$path = (string) ($_GET['path'] ?? '');
if ($path === '' && !empty($_SERVER['PATH_INFO'])) $path = ltrim((string) $_SERVER['PATH_INFO'], '/');
$seg = array_values(array_filter(explode('/', $path), 'strlen'));
$seg = array_map('rawurldecode', $seg);
$MB = function (int $b): int { return (int) round($b / 1048576); };

try {
    // CSRF guard: every state-changing call must come from our own pages (custom header)
    if ($method !== 'GET' && ($seg[0] ?? '') !== 'gifts' && ($_SERVER['HTTP_X_ADMIN'] ?? '') !== '1') {
        fail(403, 'forbidden', 'Chybí hlavička X-Admin.');
    }

    if (($seg[0] ?? '') === 'info' && count($seg) === 1 && $method === 'GET') {
        send_json(['mail' => $MAIL['enabled'], 'signupCode' => $SIGNUP_CODE !== '']);
    }

    /* ----- public: recipients ----- */
    if (($seg[0] ?? '') === 'gifts') {
        $code = normalize_code($seg[1] ?? '');
        $g = $code ? get_gift($code) : null;
        if (!$g) fail(404, 'not_found', 'Dárek s tímto kódem neexistuje.');
        $isOwner = function () use ($g) { $w = current_workshop(); return $w && ($g['owner'] ?? null) === $w['id']; };

        if (count($seg) === 2 && $method === 'GET') {
            send_json([
                'code' => $g['code'],
                'title' => $g['showTitle'] ? $g['title'] : null,
                'hasPassword' => !empty($g['passwordHash']),
                'appearance' => $g['appearance'],
                'locked' => is_locked($g),
                'openAt' => $g['anytime'] ? null : $g['openAt'],
                'serverNow' => now_iso(),
            ]);
        }
        if (count($seg) === 3 && $seg[2] === 'open' && $method === 'POST') {
            $b = body_json();
            $preview = ($b['preview'] ?? false) === true && $isOwner();
            if (!$preview) {
                $viaToken = is_string($b['token'] ?? null) && check_token($SECRET, gift_scope($g), $b['token']);
                if (!empty($g['passwordHash']) && !$viaToken && !verify_password(normalize_password($b['password'] ?? ''), $g['passwordHash'])) {
                    usleep(600000);
                    fail(401, 'bad_password', 'Tohle heslo dárek neotevře.');
                }
                if (is_locked($g)) fail(423, 'locked', 'Dárek ještě nejde rozbalit.', ['openAt' => $g['openAt'], 'serverNow' => now_iso()]);
            }
            send_json(['gift' => public_gift($g), 'token' => sign_token($SECRET, gift_scope($g), GIFT_TTL), 'preview' => $preview]);
        }
        if (count($seg) === 5 && $seg[2] === 'items' && $seg[4] === 'file' && $method === 'GET') {
            if (!$isOwner()) {
                if (!check_token($SECRET, gift_scope($g), $_GET['t'] ?? null)) fail(401, 'bad_token', 'Platnost odkazu vypršela. Otevři dárek znovu.');
                if (is_locked($g)) fail(423, 'locked', 'Dárek ještě nejde rozbalit.');
            }
            foreach ($g['items'] as $i) {
                if ($i['id'] === $seg[3] && !empty($i['file'])) send_pdf($i['file']['id'], $i['file']['name'], ($_GET['dl'] ?? '') === '1');
            }
            fail(404, 'not_found', 'Soubor nenalezen.');
        }
        fail(404, 'not_found', 'Neznámá cesta.');
    }

    /* ----- workshop (account) ----- */
    if (($seg[0] ?? '') === 'workshop') {
        if (count($seg) === 1 && $method === 'POST') {
            $b = body_json();
            if ($SIGNUP_CODE !== '' && !hash_equals($SIGNUP_CODE, trim((string) ($b['signupCode'] ?? '')))) {
                usleep(600000);
                fail(403, 'bad_signup_code', 'Kód pro založení dílny nesedí.');
            }
            $email = clean_email($b['email'] ?? '');
            if ($email === null) fail(400, 'bad_email', 'Tohle nevypadá jako e-mailová adresa.');
            $now = now_iso();
            $name = clean_name($b['name'] ?? '');
            $w = ['id' => random_id(9), 'name' => $name !== '' ? $name : 'Moje dílna', 'email' => $email, 'keyHash' => '', 'keyEnc' => '', 'usedBytes' => 0, 'createdAt' => $now, 'updatedAt' => $now];
            $key = new_key_for($w);
            put_workshop($w);
            index_email($w['id'], '', $email);
            $mailed = mail_link($w, 'welcome', $key);
            sign_in($w);
            send_json(['workshop' => workshop_view($w, $key), 'mailed' => $mailed], 201);
        }
        if (($seg[1] ?? '') === 'login' && $method === 'POST') {
            $b = body_json();
            $key = trim((string) ($b['key'] ?? ''));
            $id = is_key_shaped($key) ? get_key_owner(hash('sha256', $key)) : null;
            $w = $id ? get_workshop($id) : null;
            if (!$w || !hash_equals((string) $w['keyHash'], hash('sha256', $key))) {
                usleep(600000);
                fail(401, 'bad_key', 'Tenhle odkaz do dílny neplatí. Možná byl vyměněn za nový.');
            }
            sign_in($w);
            send_json(['workshop' => workshop_view($w, $key)]);
        }
        if (($seg[1] ?? '') === 'logout' && $method === 'POST') { sign_out(); send_json(['ok' => true]); }
        // lost link: same answer whether or not the address has a workshop
        if (($seg[1] ?? '') === 'recover' && $method === 'POST') {
            if (!$MAIL['enabled']) fail(503, 'mail_off', 'Posílání e-mailů tady není zapnuté.');
            $email = clean_email(body_json()['email'] ?? '');
            if (!$email) fail(400, 'bad_email', 'Napiš e-mailovou adresu, kterou máš u dílny uloženou.');
            $started = microtime(true);
            foreach (array_slice(get_email_owners(email_hash($email)), 0, 5) as $id) {
                $o = get_workshop($id);
                if ($o && ($o['email'] ?? '') !== '' && email_hash((string) $o['email']) === email_hash($email)) mail_link($o, 'recover');
            }
            $left = 0.7 - (microtime(true) - $started);
            if ($left > 0) usleep((int) ($left * 1e6));
            send_json(['ok' => true]);
        }

        $w = current_workshop();
        if (!$w) fail(401, 'unauthorized', 'Otevři svou dílnu tajným odkazem.');

        if (count($seg) === 1 && $method === 'GET') send_json(['workshop' => workshop_view($w)]);
        if (count($seg) === 1 && $method === 'PUT') {
            $b = body_json();
            $email = array_key_exists('email', $b) ? clean_email($b['email']) : $w['email'];
            if ($email === null) fail(400, 'bad_email', 'Tohle nevypadá jako e-mailová adresa.');
            if (array_key_exists('name', $b)) { $n = clean_name($b['name']); $w['name'] = $n !== '' ? $n : 'Moje dílna'; }
            $oldEmail = (string) ($w['email'] ?? '');
            $w['email'] = $email;
            $w['updatedAt'] = now_iso();
            put_workshop($w);
            index_email($w['id'], $oldEmail, $email);
            send_json(['workshop' => workshop_view($w)]);
        }
        if (($seg[1] ?? '') === 'send-link' && $method === 'POST') {
            if (!$MAIL['enabled']) fail(503, 'mail_off', 'Posílání e-mailů tady není zapnuté.');
            if (($w['email'] ?? '') === '') fail(400, 'no_email', 'Nejdřív ulož e-mail, na který odkaz poslat.');
            if (!empty($w['mailedAt']) && time() - strtotime((string) $w['mailedAt']) < $MAIL['gap']) {
                fail(429, 'too_soon', 'E-mail jsme poslali před chvílí. Zkus to zase za minutu.');
            }
            if (!mail_link($w, 'link')) fail(502, 'mail_failed', 'E-mail se nepodařilo odeslat. Zkus to prosím později.');
            send_json(['ok' => true, 'email' => $w['email']]);
        }
        if (($seg[1] ?? '') === 'rotate-key' && $method === 'POST') {
            $old = (string) $w['keyHash'];
            $key = new_key_for($w);
            $w['updatedAt'] = now_iso();
            put_workshop($w);
            delete_key_owner($old);
            $mailed = mail_link(array_merge($w, ['mailedAt' => null]), 'rotated', $key);
            sign_in($w);
            send_json(['workshop' => workshop_view($w, $key), 'mailed' => $mailed]);
        }
        if (count($seg) === 1 && $method === 'DELETE') {
            foreach (gifts_by_owner($w['id']) as $g) delete_gift($g['code']);
            foreach (files_by_owner($w['id']) as $f) delete_file((string) $f['id']);
            delete_key_owner((string) $w['keyHash']);
            index_email($w['id'], (string) ($w['email'] ?? ''), '');
            delete_workshop($w['id']);
            sign_out();
            send_json(['ok' => true]);
        }
        fail(404, 'not_found', 'Neznámá cesta.');
    }

    /* ----- the workshop's boxes and files ----- */
    if (($seg[0] ?? '') === 'admin') {
        $w = current_workshop();
        if (!$w) fail(401, 'unauthorized', 'Otevři svou dílnu tajným odkazem.');

        if (($seg[1] ?? '') === 'files') {
            if (count($seg) === 2 && $method === 'POST') {
                $mb = $MB($MAX_UPLOAD);
                if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > $MAX_UPLOAD) fail(413, 'too_large', "Soubor je větší než $mb MB.");
                $buf = (string) file_get_contents('php://input');
                if (strlen($buf) > $MAX_UPLOAD) fail(413, 'too_large', "Soubor je větší než $mb MB.");
                if ($buf === '') fail(413, 'too_large', "Soubor se nepodařilo přijmout. Zkontroluj post_max_size v PHP (limit aplikace je $mb MB).");
                if (substr($buf, 0, 5) !== '%PDF-') fail(415, 'not_pdf', 'Nahrát jde jen PDF soubor.');
                if ((int) ($w['usedBytes'] ?? 0) + strlen($buf) > $MAX_STORAGE) {
                    fail(413, 'quota', 'Dílna má místo na ' . $MB($MAX_STORAGE) . ' MB PDF a je plná. Smaž nepotřebné poukazy.');
                }
                $name = rawurldecode((string) ($_SERVER['HTTP_X_FILE_NAME'] ?? 'poukaz.pdf'));
                $name = mb_substr((string) preg_replace('#[\\\\/\r\n]#', '_', $name), 0, 120, 'UTF-8') ?: 'poukaz.pdf';
                $meta = ['id' => random_id(12), 'owner' => $w['id'], 'name' => $name, 'size' => strlen($buf), 'createdAt' => now_iso()];
                file_put_contents("$FILES/{$meta['id']}.pdf", $buf);
                write_atomic("$FILES/{$meta['id']}.json", json_encode($meta, JSON_UNESCAPED_UNICODE));
                adjust_usage($w['id'], strlen($buf));
                send_json(['id' => $meta['id'], 'name' => $meta['name'], 'size' => $meta['size']], 201);
            }
            if (count($seg) === 3 && $method === 'GET') {
                $m = file_meta($seg[2]);
                if (!$m || ($m['owner'] ?? null) !== $w['id']) fail(404, 'not_found', 'Soubor nenalezen.');
                send_pdf($m['id'], $m['name'], false);
            }
        }

        if (($seg[1] ?? '') === 'gifts') {
            if (count($seg) === 2 && $method === 'GET') {
                $all = gifts_by_owner($w['id']);
                usort($all, function ($a, $b) { return strcmp((string) $b['updatedAt'], (string) $a['updatedAt']); });
                send_json(['gifts' => array_map('summary', $all), 'serverNow' => now_iso()]);
            }
            if (count($seg) === 2 && $method === 'POST') {
                if (count(gifts_by_owner($w['id'])) >= $MAX_GIFTS) fail(409, 'limit', "V jedné dílně může být nejvýš $MAX_GIFTS boxů.");
                $b = body_json();
                $now = now_iso();
                $g = [
                    'code' => unique_code(), 'owner' => $w['id'],
                    'title' => s($b['title'] ?? '', 120) ?: 'Nový dárek',
                    'showTitle' => true, 'message' => '', 'signature' => '',
                    'passwordHash' => null, 'anytime' => false, 'openAt' => default_open_at(),
                    'manualUnlock' => false,
                    'appearance' => sanitize_appearance($b['appearance'] ?? null),
                    'reveal' => in_array($b['reveal'] ?? null, REVEALS, true) ? $b['reveal'] : 'all',
                    'items' => [], 'createdAt' => $now, 'updatedAt' => $now,
                ];
                put_gift($g);
                send_json(admin_view($g), 201);
            }

            $code = normalize_code($seg[2] ?? '');
            $g = $code ? get_gift($code) : null;
            // someone else's box looks exactly like a missing one
            if (!$g || ($g['owner'] ?? null) !== $w['id']) fail(404, 'not_found', 'Box nenalezen.');

            if (count($seg) === 3 && $method === 'GET') send_json(admin_view($g));

            if (count($seg) === 3 && $method === 'PUT') {
                $b = body_json();
                $prevFiles = [];
                foreach ($g['items'] as $i) if (!empty($i['file'])) $prevFiles[$i['file']['id']] = $i['file'];
                $items = [];
                foreach (array_slice(is_array($b['items'] ?? null) ? $b['items'] : [], 0, MAX_ITEMS) as $raw) {
                    $file = null;
                    $fid = $raw['file']['id'] ?? null;
                    if ($fid) {
                        if (isset($prevFiles[$fid])) $file = $prevFiles[$fid];
                        elseif (($m = file_meta((string) $fid)) && ($m['owner'] ?? null) === $w['id']) $file = ['id' => $m['id'], 'name' => $m['name'], 'size' => $m['size']];
                    }
                    $id = (string) ($raw['id'] ?? '');
                    $items[] = [
                        'id' => preg_match('/^[\w-]{4,40}$/', $id) ? $id : random_id(6),
                        'name' => s($raw['name'] ?? '', 160),
                        'description' => s($raw['description'] ?? '', 4000),
                        'file' => $file,
                    ];
                }
                $title = trim(s($b['title'] ?? '', 120));
                $openAt = strtotime((string) ($b['openAt'] ?? ''));
                $next = array_merge($g, [
                    'title' => $title !== '' ? $title : $g['title'],
                    'showTitle' => !empty($b['showTitle']),
                    'message' => s($b['message'] ?? '', 4000),
                    'signature' => s($b['signature'] ?? '', 200),
                    'anytime' => !empty($b['anytime']),
                    'manualUnlock' => !empty($b['manualUnlock']),
                    'openAt' => $openAt !== false ? iso($openAt) : $g['openAt'],
                    'appearance' => array_key_exists('appearance', $b) ? sanitize_appearance($b['appearance']) : $g['appearance'],
                    'reveal' => in_array($b['reveal'] ?? null, REVEALS, true) ? $b['reveal'] : $g['reveal'],
                    'items' => $items,
                    'updatedAt' => now_iso(),
                ]);
                if (array_key_exists('password', $b)) {
                    if ($b['password'] === null) $next['passwordHash'] = null;
                    elseif (is_string($b['password'])) {
                        $pw = normalize_password($b['password']);
                        if ($pw === '') fail(400, 'empty_password', 'Heslo nesmí být prázdné. Pro dárek bez hesla vypni heslo.');
                        $next['passwordHash'] = hash_password($pw);
                    }
                }
                put_gift($next);
                remove_orphan_files($w['id'], $g['items'], $items);
                send_json(admin_view($next));
            }

            if (count($seg) === 3 && $method === 'DELETE') {
                delete_gift($g['code']);
                remove_orphan_files($w['id'], $g['items'], []);
                send_json(['ok' => true]);
            }

            if (count($seg) === 4 && $seg[3] === 'regenerate-code' && $method === 'POST') {
                $next = array_merge($g, ['code' => unique_code(), 'updatedAt' => now_iso()]);
                delete_gift($g['code']);
                put_gift($next);
                send_json(admin_view($next));
            }
        }
        fail(404, 'not_found', 'Neznámá cesta.');
    }
    fail(404, 'not_found', 'Neznámá cesta.');
} catch (Throwable $e) {
    error_log((string) $e);
    fail(500, 'server_error', 'Na serveru se něco pokazilo. Zkus to prosím znovu.');
}
