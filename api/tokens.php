<?php
/**
 * tokens.php — every tradable token on Robinhood Chain, with a live price.
 *
 * The swap panel only ever knew about one token. This is what lets it know
 * about all of them, which is the difference between a buy button and an
 * exchange.
 *
 * Two sources, because neither one is enough on its own:
 *   - The explorer knows every token that exists, but nothing about price.
 *   - DexScreener knows price and liquidity, but only for what is trading.
 * The explorer supplies the universe, DexScreener supplies the numbers, and a
 * token with no pair is dropped: it cannot be swapped, so listing it would only
 * offer people a trade that cannot happen.
 *
 * Prices are fetched in batches rather than one request per token — a hundred
 * tokens one at a time is a hundred round trips and a page nobody waits for.
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: public, max-age=60');

require_once __DIR__ . '/chain.php';
require_once __DIR__ . '/lib.php';

const CACHE_TTL  = 300;     // a list this size does not change minute to minute
const MAX_TOKENS = 120;     // how far down the explorer's list to go
const BATCH      = 25;      // addresses per DexScreener request
const MIN_LIQ    = 100;     // below this a "market" is not really a market

$cacheFile = sys_get_temp_dir() . '/robin_tokens.json';
if (empty($_GET['fresh']) && is_readable($cacheFile) && filemtime($cacheFile) > time() - CACHE_TTL) {
    echo (string)file_get_contents($cacheFile);
    exit;
}

/* ── the universe ───────────────────────────────────────────────────────── */
$listing = getJson(ROBIN_EXPLORER . '/tokens?type=ERC-20', 12, $listStatus);
$items = $listing['items'] ?? [];

$meta = [];
foreach (array_slice($items, 0, MAX_TOKENS) as $t) {
    $addr = strtolower((string)($t['address'] ?? $t['address_hash'] ?? ''));
    if (!preg_match('/^0x[0-9a-f]{40}$/', $addr)) continue;
    $meta[$addr] = [
        'address'  => $addr,
        'name'     => $t['name'] ?? null,
        'symbol'   => $t['symbol'] ?? null,
        'decimals' => isset($t['decimals']) ? (int)$t['decimals'] : 18,
        'holders'  => isset($t['holders']) ? (int)$t['holders'] : null,
    ];
}

/* ── the numbers ────────────────────────────────────────────────────────── */
$reachedDs = false;
foreach (array_chunk(array_keys($meta), BATCH) as $chunk) {
    $j = getJson(ROBIN_DEX . '/tokens/' . implode(',', $chunk), 12, $dsStatus);
    if ($j === null) continue;
    $reachedDs = true;

    // Several pairs can quote the same token; the deepest one is the market.
    foreach (($j['pairs'] ?? []) as $p) {
        foreach ([$p['baseToken'] ?? null, $p['quoteToken'] ?? null] as $side) {
            $a = strtolower((string)($side['address'] ?? ''));
            if (!isset($meta[$a])) continue;
            $liq = (float)($p['liquidity']['usd'] ?? 0);
            if (isset($meta[$a]['liquidity']) && $meta[$a]['liquidity'] >= $liq) continue;

            $isBase = strtolower((string)($p['baseToken']['address'] ?? '')) === $a;
            $meta[$a]['liquidity'] = $liq;
            $meta[$a]['volume24h'] = (float)($p['volume']['h24'] ?? 0);
            $meta[$a]['change24h'] = isset($p['priceChange']['h24']) ? (float)$p['priceChange']['h24'] : null;
            $meta[$a]['mcap']      = isset($p['marketCap']) ? (float)$p['marketCap'] : null;
            $meta[$a]['pair']      = $p['pairAddress'] ?? null;
            // The rate against ETH, which is what a swap panel actually needs:
            // priceNative is quoted in the pair's other token.
            $native = isset($p['priceNative']) ? (float)$p['priceNative'] : null;
            $meta[$a]['priceNative'] = $native ? ($isBase ? $native : 1 / $native) : null;

            // priceUsd is quoted for the base token only.
            $meta[$a]['priceUsd']  = $isBase ? (float)($p['priceUsd'] ?? 0) : null;
            if (!$isBase && !empty($p['priceUsd']) && !empty($p['priceNative'])) {
                $native = (float)$p['priceNative'];
                if ($native > 0) $meta[$a]['priceUsd'] = (float)$p['priceUsd'] / $native;
            }
            if (empty($meta[$a]['symbol'])) $meta[$a]['symbol'] = $side['symbol'] ?? null;
            if (empty($meta[$a]['name']))   $meta[$a]['name']   = $side['name'] ?? null;
        }
    }
}

/* A token nobody can trade is not a listing. */
$tokens = array_values(array_filter($meta, fn($t) => ($t['liquidity'] ?? 0) >= MIN_LIQ));
usort($tokens, fn($a, $b) => ($b['liquidity'] ?? 0) <=> ($a['liquidity'] ?? 0));

$out = [
    'tokens'    => $tokens,
    'count'     => count($tokens),
    'reached'   => ['explorer' => $listing !== null, 'dexscreener' => $reachedDs],
    'updatedAt' => time(),
];

/* Never cache a list we could not actually build — an empty answer would then
   be served for five minutes after the outage that caused it had passed. */
if ($tokens) @file_put_contents($cacheFile, json_encode($out, JSON_UNESCAPED_SLASHES), LOCK_EX);

echo json_encode($out, JSON_UNESCAPED_SLASHES);
