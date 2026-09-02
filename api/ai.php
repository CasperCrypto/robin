<?php
/**
 * ai.php — server-side OpenRouter proxy for the $ROBIN site.
 *
 * The browser never sees your API key. It POSTs a mode + a short message here,
 * this file adds the system prompt and live market context, calls OpenRouter,
 * and returns plain JSON.
 *
 * SETUP — pick one:
 *   1. Set an environment variable:  OPENROUTER_API_KEY=sk-or-...
 *   2. Or create api/config.php next to this file:
 *        <?php return ['OPENROUTER_API_KEY' => 'sk-or-...'];
 *      (api/config.php is git-ignored — never commit your key.)
 *
 * Requires PHP 7.4+ with cURL.
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
header('Cache-Control: no-store');

// ── config ────────────────────────────────────────────────────────────────
const MODEL_DEFAULT = 'anthropic/claude-sonnet-4.5';
const MAX_INPUT     = 1200;    // characters accepted from the browser
const MAX_TURNS     = 12;      // conversation turns kept
const RATE_MAX      = 25;      // requests…
const RATE_WINDOW   = 300;     // …per this many seconds, per IP
const TIMEOUT       = 45;

const TOKEN_NAME    = 'Robin Nakamoto ($ROBIN)';
const TOKEN_ADDR    = '0x280413fbF06CcC1114094A5967dB2191d49EE75e';
const CHAIN_NAME    = 'Robinhood Chain';
const CHAIN_ID      = 4663;
const CHAIN_RPC     = 'https://rpc.mainnet.chain.robinhood.com';
const DS_CHAIN      = 'robinhood';
const DS_POOL       = '0x7d8a56584434d8355b891da0ff62d9168669f87dd9c8ad77f6c8fb0a6b6eb7d7';

function fail(int $code, string $msg): void {
    http_response_code($code);
    echo json_encode(['error' => $msg]);
    exit;
}

function apiKey(): string {
    $k = getenv('OPENROUTER_API_KEY') ?: ($_SERVER['OPENROUTER_API_KEY'] ?? '');
    if (!$k && is_readable(__DIR__ . '/config.php')) {
        $cfg = require __DIR__ . '/config.php';
        $k = is_array($cfg) ? ($cfg['OPENROUTER_API_KEY'] ?? '') : '';
    }
    return trim((string)$k);
}

// ── method + rate limit ───────────────────────────────────────────────────
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') fail(405, 'POST only');

$ip  = $_SERVER['HTTP_CF_CONNECTING_IP'] ?? $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
$bucket = sys_get_temp_dir() . '/robin_ai_' . sha1($ip) . '.json';
$now = time();
$hits = [];
if (is_readable($bucket)) {
    $raw = json_decode((string)@file_get_contents($bucket), true);
    if (is_array($raw)) $hits = $raw;
}
$hits = array_values(array_filter($hits, fn($t) => is_int($t) && $t > $now - RATE_WINDOW));
if (count($hits) >= RATE_MAX) fail(429, 'Slow down a moment — too many requests.');
$hits[] = $now;
@file_put_contents($bucket, json_encode($hits), LOCK_EX);

// ── input ─────────────────────────────────────────────────────────────────
$body = json_decode((string)file_get_contents('php://input'), true);
if (!is_array($body)) fail(400, 'Bad request body');

$mode = (string)($body['mode'] ?? 'chat');
if (!in_array($mode, ['chat', 'alpha', 'meme'], true)) fail(400, 'Unknown mode');

$key = apiKey();
if ($key === '') fail(503, 'Robin AI is not configured yet — set OPENROUTER_API_KEY on the server.');

/** Trim and cap anything that came from the browser. */
function clean($s): string {
    return mb_substr(trim((string)$s), 0, MAX_INPUT);
}

$messages = [];
if ($mode === 'chat') {
    $hist = is_array($body['messages'] ?? null) ? $body['messages'] : [];
    $hist = array_slice($hist, -MAX_TURNS);
    foreach ($hist as $m) {
        $role = ($m['role'] ?? '') === 'assistant' ? 'assistant' : 'user';
        $txt  = clean($m['content'] ?? '');
        if ($txt !== '') $messages[] = ['role' => $role, 'content' => $txt];
    }
    if (!$messages) fail(400, 'Nothing to answer');
} else {
    $messages[] = ['role' => 'user', 'content' => clean($body['prompt'] ?? '') ?: 'Go.'];
}

// ── live market context (server-side, so the client can't spoof it) ───────
function marketContext(): string {
    $cache = sys_get_temp_dir() . '/robin_mkt.json';
    $data = null;
    if (is_readable($cache) && filemtime($cache) > time() - 30) {
        $data = json_decode((string)@file_get_contents($cache), true);
    }
    if (!$data) {
        $url = 'https://api.dexscreener.com/latest/dex/pairs/' . DS_CHAIN . '/' . DS_POOL;
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 8,
            CURLOPT_HTTPHEADER => ['Accept: application/json'],
        ]);
        $res = curl_exec($ch);
        curl_close($ch);
        $j = json_decode((string)$res, true);
        $p = $j['pairs'][0] ?? $j['pair'] ?? null;
        if (is_array($p)) {
            $data = [
                'price'  => $p['priceUsd'] ?? null,
                'change' => $p['priceChange']['h24'] ?? null,
                'vol24'  => $p['volume']['h24'] ?? null,
                'liq'    => $p['liquidity']['usd'] ?? null,
                'mcap'   => $p['marketCap'] ?? ($p['fdv'] ?? null),
                'txns'   => $p['txns']['h24'] ?? null,
            ];
            @file_put_contents($cache, json_encode($data), LOCK_EX);
        }
    }
    if (!$data) return "Live market data is unavailable right now.";

    $buys  = $data['txns']['buys']  ?? null;
    $sells = $data['txns']['sells'] ?? null;
    return "LIVE MARKET DATA (updated seconds ago):\n"
        . "- Price: $" . ($data['price'] ?? 'unknown') . "\n"
        . "- 24h change: " . ($data['change'] ?? 'unknown') . "%\n"
        . "- Market cap: $" . ($data['mcap'] ?? 'unknown') . "\n"
        . "- 24h volume: $" . ($data['vol24'] ?? 'unknown') . "\n"
        . "- Liquidity: $" . ($data['liq'] ?? 'unknown') . "\n"
        . "- 24h buys/sells: " . ($buys ?? '?') . " / " . ($sells ?? '?');
}

$facts = "You are Robin — the assistant on the official " . TOKEN_NAME . " website.\n\n"
    . "FACTS YOU KNOW:\n"
    . "- " . TOKEN_NAME . " is a memecoin native to " . CHAIN_NAME . " (EVM chain ID " . CHAIN_ID . ", gas paid in ETH).\n"
    . "- Contract address: " . TOKEN_ADDR . ". This is the only correct address.\n"
    . "- RPC: " . CHAIN_RPC . "\n"
    . "- It launched on the Pons launchpad, graduated off the bonding curve, and now trades in a\n"
    . "  permanently locked Uniswap V4 pool governed by the Pons shared hook.\n"
    . "- Fixed supply of 1,000,000,000. No mint function, no team unlocks.\n"
    . "- 30% of supply was gifted to Billy Markus (Shibetoshi Nakamoto), co-creator of Dogecoin.\n"
    . "- The site is built by the Shopping.io team.\n"
    . "- To buy: bridge ETH to Robinhood Chain, connect a wallet, swap on this page or any\n"
    . "  Uniswap front-end on chain " . CHAIN_ID . ".\n\n"
    . marketContext() . "\n\n"
    . "RULES:\n"
    . "- Never give financial advice, price predictions or targets. If asked whether to buy or\n"
    . "  where price is going, say plainly that you won't predict prices, and explain what the\n"
    . "  data actually shows instead.\n"
    . "- Be honest when the numbers look weak. Never hype past what the data supports.\n"
    . "- Remind people this is a memecoin that can go to zero when the topic is risk or buying.\n"
    . "- Never ask for seed phrases, private keys or wallet approvals. You cannot transact.\n"
    . "- If you don't know something, say so.\n";

$system = match ($mode) {
    'alpha' => $facts . "\nTASK: Write a short market report on $ROBIN from the live data above.\n"
        . "Cover: what the price action and volume actually show, how liquidity looks relative to\n"
        . "market cap, and the buy/sell balance. 130-180 words. Confident and readable, not hype.\n"
        . "Say clearly if the data shows a quiet or weak market. End with one line reminding the\n"
        . "reader this is not financial advice. Use short paragraphs, no headings.",

    'meme' => $facts . "\nTASK: Write exactly 3 posts for X promoting $ROBIN, based on the angle the\n"
        . "user gives. Each under 240 characters, each a different flavour (funny, punchy, community).\n"
        . "Use $ROBIN and at most 2 hashtags. No price predictions, no 'guaranteed' or 'to the moon'\n"
        . "financial claims. Separate the three posts with a line containing only ---\n"
        . "Output nothing but the posts and the separators.",

    default => $facts . "\nTASK: Answer the user's question about $ROBIN, Robinhood Chain, or how to\n"
        . "trade it. Be brief and concrete — usually under 110 words. Plain language. You may use\n"
        . "**bold** and simple bullet lists.",
};

// ── call openrouter ───────────────────────────────────────────────────────
$model = (string)($body['model'] ?? '') ?: MODEL_DEFAULT;
$origin = ($_SERVER['HTTPS'] ?? '') === 'on' ? 'https://' : 'http://';
$origin .= $_SERVER['HTTP_HOST'] ?? 'shopping.io';

$payload = [
    'model' => $model,
    'messages' => array_merge([['role' => 'system', 'content' => $system]], $messages),
    'max_tokens' => $mode === 'chat' ? 500 : 700,
    'temperature' => $mode === 'meme' ? 0.95 : 0.6,
];

$ch = curl_init('https://openrouter.ai/api/v1/chat/completions');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => TIMEOUT,
    CURLOPT_POSTFIELDS => json_encode($payload),
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        'Authorization: Bearer ' . $key,
        'HTTP-Referer: ' . $origin,
        'X-Title: ROBIN Nakamoto',
    ],
]);
$res  = curl_exec($ch);
$code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err  = curl_error($ch);
curl_close($ch);

if ($res === false)  fail(502, 'Upstream request failed: ' . $err);
$j = json_decode((string)$res, true);

if ($code !== 200) {
    // Surface a useful message without ever echoing the key or raw upstream body.
    $m = $j['error']['message'] ?? 'Upstream error';
    error_log('[robin-ai] OpenRouter ' . $code . ': ' . $m);
    fail(502, $code === 401 ? 'Robin AI key was rejected — check OPENROUTER_API_KEY.'
                            : 'Robin AI is busy right now. Try again in a moment.');
}

$text = $j['choices'][0]['message']['content'] ?? '';
if ($text === '') fail(502, 'Empty response from the model');

echo json_encode(['text' => $text, 'model' => $j['model'] ?? $model], JSON_UNESCAPED_SLASHES);
