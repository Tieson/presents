<?php
/**
 * Vánoční dárky – PHP backend (PHP 7.4+). Same API as the Node version, see API.md.
 * Data: JSON files in DATA_DIR (gifts/<code>.json, files/<id>.pdf + <id>.json).
 */
declare(strict_types=1);

$config = [];
if (is_file(__DIR__ . '/config.php')) $config = require __DIR__ . '/config.php';
function cfg(array $c, string $k, $default = null) {
    $env = getenv($k);
    if ($env !== false && $env !== '') return $env;
    return $c[$k] ?? $default;
}
$ADMIN_PASSWORD = (string) cfg($config, 'ADMIN_PASSWORD', '');
$DATA_DIR = rtrim((string) cfg($config, 'DATA_DIR', __DIR__ . '/data'), '/');
$MAX_UPLOAD = (int) cfg($config, 'MAX_UPLOAD_MB', 15) * 1024 * 1024;
$SECRET = (string) cfg($config, 'APP_SECRET', '');

const ADMIN_COOKIE = 'xd_admin';
const ADMIN_TTL = 1209600;   // 14 days
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

/* ---------- storage (JSON files) ---------- */

$GIFTS = $DATA_DIR . '/gifts';
$FILES = $DATA_DIR . '/files';
foreach ([$GIFTS, $FILES] as $d) if (!is_dir($d)) @mkdir($d, 0775, true);
if (!is_file($DATA_DIR . '/.htaccess')) @file_put_contents($DATA_DIR . '/.htaccess', "Require all denied\nDeny from all\n");

function safe_name(string $s): bool { return (bool) preg_match('/^[\w-]+$/', $s); }
function write_atomic(string $file, string $data): void {
    $tmp = $file . '.' . getmypid() . '.tmp';
    if (file_put_contents($tmp, $data, LOCK_EX) === false) throw new RuntimeException('write failed');
    rename($tmp, $file);
}
function read_json_file(string $file): ?array {
    if (!is_file($file)) return null;
    $d = json_decode((string) file_get_contents($file), true);
    return is_array($d) ? $d : null;
}
function get_gift(string $code): ?array { global $GIFTS; return safe_name($code) ? with_defaults(read_json_file("$GIFTS/$code.json")) : null; }
function put_gift(array $g): void {
    global $GIFTS;
    write_atomic("$GIFTS/{$g['code']}.json", json_encode($g, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
}
function delete_gift(string $code): void { global $GIFTS; if (safe_name($code)) @unlink("$GIFTS/$code.json"); }
function list_gifts(): array {
    global $GIFTS;
    $out = [];
    foreach (glob("$GIFTS/*.json") ?: [] as $f) { $g = with_defaults(read_json_file($f)); if ($g) $out[] = $g; }
    return $out;
}
function file_meta(string $id): ?array { global $FILES; return safe_name($id) ? read_json_file("$FILES/$id.json") : null; }
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

/* ---------- request ---------- */

if ($ADMIN_PASSWORD === '') fail(500, 'not_configured', 'Chybí ADMIN_PASSWORD v config.php.');
if ($SECRET === '') $SECRET = hmac('xd-derived-secret', $ADMIN_PASSWORD);

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$path = (string) ($_GET['path'] ?? '');
if ($path === '' && !empty($_SERVER['PATH_INFO'])) $path = ltrim((string) $_SERVER['PATH_INFO'], '/');
$seg = array_values(array_filter(explode('/', $path), 'strlen'));
$seg = array_map('rawurldecode', $seg);

function is_admin(): bool {
    global $SECRET;
    return check_token($SECRET, 'admin', $_COOKIE[ADMIN_COOKIE] ?? null);
}
function set_admin_cookie(string $value, int $maxAge): void {
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    setcookie(ADMIN_COOKIE, $value, [
        'expires' => $maxAge > 0 ? time() + $maxAge : time() - 3600,
        'path' => '/', 'httponly' => true, 'samesite' => 'Lax', 'secure' => $secure,
    ]);
}
function unique_code(): string {
    for ($i = 0; $i < 20; $i++) { $c = generate_code(); if (!get_gift($c)) return $c; }
    throw new RuntimeException('code');
}

try {
    /* ----- public ----- */
    if (($seg[0] ?? '') === 'gifts') {
        $code = normalize_code($seg[1] ?? '');
        $g = $code ? get_gift($code) : null;
        if (!$g) fail(404, 'not_found', 'Dárek s tímto kódem neexistuje.');

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
            $preview = ($b['preview'] ?? false) === true && is_admin();
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
            if (!is_admin()) {
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

    /* ----- admin ----- */
    if (($seg[0] ?? '') === 'admin') {
        if (($seg[1] ?? '') === 'login' && $method === 'POST') {
            $b = body_json();
            if (!hash_equals($ADMIN_PASSWORD, (string) ($b['password'] ?? ''))) { usleep(800000); fail(401, 'bad_password', 'Nesprávné heslo do dílny.'); }
            set_admin_cookie(sign_token($SECRET, 'admin', ADMIN_TTL), ADMIN_TTL);
            send_json(['ok' => true]);
        }
        if (($seg[1] ?? '') === 'logout' && $method === 'POST') { set_admin_cookie('', 0); send_json(['ok' => true]); }

        if (!is_admin()) fail(401, 'unauthorized', 'Přihlas se do dílny.');
        if ($method !== 'GET' && ($_SERVER['HTTP_X_ADMIN'] ?? '') !== '1') fail(403, 'forbidden', 'Chybí hlavička X-Admin.');

        if (($seg[1] ?? '') === 'me' && $method === 'GET') send_json(['ok' => true]);

        if (($seg[1] ?? '') === 'files') {
            if (count($seg) === 2 && $method === 'POST') {
                $mb = (int) round($MAX_UPLOAD / 1048576);
                if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > $MAX_UPLOAD) fail(413, 'too_large', "Soubor je větší než $mb MB.");
                $buf = (string) file_get_contents('php://input');
                if (strlen($buf) > $MAX_UPLOAD) fail(413, 'too_large', "Soubor je větší než $mb MB.");
                if ($buf === '') fail(413, 'too_large', "Soubor se nepodařilo přijmout. Zkontroluj post_max_size v PHP (limit aplikace je $mb MB).");
                if (substr($buf, 0, 5) !== '%PDF-') fail(415, 'not_pdf', 'Nahrát jde jen PDF soubor.');
                $name = rawurldecode((string) ($_SERVER['HTTP_X_FILE_NAME'] ?? 'poukaz.pdf'));
                $name = mb_substr(preg_replace('/[\\\\\/\r\n]/', '_', $name), 0, 120, 'UTF-8') ?: 'poukaz.pdf';
                $meta = ['id' => random_id(12), 'name' => $name, 'size' => strlen($buf), 'createdAt' => now_iso()];
                file_put_contents("$FILES/{$meta['id']}.pdf", $buf);
                write_atomic("$FILES/{$meta['id']}.json", json_encode($meta, JSON_UNESCAPED_UNICODE));
                send_json(['id' => $meta['id'], 'name' => $meta['name'], 'size' => $meta['size']], 201);
            }
            if (count($seg) === 3 && $method === 'GET') {
                $m = file_meta($seg[2]);
                if (!$m) fail(404, 'not_found', 'Soubor nenalezen.');
                send_pdf($m['id'], $m['name'], false);
            }
        }

        if (($seg[1] ?? '') === 'gifts') {
            if (count($seg) === 2 && $method === 'GET') {
                $all = list_gifts();
                usort($all, function ($a, $b) { return strcmp((string) $b['updatedAt'], (string) $a['updatedAt']); });
                send_json(['gifts' => array_map('summary', $all), 'serverNow' => now_iso()]);
            }
            if (count($seg) === 2 && $method === 'POST') {
                $b = body_json();
                $now = now_iso();
                $g = [
                    'code' => unique_code(),
                    'title' => s($b['title'] ?? '', 120) ?: 'Nový dárek',
                    'showTitle' => true, 'message' => '', 'signature' => '',
                    'passwordHash' => null, 'anytime' => false, 'openAt' => default_open_at(),
                    'manualUnlock' => false, 'items' => [],
                    'appearance' => sanitize_appearance($b['appearance'] ?? null),
                    'reveal' => in_array($b['reveal'] ?? null, REVEALS, true) ? $b['reveal'] : 'all', 'createdAt' => $now, 'updatedAt' => $now,
                ];
                put_gift($g);
                send_json(admin_view($g), 201);
            }

            $code = normalize_code($seg[2] ?? '');
            $g = $code ? get_gift($code) : null;
            if (!$g) fail(404, 'not_found', 'Box nenalezen.');

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
                        elseif ($m = file_meta((string) $fid)) $file = ['id' => $m['id'], 'name' => $m['name'], 'size' => $m['size']];
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
                $keep = [];
                foreach ($items as $i) if ($i['file']) $keep[$i['file']['id']] = true;
                foreach ($prevFiles as $fid => $_) if (!isset($keep[$fid])) delete_file((string) $fid);
                send_json(admin_view($next));
            }

            if (count($seg) === 3 && $method === 'DELETE') {
                delete_gift($g['code']);
                foreach ($g['items'] as $i) if (!empty($i['file'])) delete_file($i['file']['id']);
                send_json(['ok' => true]);
            }

            if (count($seg) === 4 && $seg[3] === 'regenerate-code' && $method === 'POST') {
                $next = array_merge($g, ['code' => unique_code(), 'updatedAt' => now_iso()]);
                put_gift($next);
                delete_gift($g['code']);
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
