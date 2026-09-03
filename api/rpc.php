<?php
/**
 * rpc.php — same-origin JSON-RPC relay for Robinhood Chain.
 *
 * Why this exists: the browser calls the public chain RPC directly, which only
 * works if that endpoint sends CORS headers. Plenty do not, and when they do
 * not every call fails silently — which looks exactly like "the live buys are
 * missing". Relaying through this file makes the request same-origin, so the
 * browser never has to ask permission.
 *
 * The site tries the RPC directly first and only falls back to here, so this
 * costs nothing when CORS is already open.
 *
 * READ ONLY. Only the handful of methods the site actually needs are allowed
 * through; anything that could move funds or reveal keys is refused, so
 * exposing this file is not a way to do anything you could not already do by
 * calling the public RPC yourself.
 */

declare(strict_types=1);

require_once __DIR__ . '/chain.php';

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

const TIMEOUT   = 20;
const MAX_BODY  = 32768;      // bytes accepted from the browser
const RATE_MAX  = 240;        // calls…
const RATE_WIN  = 60;         // …per this many seconds, per IP

/** Read-only methods the site uses. Nothing else is relayed. */
const ALLOWED = [
    'eth_blockNumber',
    'eth_chainId',
    'eth_call',
    'eth_getBalance',
    'eth_getLogs',
    'eth_getTransactionReceipt',
    'eth_getBlockByNumber',
];

function out(int $code, array $obj): void {
    http_response_code($code);
    echo json_encode($obj);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    out(405, ['error' => ['code' => -32600, 'message' => 'POST only']]);
}

$raw = file_get_contents('php://input', false, null, 0, MAX_BODY + 1);
if ($raw === false || strlen($raw) > MAX_BODY) {
    out(413, ['error' => ['code' => -32600, 'message' => 'Request too large']]);
}

$req = json_decode((string)$raw, true);
if (!is_array($req)) {
    out(400, ['error' => ['code' => -32700, 'message' => 'Parse error']]);
}

// Accept a single call or a batch, and vet every method in it.
$calls = isset($req['method']) ? [$req] : $req;
if (!is_array($calls) || !$calls || count($calls) > 20) {
    out(400, ['error' => ['code' => -32600, 'message' => 'Bad request']]);
}
foreach ($calls as $c) {
    $m = is_array($c) ? ($c['method'] ?? '') : '';
    if (!in_array($m, ALLOWED, true)) {
        out(403, ['error' => ['code' => -32601, 'message' => 'Method not relayed: ' . $m]]);
    }
}

// Light rate limit: this is a public endpoint on someone else's hosting.
$ip = $_SERVER['HTTP_CF_CONNECTING_IP'] ?? $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
$bucket = sys_get_temp_dir() . '/robin_rpc_' . sha1($ip) . '.json';
$now = time();
$hits = [];
if (is_readable($bucket)) {
    $j = json_decode((string)@file_get_contents($bucket), true);
    if (is_array($j)) $hits = $j;
}
$hits = array_values(array_filter($hits, fn($t) => is_int($t) && $t > $now - RATE_WIN));
if (count($hits) >= RATE_MAX) {
    out(429, ['error' => ['code' => -32005, 'message' => 'Too many requests']]);
}
$hits[] = $now;
@file_put_contents($bucket, json_encode($hits), LOCK_EX);

$ch = curl_init(ROBIN_RPC);
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => TIMEOUT,
    CURLOPT_CONNECTTIMEOUT => 8,
    CURLOPT_POSTFIELDS => $raw,
    CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
]);
$res  = curl_exec($ch);
$code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err  = curl_error($ch);
curl_close($ch);

if ($res === false) {
    out(502, ['error' => ['code' => -32603, 'message' => 'Chain RPC unreachable: ' . $err]]);
}
http_response_code($code ?: 200);
echo $res;
