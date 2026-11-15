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
$PUSH = [
    'public' => trim((string) cfg($config, 'VAPID_PUBLIC_KEY', '')),
    'private' => trim((string) cfg($config, 'VAPID_PRIVATE_KEY', '')),
    'subject' => trim((string) cfg($config, 'VAPID_SUBJECT', 'mailto:dilna@example.cz')),
    'testSink' => trim((string) cfg($config, 'PUSH_TEST_SINK', '')),   // tests only
];
$PUSH['enabled'] = $PUSH['public'] !== '' && $PUSH['private'] !== '';
$CRON_SECRET = trim((string) cfg($config, 'CRON_SECRET', ''));
$RING_GAP = (int) cfg($config, 'RING_GAP_SECONDS', 60);

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
const PAPERS = ['burgundy', 'scarlet', 'emerald', 'fir', 'midnight', 'plum', 'charcoal', 'ivory', 'frost', 'champagne', 'gold', 'blush', 'silver', 'kraft'];
const PATTERNS = ['plain', 'stripes', 'dots', 'tartan', 'stars', 'snow', 'trees', 'baubles', 'holly', 'candy', 'gingerbread', 'deer', 'hearts', 'chevron', 'waves', 'confetti', 'balloons', 'cupcakes', 'streamers', 'rings', 'flowers', 'lace'];
const INKS = ['white', 'cream', 'gold', 'silver', 'bronze', 'red', 'green', 'navy', 'brown', 'black', 'paper', 'pink', 'sky', 'mint', 'lilac'];
const RIBBONS = ['gold', 'silver', 'copper', 'red', 'burgundy', 'pink', 'green', 'navy', 'white', 'black'];
const RIBBON_STYLES = ['cross', 'single', 'none'];
const BOWS = ['classic', 'double', 'rosette', 'small', 'none'];
const DECOS = ['none', 'holly', 'pine', 'candy', 'bauble', 'star', 'bells', 'orange', 'tag', 'balloons', 'candle', 'partyhat', 'rings', 'rose', 'heart'];
const PHOTO_FRAMES = ['polaroid', 'postcard'];
const REVEALS = ['all', 'sequential', 'choice'];
const THEMES = ['christmas', 'birthday', 'wedding', 'general'];   // occasion of a box (and the workshop's current one)
/** unknown / not chosen → "general" (neutral); boxes saved before occasions existed were Christmas boxes */
function theme_of($v, string $fallback = 'general'): string { return in_array($v, THEMES, true) ? $v : $fallback; }
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Content type from the first bytes (never trust the browser's word) */
function sniff_type(string $buf): ?string {
    if (substr($buf, 0, 5) === '%PDF-') return 'application/pdf';
    if (substr($buf, 0, 3) === "\xFF\xD8\xFF") return 'image/jpeg';
    if (substr($buf, 0, 8) === "\x89PNG\r\n\x1A\n") return 'image/png';
    if (substr($buf, 0, 4) === 'RIFF' && substr($buf, 8, 4) === 'WEBP') return 'image/webp';
    // sound and video: the container says nothing about what's inside, the uploader's hint picks audio/ or video/
    if (substr($buf, 0, 4) === "\x1A\x45\xDF\xA3") return 'media/webm';
    if (substr($buf, 4, 4) === 'ftyp') return 'media/mp4';
    if (substr($buf, 0, 4) === 'OggS') return 'audio/ogg';
    if (substr($buf, 0, 3) === 'ID3' || (strlen($buf) > 1 && $buf[0] === "\xFF" && (ord($buf[1]) & 0xE0) === 0xE0)) return 'audio/mpeg';
    if (substr($buf, 0, 4) === 'RIFF' && substr($buf, 8, 4) === 'WAVE') return 'audio/wav';
    return null;
}
const CLIP_SECONDS = 30;       // the creator's voice / video message
const REACTION_SECONDS = 60;   // the recipient's unwrapping video
/** sniffed type + the uploader's hint → the final media type, or null when it isn't sound/video */
function media_type(?string $sniffed, $kind): ?string {
    if (!$sniffed) return null;
    if (strpos($sniffed, 'media/') === 0) return ($kind === 'audio' ? 'audio' : 'video') . '/' . substr($sniffed, 6);
    return strpos($sniffed, 'audio/') === 0 ? $sniffed : null;
}
function is_media(?array $m): bool { return (bool) preg_match('#^(audio|video)/#', file_type($m)); }
function media_seconds($v, int $max): ?float { $n = round((float) $v, 1); return $n > 0 ? min($n, $max) : null; }
function file_type(?array $m): string { return (string) ($m['type'] ?? 'application/pdf'); }

function sanitize_appearance($a): array {
    $a = is_array($a) ? $a : [];
    $pick = function (array $list, $v, string $d) { return in_array($v, $list, true) ? $v : $d; };
    $seal = isset($a['seal']) && is_string($a['seal']) ? mb_substr(trim($a['seal']), 0, 2, 'UTF-8') : 'V';
    $op = $a['patternOpacity'] ?? null;
    $op = (is_int($op) || is_float($op) || (is_string($op) && is_numeric($op))) ? (int) max(5, min(90, round((float) $op))) : null;
    return [
        'paper' => $pick(PAPERS, $a['paper'] ?? null, 'burgundy'),
        'pattern' => $pick(PATTERNS, $a['pattern'] ?? null, 'stripes'),
        'patternColor' => in_array($a['patternColor'] ?? null, INKS, true) ? $a['patternColor'] : null,
        'patternOpacity' => $op,
        'ribbon' => $pick(RIBBONS, $a['ribbon'] ?? null, 'gold'),
        'ribbonStyle' => $pick(RIBBON_STYLES, $a['ribbonStyle'] ?? null, 'cross'),
        'bow' => $pick(BOWS, $a['bow'] ?? null, 'classic'),
        'deco' => $pick(DECOS, $a['deco'] ?? null, 'none'),
        'seal' => $seal,
    ];
}
/** every uploaded file a box references: vouchers + its photo */
function files_of(array $g): array {
    $out = [];
    foreach ($g['items'] as $i) if (!empty($i['file'])) $out[] = $i['file'];
    if (!empty($g['photo']['file'])) $out[] = $g['photo']['file'];
    if (!empty($g['clip']['file'])) $out[] = $g['clip']['file'];
    if (!empty($g['reaction']['file'])) $out[] = $g['reaction']['file'];
    return $out;
}
function with_defaults(?array $g): ?array {
    if (!$g) return $g;
    $g['appearance'] = sanitize_appearance($g['appearance'] ?? null);
    $g['reveal'] = in_array($g['reveal'] ?? null, REVEALS, true) ? $g['reveal'] : 'all';
    $g['photo'] = $g['photo'] ?? null;
    $g['clip'] = $g['clip'] ?? null;
    $g['reaction'] = $g['reaction'] ?? null;
    $g['askReaction'] = !empty($g['askReaction']);
    $g['theme'] = theme_of($g['theme'] ?? null, 'christmas');
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
$STATS = $DATA_DIR . '/stats';
$DUE = $DATA_DIR . '/due';
$SUBS = $DATA_DIR . '/subs';
$INBOX = $DATA_DIR . '/inbox';
foreach ([$GIFTS, $FILES, $WORKSHOPS, $KEYS, $EMAILS, $STATS, $DUE, $SUBS, $INBOX] as $d) if (!is_dir($d)) @mkdir($d, 0775, true);
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
function delete_gift(string $code): void { global $GIFTS, $STATS; if (safe_name($code)) { @unlink("$GIFTS/$code.json"); @unlink("$STATS/$code.json"); } }

/* views / unwraps of a box, kept apart so a visit never overwrites the creator's edit */
const EMPTY_STATS = ['views' => 0, 'opens' => 0, 'firstViewAt' => null, 'lastViewAt' => null, 'firstOpenAt' => null, 'lastOpenAt' => null];
function get_stats(string $code): array {
    global $STATS;
    $s = safe_name($code) ? read_json_file("$STATS/$code.json") : null;
    return array_merge(EMPTY_STATS, is_array($s) ? $s : []);
}
function bump_stats(string $code, string $kind): int {
    global $STATS;
    if (!safe_name($code)) return 0;
    $fp = @fopen("$STATS/$code.lock", 'c');
    if ($fp) flock($fp, LOCK_EX);
    $s = get_stats($code);
    $at = now_iso();
    if ($kind === 'open') { $s['opens']++; $s['firstOpenAt'] = $s['firstOpenAt'] ?? $at; $s['lastOpenAt'] = $at; }
    else { $s['views']++; $s['firstViewAt'] = $s['firstViewAt'] ?? $at; $s['lastViewAt'] = $at; }
    write_atomic("$STATS/$code.json", json_encode($s));
    if ($fp) { flock($fp, LOCK_UN); fclose($fp); @unlink("$STATS/$code.lock"); }
    return $kind === 'open' ? $s['opens'] : $s['views'];   // the new count (1 = the very first)
}
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
        'appearance' => $g['appearance'], 'reveal' => $g['reveal'], 'theme' => $g['theme'],
        'itemCount' => count($g['items']), 'fileCount' => $files, 'hasPhoto' => !empty($g['photo']),
        'hasClip' => !empty($g['clip']), 'hasReaction' => !empty($g['reaction']),
        'createdAt' => $g['createdAt'], 'updatedAt' => $g['updatedAt'],
    ];
}
function public_gift(array $g): array {
    return [
        'code' => $g['code'],
        'theme' => $g['theme'],
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
        // the image itself comes from gifts/<code>/photo?t=<token>
        'photo' => !empty($g['photo']) ? [
            'caption' => $g['photo']['caption'], 'frame' => $g['photo']['frame'],
            'w' => $g['photo']['file']['w'] ?? null, 'h' => $g['photo']['file']['h'] ?? null,
        ] : null,
        // the recording itself comes from gifts/<code>/clip?t=<token>
        'clip' => !empty($g['clip']) ? ['kind' => $g['clip']['kind'], 'duration' => $g['clip']['duration'] ?? null] : null,
    ];
}
function gift_scope(array $g): string {
    return 'gift|' . $g['code'] . '|' . (!empty($g['passwordHash']) ? substr($g['passwordHash'], -16) : 'none');
}
function send_image(array $m): void {
    global $FILES;
    $path = "$FILES/{$m['id']}.pdf";       // every upload keeps the .pdf name, `type` says what it is
    if (!safe_name($m['id']) || !is_file($path) || !in_array(file_type($m), IMAGE_TYPES, true)) fail(404, 'not_found', 'Fotka nenalezena.');
    header('Content-Type: ' . file_type($m));
    header('Content-Length: ' . filesize($path));
    header('Content-Disposition: inline');
    header('Cache-Control: private, no-store');
    header('X-Content-Type-Options: nosniff');
    header("Content-Security-Policy: default-src 'none'; sandbox");
    readfile($path);
    exit;
}
function send_media(?array $m, string $what): void {
    global $FILES;
    $path = $m ? "$FILES/{$m['id']}.pdf" : '';
    if (!$m || !safe_name($m['id']) || !is_file($path) || !is_media($m)) fail(404, 'not_found', "$what nenalezen" . ($what === 'Video' ? 'o.' : '.'));
    header('Content-Type: ' . file_type($m));
    header('Content-Length: ' . filesize($path));
    header('Content-Disposition: inline');
    header('Cache-Control: private, no-store');
    header('X-Content-Type-Options: nosniff');
    header("Content-Security-Policy: default-src 'none'; sandbox");
    readfile($path);
    exit;
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
        'id' => $w['id'], 'name' => $w['name'], 'email' => $w['email'], 'theme' => theme_of($w['theme'] ?? null),
        'notifyOpen' => ($w['notifyOpen'] ?? true) !== false,
        'key' => $key ?? decrypt_str($SECRET, $w['keyEnc'] ?? ''),
        'createdAt' => $w['createdAt'],
        'giftCount' => count(gifts_by_owner($w['id'])),
        'usedBytes' => (int) ($w['usedBytes'] ?? 0),
        'limits' => ['gifts' => $MAX_GIFTS, 'storageBytes' => $MAX_STORAGE, 'uploadBytes' => $MAX_UPLOAD, 'clipSeconds' => CLIP_SECONDS],
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

/* ---------- notifications: e-mail + Web Push (same behaviour as server/app.js, server/push.js) ---------- */

/** Only real push services, so a stored subscription can never make the server call anything else */
function clean_endpoint($v): ?string {
    if (!is_string($v) || strlen($v) > 800) return null;
    $u = parse_url($v);
    if (!$u || ($u['scheme'] ?? '') !== 'https' || isset($u['port']) || isset($u['user']) || isset($u['pass']) || empty($u['host'])) return null;
    $h = strtolower($u['host']);
    foreach (['/^fcm\.googleapis\.com$/', '/^updates\.push\.services\.mozilla\.com$/', '/^push\.services\.mozilla\.com$/', '/(^|\.)push\.apple\.com$/',
              '/(^|\.)notify\.windows\.com$/', '/^android\.googleapis\.com$/', '/^web\.push\.apple\.com$/'] as $re) {
        if (preg_match($re, $h)) return $v;
    }
    return null;
}
function b64u(string $b): string { return rtrim(strtr(base64_encode($b), '+/', '-_'), '='); }
function b64u_dec(string $s): string { return (string) base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4)); }

/** ES256 JWT for VAPID; the raw P-256 key is wrapped into a SEC1 PEM for openssl */
function vapid_jwt(string $aud): string {
    global $PUSH;
    $pub = b64u_dec($PUSH['public']); $d = b64u_dec($PUSH['private']);
    $der = "\x30\x77\x02\x01\x01\x04\x20" . str_pad($d, 32, "\0", STR_PAD_LEFT)
        . "\xa0\x0a\x06\x08\x2a\x86\x48\xce\x3d\x03\x01\x07\xa1\x44\x03\x42\x00" . $pub;
    $pem = "-----BEGIN EC PRIVATE KEY-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END EC PRIVATE KEY-----\n";
    $head = b64u(json_encode(['typ' => 'JWT', 'alg' => 'ES256']));
    $body = b64u(json_encode(['aud' => $aud, 'exp' => time() + 12 * 3600, 'sub' => $PUSH['subject']], JSON_UNESCAPED_SLASHES));
    if (!openssl_sign("$head.$body", $sig, $pem, OPENSSL_ALGO_SHA256)) throw new RuntimeException('VAPID: podpis se nepovedl (zkontroluj klíče)');
    // DER (SEQUENCE of two INTEGERs) → raw r||s, 32 bytes each
    $p = 2; if (ord($sig[1]) & 0x80) $p += ord($sig[1]) & 0x7f;
    $rl = ord($sig[$p + 1]); $r = substr($sig, $p + 2, $rl); $p += 2 + $rl;
    $sl = ord($sig[$p + 1]); $sv = substr($sig, $p + 2, $sl);
    $fix = function ($x) { return str_pad(ltrim($x, "\0"), 32, "\0", STR_PAD_LEFT); };
    return "$head.$body." . b64u($fix($r) . $fix($sv));
}
/** Empty push ("knock"); the service worker then reads api/push/inbox. 'ok' | 'gone' | 'error' */
function push_knock(string $endpoint): string {
    global $PUSH;
    $url = clean_endpoint($endpoint);
    if (!$url) return 'gone';
    $u = parse_url($url);
    try { $jwt = vapid_jwt('https://' . $u['host']); } catch (Throwable $e) { error_log($e->getMessage()); return 'error'; }
    $headers = ['TTL: 86400', 'Urgency: high', 'Content-Length: 0', "Authorization: vapid t=$jwt, k={$PUSH['public']}"];
    $target = $url;
    if ($PUSH['testSink'] !== '') { $target = $PUSH['testSink']; $headers[] = 'X-Push-Endpoint: ' . $url; }
    $ctx = stream_context_create(['http' => ['method' => 'POST', 'header' => implode("\r\n", $headers), 'content' => '', 'timeout' => 8, 'ignore_errors' => true]]);
    $res = @file_get_contents($target, false, $ctx);
    $status = 0;
    if (isset($http_response_header[0]) && preg_match('#\s(\d{3})\s#', $http_response_header[0] . ' ', $m)) $status = (int) $m[1];
    if ($status === 404 || $status === 410) return 'gone';
    return $status >= 200 && $status < 300 ? 'ok' : 'error';
}

function scope_file(string $scope): string { global $SUBS; return "$SUBS/" . str_replace(':', '-', $scope) . '.json'; }
function list_subs(string $scope): array { $all = read_json_file(scope_file($scope)); return is_array($all) ? $all : []; }
function add_sub(string $scope, string $hash, array $sub): void {
    $all = list_subs($scope);
    if (count($all) >= 20 && !isset($all[$hash])) array_shift($all);
    $all[$hash] = $sub;
    write_atomic(scope_file($scope), json_encode($all, JSON_UNESCAPED_SLASHES));
}
function remove_sub(string $scope, string $hash): void {
    global $INBOX;
    $all = list_subs($scope);
    unset($all[$hash]);
    if ($all) write_atomic(scope_file($scope), json_encode($all, JSON_UNESCAPED_SLASHES)); else @unlink(scope_file($scope));
    if (safe_name($hash)) @unlink("$INBOX/$hash.json");
}
function delete_subs(string $scope): void { foreach (array_keys(list_subs($scope)) as $h) remove_sub($scope, (string) $h); }

/** System notification to every browser subscribed to $scope; how many got it */
function push_all(string $scope, array $msg): int {
    global $PUSH, $INBOX;
    if (!$PUSH['enabled']) return 0;
    $ok = 0;
    foreach (list_subs($scope) as $hash => $sub) {
        $hash = (string) $hash;
        if (safe_name($hash)) write_atomic("$INBOX/$hash.json", json_encode($msg + ['at' => now_iso()], JSON_UNESCAPED_UNICODE));
        $r = push_knock((string) ($sub['endpoint'] ?? ''));
        if ($r === 'gone') remove_sub($scope, $hash); elseif ($r === 'ok') $ok++;
    }
    return $ok;
}

/** Same wording as server/mail.js (GIFT_TEXT, PUSH_TEXT) */
function gift_text(string $theme, string $kind): array {
    $t = [
        'christmas' => ['unlocked' => ['Ježíšek ti nadělil dárek', 'Ježíšek ti nadělil dárek. Už je pod stromečkem a můžeš si ho rozbalit.'],
                        'ring' => ['Cinkylink! Ježíšek zazvonil', 'Ježíšek právě zazvonil zvonečkem. Dárek už je pod stromečkem.']],
        'birthday' => ['unlocked' => ['Máš narozeninový dárek', 'Narozeninový dárek je připravený a můžeš si ho rozbalit. Všechno nejlepší!'],
                       'ring' => ['Frrrk! Někdo na tebe troubí', 'Někdo ti zatroubil na frkačku. Narozeninový dárek na tebe čeká.']],
        'wedding' => ['unlocked' => ['Váš svatební dar je připravený', 'Svatební dar je připravený k rozbalení. Hodně štěstí na společné cestě!'],
                      'ring' => ['Cink! Někdo si s vámi připíjí', 'Někdo vám cinkl skleničkou. Svatební dar na vás čeká.']],
        'general' => ['unlocked' => ['Máš dárek', 'Někdo ti poslal dárek a teď už si ho můžeš rozbalit.'],
                      'ring' => ['Ťuk ťuk! Dárek na tebe čeká', 'Někdo ti zaťukal na dveře. Dárek na tebe čeká.']],
    ];
    return ($t[$theme] ?? $t['christmas'])[$kind === 'ring' ? 'ring' : 'unlocked'];
}
function push_text(string $kind, string $theme, string $title): array {
    if ($kind === 'viewed') return ['title' => 'Dárek si někdo otevřel', 'body' => "Odkaz na „{$title}“ se právě poprvé otevřel."];
    if ($kind === 'opened') return ['title' => 'Dárek je rozbalený 🎁', 'body' => "„{$title}“ si obdarovaný právě rozbalil."];
    $t = gift_text($theme, $kind);
    return ['title' => $t[0], 'body' => $title !== '' ? "„{$title}“ " . ($kind === 'ring' ? 'na tebe čeká.' : 'už jde rozbalit.') : ($kind === 'ring' ? 'Dárek na tebe čeká.' : 'Dárek už jde rozbalit.')];
}
function mail_html(string $eyebrow, string $heading, string $lead, string $button, string $link, string $foot): string {
    $h = function (string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); };
    return '<!doctype html><html lang="cs"><body style="margin:0;padding:0;background:#05140e">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#05140e;padding:32px 12px"><tr><td align="center">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#0b241a;border:1px solid #d6b26a;font-family:Georgia,\'Times New Roman\',serif;color:#f3ead6">'
        . '<tr><td style="padding:36px 32px 8px;text-align:center">'
        . '<p style="margin:0;font:12px/1 Arial,sans-serif;letter-spacing:4px;text-transform:uppercase;color:#d6b26a">' . $h($eyebrow) . '</p>'
        . '<h1 style="margin:14px 0 0;font-weight:normal;font-style:italic;font-size:30px;line-height:1.15;color:#f6e3ad">' . $h($heading) . '</h1></td></tr>'
        . '<tr><td style="padding:18px 32px 0;font:16px/1.55 Arial,sans-serif;color:#e8e0cc;text-align:center">' . $h($lead) . '</td></tr>'
        . '<tr><td align="center" style="padding:24px 32px"><a href="' . $h($link) . '" style="display:inline-block;padding:15px 26px;background:#d6b26a;color:#2a1a10;font:bold 13px/1 Arial,sans-serif;letter-spacing:3px;text-transform:uppercase;text-decoration:none;border-radius:3px">' . $h($button) . '</a></td></tr>'
        . '<tr><td style="padding:0 32px 32px;font:13px/1.55 Arial,sans-serif;color:#b7b29a;text-align:center">' . $h($foot) . '</td></tr>'
        . '</table></td></tr></table></body></html>';
}
/** [subject, text, html] */
function gift_message(string $kind, string $theme, string $title, string $link, bool $hasPassword = false): array {
    if ($kind === 'opened') {
        $subject = "Dárek „{$title}“ je rozbalený";
        $lead = "Obdarovaný si právě rozbalil tvůj dárek „{$title}“. V dílně uvidíš, kdy dárek otevřel a rozbalil.";
        $foot = 'Tohle upozornění vypneš v dílně v okně Moje dílna.';
        return [$subject, "Ahoj,\n\n$lead\n\n$link\n\n$foot\n", mail_html('Dárek je rozbalený', $title, $lead, 'Otevřít dílnu', $link, $foot)];
    }
    $t = gift_text($theme, $kind);
    $foot = $hasPassword ? 'Dárek je zamčený heslem. Prozradí ti ho ten, kdo ho balil.' : 'Stačí kliknout na tlačítko.';
    return [$title !== '' ? "{$t[0]}: $title" : $t[0], "Ahoj,\n\n{$t[1]}\n\n$link\n\n$foot\n", mail_html($t[0], $title !== '' ? $title : 'Dárek pro tebe', $t[1], 'Rozbalit dárek', $link, $foot)];
}

/** "unlocked" | "ring": e-mail to the recipient (if the box has the address) + push to their browsers */
function notify_recipient(array $g, string $kind): array {
    global $MAIL;
    $title = $g['showTitle'] ? (string) $g['title'] : '';
    $mailed = false;
    if (($g['recipientEmail'] ?? '') !== '' && $MAIL['enabled']) {
        try { send_mail((string) $g['recipientEmail'], gift_message($kind, $g['theme'], $title, $MAIL['appUrl'] . '/' . $g['code'], !empty($g['passwordHash']))); $mailed = true; }
        catch (Throwable $e) { error_log("E-mail příjemci ($kind) se nepodařilo odeslat: " . $e->getMessage()); }
    }
    $pushed = push_all('g:' . $g['code'], push_text($kind, $g['theme'], $title) + ['url' => $g['code'], 'tag' => 'gift-' . $g['code']]);
    return ['mailed' => $mailed, 'pushed' => $pushed];
}
/** First view / unwrap → tell the creator (push; for the unwrap also e-mail) */
function track(array $g, string $kind): void {
    global $MAIL;
    if (bump_stats($g['code'], $kind) !== 1) return;
    $title = (string) ($g['title'] ?: 'Dárek');
    push_all('w:' . $g['owner'], push_text($kind === 'open' ? 'opened' : 'viewed', $g['theme'], $title) + ['url' => 'dilna', 'tag' => 'stat-' . $g['code']]);
    if ($kind === 'open' && $MAIL['enabled']) {
        $w = get_workshop((string) $g['owner']);
        if ($w && ($w['email'] ?? '') !== '' && ($w['notifyOpen'] ?? true) !== false) {
            try { send_mail((string) $w['email'], gift_message('opened', $g['theme'], $title, $MAIL['appUrl'] . '/dilna')); }
            catch (Throwable $e) { error_log('E-mail tvůrci se nepodařilo odeslat: ' . $e->getMessage()); }
        }
    }
}
function set_due(string $code, ?int $ms): void {
    global $DUE;
    if (!safe_name($code)) return;
    if ($ms === null) @unlink("$DUE/$code"); else write_atomic("$DUE/$code", (string) $ms);
}
/** Keeps the "notify at unlock" schedule in step with the box; returns the (maybe updated) box */
function sync_due(?array $prev, array $next): array {
    if (is_locked($next)) { set_due($next['code'], (int) (strtotime($next['openAt']) * 1000)); return $next; }
    set_due($next['code'], null);
    if ($prev && is_locked($prev) && empty($next['anytime']) && empty($next['notifiedAt'])) {
        notify_recipient($next, 'unlocked');
        $next['notifiedAt'] = now_iso();
        put_gift($next);
    }
    return $next;
}
/** Boxes whose time has come: notify each once (rename = atomic claim) */
function process_due(int $limit = 25): int {
    global $DUE;
    $sent = 0;
    foreach (array_slice(scandir($DUE) ?: [], 0, 500) as $code) {
        if ($sent >= $limit) break;
        if (!safe_name($code) || !is_file("$DUE/$code")) continue;
        if ((int) @file_get_contents("$DUE/$code") > time() * 1000) continue;
        $g = get_gift($code);
        if ($g && is_locked($g)) continue;
        $claim = "$DUE/$code." . bin2hex(random_bytes(4)) . '.claim';
        if (!@rename("$DUE/$code", $claim)) continue;
        @unlink($claim);
        if (!$g || !empty($g['notifiedAt'])) continue;
        notify_recipient($g, 'unlocked');
        $fresh = get_gift($code);
        if ($fresh) { $fresh['notifiedAt'] = now_iso(); put_gift($fresh); }
        $sent++;
    }
    return $sent;
}
/** At most once a minute, any request checks the schedule (in case no cron runs) */
function maybe_process_due(): void {
    global $DATA_DIR;
    $f = "$DATA_DIR/.due-check";
    if (is_file($f) && time() - (int) @filemtime($f) < 60) return;
    @touch($f);
    try { process_due(); } catch (Throwable $e) { error_log('Upozornění: ' . $e->getMessage()); }
}
function drop_gift_extras(string $code): void { set_due($code, null); delete_subs('g:' . $code); }

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
/** before/after: lists of files ({ id, size }) still referenced by a box */
function remove_orphan_files(string $owner, array $before, array $after): void {
    $keep = [];
    foreach ($after as $f) $keep[$f['id']] = true;
    $gone = array_filter($before, function ($f) use ($keep) { return !isset($keep[$f['id']]); });
    if (!$gone) return;
    // a duplicated box shares its PDFs and photo: only delete what no box of the workshop uses any more
    foreach (gifts_by_owner($owner) as $o) foreach (files_of($o) as $f) $keep[$f['id']] = true;
    $freed = 0;
    foreach ($before as $f) {
        if (!isset($keep[$f['id']])) { delete_file((string) $f['id']); $freed += (int) ($f['size'] ?? 0); }
    }
    if ($freed) adjust_usage($owner, -$freed);
}
/** The box photo: an image this workshop uploaded, a short caption and a frame */
function sanitize_photo($raw, ?array $prev, string $owner): ?array {
    if (!is_array($raw) || empty($raw['file']['id'])) return null;
    $fid = (string) $raw['file']['id'];
    $file = ($prev['file']['id'] ?? null) === $fid ? $prev['file'] : null;
    if (!$file) {
        $m = file_meta($fid);
        if (!$m || ($m['owner'] ?? null) !== $owner || !in_array(file_type($m), IMAGE_TYPES, true)) return null;
        $file = ['id' => $m['id'], 'name' => $m['name'], 'size' => $m['size'], 'type' => $m['type'], 'w' => $m['w'] ?? null, 'h' => $m['h'] ?? null];
    }
    return [
        'file' => $file,
        'caption' => trim((string) preg_replace('/\s+/u', ' ', s($raw['caption'] ?? '', 200))),
        'frame' => in_array($raw['frame'] ?? null, PHOTO_FRAMES, true) ? $raw['frame'] : 'polaroid',
    ];
}

/** The creator's voice or video message: a recording this workshop uploaded */
function sanitize_clip($raw, ?array $prev, string $owner): ?array {
    if (!is_array($raw) || empty($raw['file']['id'])) return null;
    $fid = (string) $raw['file']['id'];
    if (($prev['file']['id'] ?? null) === $fid) return $prev;
    $m = file_meta($fid);
    if (!$m || ($m['owner'] ?? null) !== $owner || !is_media($m)) return null;
    return [
        'file' => ['id' => $m['id'], 'name' => $m['name'], 'size' => $m['size'], 'type' => $m['type']],
        'kind' => strpos($m['type'], 'audio/') === 0 ? 'audio' : 'video',
        'duration' => media_seconds($m['duration'] ?? 0, CLIP_SECONDS),
    ];
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
    if (($seg[0] ?? '') !== 'cron') maybe_process_due();

    // CSRF guard: every state-changing call must come from our own pages (custom header)
    if ($method !== 'GET' && ($seg[0] ?? '') !== 'gifts' && ($_SERVER['HTTP_X_ADMIN'] ?? '') !== '1') {
        fail(403, 'forbidden', 'Chybí hlavička X-Admin.');
    }

    if (($seg[0] ?? '') === 'info' && count($seg) === 1 && $method === 'GET') {
        send_json(['mail' => $MAIL['enabled'], 'signupCode' => $SIGNUP_CODE !== '', 'push' => $PUSH['enabled'] ? $PUSH['public'] : null]);
    }
    /* the service worker asks what the last (empty) push was about */
    if (($seg[0] ?? '') === 'push' && ($seg[1] ?? '') === 'inbox' && $method === 'GET') {
        $ep = clean_endpoint($_GET['e'] ?? null);
        $msg = $ep ? read_json_file("$INBOX/" . hash('sha256', $ep) . '.json') : null;
        header('Cache-Control: no-store');
        send_json($msg ?: ['title' => 'Dárky', 'body' => 'Máš nové upozornění.', 'url' => '']);
    }
    /* cron: notify boxes that just unlocked (hosting cron / cron-job.org: …/api/cron?key=CRON_SECRET) */
    if (($seg[0] ?? '') === 'cron' && count($seg) === 1 && ($method === 'GET' || $method === 'POST')) {
        if ($CRON_SECRET !== '') {
            $auth = (string) ($_SERVER['HTTP_AUTHORIZATION'] ?? '');
            if (!hash_equals("Bearer $CRON_SECRET", $auth) && !hash_equals($CRON_SECRET, (string) ($_GET['key'] ?? ''))) fail(401, 'unauthorized', 'Špatný klíč pro cron.');
        }
        @touch("$DATA_DIR/.due-check");
        send_json(['ok' => true, 'sent' => process_due(100)]);
    }

    /* ----- public: recipients ----- */
    if (($seg[0] ?? '') === 'gifts') {
        $code = normalize_code($seg[1] ?? '');
        $g = $code ? get_gift($code) : null;
        if (!$g) fail(404, 'not_found', 'Dárek s tímto kódem neexistuje.');
        $isOwner = function () use ($g) { $w = current_workshop(); return $w && ($g['owner'] ?? null) === $w['id']; };

        if (count($seg) === 2 && $method === 'GET') {
            // ?poll=1: the waiting page checking for a ring – not a new visit
            $owner = (bool)$isOwner();
            if (!isset($_GET['poll']) && !$owner) track($g, 'view');
            send_json([
                'code' => $g['code'],
                'title' => $g['showTitle'] ? $g['title'] : null,
                'hasPassword' => !empty($g['passwordHash']),
                'appearance' => $g['appearance'],
                'theme' => $g['theme'],
                'locked' => is_locked($g),
                'openAt' => $g['anytime'] ? null : $g['openAt'],
                'ringAt' => $g['ringAt'] ?? null,
                'owner' => $owner,
                'askReaction' => $g['askReaction'] && !$g['reaction'] ? ['seconds' => REACTION_SECONDS, 'bytes' => $MAX_UPLOAD] : null,
                'serverNow' => now_iso(),
            ]);
        }
        if (count($seg) === 3 && $seg[2] === 'open' && $method === 'POST') {
            $b = body_json();
            $preview = ($b['preview'] ?? false) === true && $isOwner();
            if (($b['preview'] ?? false) === true && !$preview) fail(403, 'not_owner', 'Náhled může zobrazit jen autor dárku přihlášený ve své dílně.');
            if (!$preview) {
                $viaToken = is_string($b['token'] ?? null) && check_token($SECRET, gift_scope($g), $b['token']);
                if (!empty($g['passwordHash']) && !$viaToken && !verify_password(normalize_password($b['password'] ?? ''), $g['passwordHash'])) {
                    usleep(600000);
                    fail(401, 'bad_password', 'Tohle heslo dárek neotevře.');
                }
                if (is_locked($g)) fail(423, 'locked', 'Dárek ještě nejde rozbalit.', ['openAt' => $g['openAt'], 'serverNow' => now_iso()]);
            }
            if (!$preview && !$isOwner()) track($g, 'open');
            send_json(['gift' => public_gift($g), 'token' => $preview ? null : sign_token($SECRET, gift_scope($g), GIFT_TTL), 'preview' => $preview]);
        }
        if (count($seg) === 3 && $seg[2] === 'subscribe' && ($method === 'POST' || $method === 'DELETE')) {
            $ep = clean_endpoint(body_json()['endpoint'] ?? null);
            if (!$ep) fail(400, 'bad_endpoint', 'Tenhle prohlížeč upozornění neumí.');
            $h = hash('sha256', $ep);
            if ($method === 'DELETE') { remove_sub('g:' . $g['code'], $h); send_json(['ok' => true]); }
            if (!$PUSH['enabled']) fail(503, 'push_off', 'Upozornění tady nejsou zapnutá.');
            add_sub('g:' . $g['code'], $h, ['endpoint' => $ep, 'at' => now_iso()]);
            send_json(['ok' => true]);
        }
        if (count($seg) === 3 && $seg[2] === 'photo' && $method === 'GET') {
            if (!$isOwner()) {
                if (!check_token($SECRET, gift_scope($g), $_GET['t'] ?? null)) fail(401, 'bad_token', 'Platnost odkazu vypršela. Otevři dárek znovu.');
                if (is_locked($g)) fail(423, 'locked', 'Dárek ještě nejde rozbalit.');
            }
            $m = !empty($g['photo']['file']['id']) ? file_meta($g['photo']['file']['id']) : null;
            if (!$m) fail(404, 'not_found', 'Fotka nenalezena.');
            send_image($m);
        }
        if (count($seg) === 3 && $seg[2] === 'clip' && $method === 'GET') {
            if (!$isOwner()) {
                if (!check_token($SECRET, gift_scope($g), $_GET['t'] ?? null)) fail(401, 'bad_token', 'Platnost odkazu vypršela. Otevři dárek znovu.');
                if (is_locked($g)) fail(423, 'locked', 'Dárek ještě nejde rozbalit.');
            }
            send_media(!empty($g['clip']['file']['id']) ? file_meta($g['clip']['file']['id']) : null, 'Vzkaz');
        }
        // the recipient's unwrapping video: only when the creator asked for it, only from someone who unwrapped the box
        if (count($seg) === 3 && $seg[2] === 'reaction' && $method === 'POST') {
            if (!$g['askReaction']) fail(403, 'not_wanted', 'U tohohle dárku se reakce nenahrává.');
            if (!check_token($SECRET, gift_scope($g), $_SERVER['HTTP_X_GIFT_TOKEN'] ?? null)) fail(401, 'bad_token', 'Platnost odkazu vypršela. Otevři dárek znovu.');
            $mb = $MB($MAX_UPLOAD);
            if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > $MAX_UPLOAD) fail(413, 'too_large', "Nahrávka je větší než $mb MB.");
            $buf = (string) file_get_contents('php://input');
            if (strlen($buf) > $MAX_UPLOAD || $buf === '') fail(413, 'too_large', "Nahrávka je větší než $mb MB.");
            $type = media_type(sniff_type($buf), 'video');
            if (!$type || strpos($type, 'video/') !== 0) fail(415, 'bad_type', 'Tohle není video.');
            $owner = get_workshop($g['owner']);
            if (!$owner) fail(404, 'not_found', 'Dárek nenalezen.');
            $old = $g['reaction']['file'] ?? null;
            if ((int) ($owner['usedBytes'] ?? 0) - (int) ($old['size'] ?? 0) + strlen($buf) > $MAX_STORAGE) fail(413, 'quota', 'Dílna dárce už nemá na video místo.');
            $meta = ['id' => random_id(12), 'owner' => $g['owner'], 'name' => 'reakce', 'size' => strlen($buf), 'type' => $type, 'createdAt' => now_iso()];
            file_put_contents("$FILES/{$meta['id']}.pdf", $buf);
            write_atomic("$FILES/{$meta['id']}.json", json_encode($meta, JSON_UNESCAPED_UNICODE));
            $fresh = get_gift($g['code']) ?: $g;
            $fresh['reaction'] = [
                'file' => ['id' => $meta['id'], 'name' => $meta['name'], 'size' => $meta['size'], 'type' => $type],
                'at' => now_iso(), 'duration' => media_seconds($_SERVER['HTTP_X_MEDIA_DURATION'] ?? 0, REACTION_SECONDS),
            ];
            put_gift($fresh);
            if ($old) delete_file($old['id']);
            adjust_usage($g['owner'], strlen($buf) - (int) ($old['size'] ?? 0));
            push_all('w:' . $g['owner'], ['title' => 'Přišlo video z rozbalování 🎬', 'body' => 'Obdarovaný ti poslal, jak rozbaluje „' . ($g['title'] ?: 'Dárek') . '“.', 'url' => 'dilna', 'tag' => 'reaction-' . $g['code']]);
            send_json(['ok' => true], 201);
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
            if (array_key_exists('theme', $b)) $w['theme'] = theme_of($b['theme']);
            if (array_key_exists('notifyOpen', $b)) $w['notifyOpen'] = (bool) $b['notifyOpen'];
            $oldEmail = (string) ($w['email'] ?? '');
            $w['email'] = $email;
            $w['updatedAt'] = now_iso();
            put_workshop($w);
            index_email($w['id'], $oldEmail, $email);
            send_json(['workshop' => workshop_view($w)]);
        }
        if (($seg[1] ?? '') === 'subscribe' && ($method === 'POST' || $method === 'DELETE')) {
            $ep = clean_endpoint(body_json()['endpoint'] ?? null);
            if (!$ep) fail(400, 'bad_endpoint', 'Tenhle prohlížeč upozornění neumí.');
            $h = hash('sha256', $ep);
            if ($method === 'DELETE') { remove_sub('w:' . $w['id'], $h); send_json(['ok' => true]); }
            if (!$PUSH['enabled']) fail(503, 'push_off', 'Upozornění tady nejsou zapnutá.');
            add_sub('w:' . $w['id'], $h, ['endpoint' => $ep, 'at' => now_iso()]);
            send_json(['ok' => true]);
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
            foreach (gifts_by_owner($w['id']) as $g) { delete_gift($g['code']); drop_gift_extras($g['code']); }
            delete_subs('w:' . $w['id']);
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
                $type = sniff_type($buf);
                if ($type && (strpos($type, 'media/') === 0 || strpos($type, 'audio/') === 0)) $type = media_type($type, $_SERVER['HTTP_X_MEDIA_KIND'] ?? null);
                if (!$type) fail(415, 'bad_type', 'Nahrát jde PDF poukaz, fotka (JPEG, PNG, WebP) nebo zvuková či video zpráva.');
                $media = (bool) preg_match('#^(audio|video)/#', $type);
                if ((int) ($w['usedBytes'] ?? 0) + strlen($buf) > $MAX_STORAGE) {
                    fail(413, 'quota', 'Dílna má místo na ' . $MB($MAX_STORAGE) . ' MB souborů a je plná. Smaž nepotřebné poukazy nebo fotky.');
                }
                $fallback = $type === 'application/pdf' ? 'poukaz.pdf' : ($media ? 'vzkaz' : 'fotka');
                $name = rawurldecode((string) ($_SERVER['HTTP_X_FILE_NAME'] ?? $fallback));
                $name = mb_substr((string) preg_replace('#[\\\\/\r\n]#', '_', $name), 0, 120, 'UTF-8') ?: $fallback;
                $meta = ['id' => random_id(12), 'owner' => $w['id'], 'name' => $name, 'size' => strlen($buf), 'type' => $type, 'createdAt' => now_iso()];
                if ($media) $meta['duration'] = media_seconds($_SERVER['HTTP_X_MEDIA_DURATION'] ?? 0, CLIP_SECONDS);
                elseif ($type !== 'application/pdf') {
                    $dim = function ($v) { $n = (int) round((float) $v); return $n > 0 && $n < 20000 ? $n : null; };
                    $meta['w'] = $dim($_SERVER['HTTP_X_IMAGE_WIDTH'] ?? 0);
                    $meta['h'] = $dim($_SERVER['HTTP_X_IMAGE_HEIGHT'] ?? 0);
                }
                file_put_contents("$FILES/{$meta['id']}.pdf", $buf);
                write_atomic("$FILES/{$meta['id']}.json", json_encode($meta, JSON_UNESCAPED_UNICODE));
                adjust_usage($w['id'], strlen($buf));
                send_json(['id' => $meta['id'], 'name' => $meta['name'], 'size' => $meta['size'], 'type' => $type, 'w' => $meta['w'] ?? null, 'h' => $meta['h'] ?? null, 'duration' => $meta['duration'] ?? null], 201);
            }
            if (count($seg) === 3 && $method === 'GET') {
                $m = file_meta($seg[2]);
                if (!$m || ($m['owner'] ?? null) !== $w['id']) fail(404, 'not_found', 'Soubor nenalezen.');
                if (is_media($m)) send_media($m, 'Vzkaz');
                if (file_type($m) !== 'application/pdf') send_image($m);
                send_pdf($m['id'], $m['name'], false);
            }
        }

        if (($seg[1] ?? '') === 'gifts') {
            if (count($seg) === 2 && $method === 'GET') {
                $all = gifts_by_owner($w['id']);
                usort($all, function ($a, $b) { return strcmp((string) $b['updatedAt'], (string) $a['updatedAt']); });
                send_json(['gifts' => array_map(function ($g) { return summary($g) + ['stats' => get_stats($g['code'])]; }, $all), 'serverNow' => now_iso()]);
            }
            if (count($seg) === 2 && $method === 'POST') {
                if (count(gifts_by_owner($w['id'])) >= $MAX_GIFTS) fail(409, 'limit', "V jedné dílně může být nejvýš $MAX_GIFTS boxů.");
                $b = body_json();
                $now = now_iso();
                $g = [
                    'code' => unique_code(), 'owner' => $w['id'],
                    'title' => s($b['title'] ?? '', 120) ?: 'Nový dárek',
                    'showTitle' => true, 'message' => '', 'signature' => '',
                    'passwordHash' => null, 'anytime' => false,
                    'openAt' => (is_string($b['openAt'] ?? null) && strtotime($b['openAt']) !== false) ? gmdate('Y-m-d\TH:i:s.000\Z', strtotime($b['openAt'])) : default_open_at(),
                    'manualUnlock' => false,
                    'theme' => theme_of($b['theme'] ?? ($w['theme'] ?? null)),
                    'appearance' => sanitize_appearance($b['appearance'] ?? null),
                    'reveal' => in_array($b['reveal'] ?? null, REVEALS, true) ? $b['reveal'] : 'all',
                    'items' => [], 'photo' => null, 'createdAt' => $now, 'updatedAt' => $now,
                ];
                put_gift($g);
                sync_due(null, $g);
                send_json(admin_view($g), 201);
            }

            $code = normalize_code($seg[2] ?? '');
            $g = $code ? get_gift($code) : null;
            // someone else's box looks exactly like a missing one
            if (!$g || ($g['owner'] ?? null) !== $w['id']) fail(404, 'not_found', 'Box nenalezen.');

            if (count($seg) === 3 && $method === 'GET') send_json(admin_view($g) + ['stats' => get_stats($g['code'])]);

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
                        elseif (($m = file_meta((string) $fid)) && ($m['owner'] ?? null) === $w['id'] && file_type($m) === 'application/pdf') $file = ['id' => $m['id'], 'name' => $m['name'], 'size' => $m['size']];
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
                    'theme' => array_key_exists('theme', $b) ? theme_of($b['theme']) : $g['theme'],
                    'items' => $items,
                    'photo' => array_key_exists('photo', $b) ? sanitize_photo($b['photo'], $g['photo'], $w['id']) : $g['photo'],
                    'clip' => array_key_exists('clip', $b) ? sanitize_clip($b['clip'], $g['clip'], $w['id']) : $g['clip'],
                    'askReaction' => array_key_exists('askReaction', $b) ? !empty($b['askReaction']) : $g['askReaction'],
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
                if (array_key_exists('recipientEmail', $b)) {
                    $re = clean_email($b['recipientEmail']);
                    if ($re === null) fail(400, 'bad_email', 'E-mail obdarovaného nevypadá jako e-mailová adresa.');
                    $next['recipientEmail'] = $re;
                }
                // locked again (a new unlock time): the recipient should hear about it when that time comes
                $next['notifiedAt'] = is_locked($next) ? null : ($g['notifiedAt'] ?? null);
                put_gift($next);
                remove_orphan_files($w['id'], files_of($g), files_of($next));
                $next = sync_due($g, $next);
                send_json(admin_view($next) + ['stats' => get_stats($next['code'])]);
            }

            if (count($seg) === 4 && $seg[3] === 'ring' && $method === 'POST') {
                if (!empty($g['ringAt']) && time() - strtotime((string) $g['ringAt']) < $RING_GAP) fail(429, 'too_soon', 'Zvonilo se před chvílí. Zkus to zase za minutu.');
                $ringAt = now_iso();
                put_gift(array_merge($g, ['ringAt' => $ringAt]));
                send_json(['ok' => true, 'ringAt' => $ringAt] + notify_recipient($g, 'ring'));
            }
            if (count($seg) === 3 && $method === 'DELETE') {
                delete_gift($g['code']);
                drop_gift_extras($g['code']);
                remove_orphan_files($w['id'], files_of($g), []);
                send_json(['ok' => true]);
            }

            // a copy of the saved box under a new code (shares the files; stats, schedule and recipient start fresh)
            if (count($seg) === 4 && $seg[3] === 'reaction' && $method === 'GET') {
                send_media(!empty($g['reaction']['file']['id']) ? file_meta($g['reaction']['file']['id']) : null, 'Video');
            }
            if (count($seg) === 4 && $seg[3] === 'reaction' && $method === 'DELETE') {
                if (!empty($g['reaction']['file'])) {
                    $old = $g['reaction']['file'];
                    $g['reaction'] = null;
                    put_gift($g);
                    delete_file($old['id']);
                    adjust_usage($w['id'], -(int) ($old['size'] ?? 0));
                }
                send_json(admin_view($g) + ['stats' => get_stats($g['code'])]);
            }
            if (count($seg) === 4 && $seg[3] === 'duplicate' && $method === 'POST') {
                if (count(gifts_by_owner($w['id'])) >= $MAX_GIFTS) fail(409, 'limit', "V jedné dílně může být nejvýš $MAX_GIFTS boxů.");
                $now = now_iso();
                $copy = array_merge($g, [
                    'code' => unique_code(),
                    'title' => mb_substr($g['title'] . ' (kopie)', 0, 120, 'UTF-8'),
                    'recipientEmail' => '', 'notifiedAt' => null, 'ringAt' => null, 'reaction' => null,
                    'createdAt' => $now, 'updatedAt' => $now,
                ]);
                put_gift($copy);
                $saved = sync_due(null, $copy);
                send_json(admin_view($saved) + ['stats' => get_stats($saved['code'])], 201);
            }

            if (count($seg) === 4 && $seg[3] === 'regenerate-code' && $method === 'POST') {
                $next = array_merge($g, ['code' => unique_code(), 'updatedAt' => now_iso()]);
                delete_gift($g['code']);
                drop_gift_extras($g['code']);
                put_gift($next);
                sync_due(null, $next);
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
