<?php
// Router for PHP's built-in server (local testing only):  php -S localhost:8000 router.php
// On Apache the same rules live in .htaccess.
$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (preg_match('#^/api/(.*)$#', $uri, $m)) { $_GET['path'] = $m[1]; require __DIR__ . '/api.php'; return true; }
if (preg_match('#^/(data|config(\.sample)?\.php)#', $uri)) { http_response_code(403); return true; }
if (preg_match('#^/(admin|dilna)/?$#', $uri)) { readfile(__DIR__ . '/admin.html'); return true; }
if ($uri !== '/' && is_file(__DIR__ . $uri)) return false;
header('Content-Type: text/html; charset=utf-8');
readfile(__DIR__ . '/index.html');
return true;
