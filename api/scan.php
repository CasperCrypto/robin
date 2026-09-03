<?php
/**
 * scan.php — risk report for any token on Robinhood Chain.
 *
 * The important design decision: **the checks are computed, not asked of the
 * model.** Holder concentration, liquidity depth, whether the contract is
 * verified, whether it can still be minted — all of that is arithmetic over
 * chain and explorer data, done here. The model is given those findings and
 * asked only to explain them in plain English.
 *
 * That ordering matters. A model asked "is this a rug?" will happily invent a
 * confident answer. A model handed "top 10 wallets hold 71%" and asked to
 * explain it cannot invent the 71%.
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

/* provider.php carries the key, the endpoint discovery and the one text call.
   It only runs its self-test when asked for one over HTTP, so requiring it
   here just brings the functions along. */
require_once __DIR__ . '/provider.php';
require_once __DIR__ . '/lib.php';

define('EXPLORER_API', getenv('SCAN_EXPLORER') ?: 'https://robinhoodchain.blockscout.com/api/v2');
define('DS_API',       getenv('SCAN_DS')       ?: 'https://api.dexscreener.com/latest/dex');
const CHAIN_RPC    = 'https://rpc.mainnet.chain.robinhood.com';

const SCAN_RATE_MAX = 20;
const SCAN_RATE_WIN = 600;
const CACHE_TTL     = 300;      // a token's report is good for five minutes

/* ── input ─────────────────────────────────────────────────────────────── */
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    jfail(405, 'POST only');
}

$body = json_decode((string)file_get_contents('php://input'), true);
$addr = is_array($body) ? trim((string)($body['address'] ?? '')) : '';

if (!preg_match('/^0x[0-9a-fA-F]{40}$/', $addr)) {
    jfail(400, 'That is not a token address. It should look like 0x followed by 40 characters.');
}
$addr = strtolower($addr);

if (rateLimited('scan', SCAN_RATE_MAX, SCAN_RATE_WIN)) {
    jfail(429, 'That is a lot of scanning. Give it a couple of minutes.');
}

/* ── cache ─────────────────────────────────────────────────────────────── */
$cacheFile = sys_get_temp_dir() . '/robin_scan_' . $addr . '.json';
if (is_readable($cacheFile) && filemtime($cacheFile) > time() - CACHE_TTL) {
    echo (string)file_get_contents($cacheFile);
    exit;
}

/* ── gather ────────────────────────────────────────────────────────────── */
$token    = getJson(EXPLORER_API . '/tokens/' . $addr, 12, $tokenStatus);
$holders  = getJson(EXPLORER_API . '/tokens/' . $addr . '/holders?limit=20', 12, $holderStatus);
$contract = getJson(EXPLORER_API . '/smart-contracts/' . $addr, 12, $contractStatus);
$pairs    = getJson(DS_API . '/tokens/' . $addr, 12, $dsStatus);

$name    = $token['name']   ?? null;
$symbol  = $token['symbol'] ?? null;
$decimals = (int)($token['decimals'] ?? 18);
$supplyRaw = $token['total_supply'] ?? null;
$supply  = $supplyRaw !== null ? (float)$supplyRaw / (10 ** $decimals) : null;
$holderCount = isset($token['holders']) ? (int)$token['holders'] : null;

// Deepest pair wins; a token can have several.
$pair = null;
foreach (($pairs['pairs'] ?? []) as $p) {
    if (!$pair || (($p['liquidity']['usd'] ?? 0) > ($pair['liquidity']['usd'] ?? 0))) $pair = $p;
}
$priceUsd  = $pair ? (float)($pair['priceUsd'] ?? 0) : null;
$liquidity = $pair ? (float)($pair['liquidity']['usd'] ?? 0) : null;
$vol24     = $pair ? (float)($pair['volume']['h24'] ?? 0) : null;
$mcap      = ($supply && $priceUsd) ? $supply * $priceUsd : ($pair['marketCap'] ?? null);
$pairAgeH  = null;
if ($pair && !empty($pair['pairCreatedAt'])) {
    $pairAgeH = (time() - (int)($pair['pairCreatedAt'] / 1000)) / 3600;
}

$verified = !empty($contract['is_verified']);
$source   = (string)($contract['source_code'] ?? '');

/* Which sources actually answered. Everything below depends on this: a source
   we could not reach tells us nothing, and must never be reported as though it
   told us something bad. "We could not check" and "we checked and it is bad"
   are completely different statements to put in front of someone deciding
   whether to risk money. */
/* A 404 is an answer, not a failure. Blockscout returns one for a contract
   nobody has verified, and DexScreener for a token with no pair — both are
   things we genuinely learned. Only a transport failure (status 0) or a
   server-side error means we could not look. */
$answered = fn($body, $status) => $body !== null || $status === 404;

$reached = [
    'explorer'    => $answered($token, $tokenStatus) || $answered($contract, $contractStatus),
    'contract'    => $answered($contract, $contractStatus),
    'holders'     => $answered($holders, $holderStatus),
    'dexscreener' => $answered($pairs, $dsStatus),
];
$unreachable = array_keys(array_filter($reached, fn($ok) => !$ok));

/* ── compute the findings ──────────────────────────────────────────────── */
/* Each finding is a fact with a severity. Nothing here is a judgement call by
   a language model — it is all arithmetic or a string match on real source. */
$findings = [];
$add = function (string $level, string $what, string $why) use (&$findings) {
    $findings[] = ['level' => $level, 'what' => $what, 'why' => $why];
};

// 1. Is the source readable at all?
if (!$reached['contract']) {
    $add('unknown', 'Could not reach the explorer',
         'No verdict on the contract source — this is our problem, not the token\'s.');
} elseif ($verified) {
    $add('good', 'Contract source is verified',
         'Anyone can read exactly what this contract does on the explorer.');
} else {
    $add('bad', 'Contract source is NOT verified',
         'Nobody can see what this contract actually does. Treat everything else here as unconfirmed.');
}

// 2. Can more tokens appear later?
if ($verified && $source !== '') {
    $mintable = preg_match('/function\s+_?mint\s*\(/i', $source)
                && !preg_match('/_mint\s*\([^)]*\)\s*;\s*\}\s*$/i', $source);
    $hasOwner = preg_match('/onlyOwner|Ownable/i', $source);
    $canPause = preg_match('/function\s+(pause|setTrading|enableTrading|blacklist|setMaxTx)/i', $source);
    $feeSetter = preg_match('/function\s+set(Fee|Tax|Buy|Sell)[A-Za-z]*\s*\(/i', $source);

    if ($mintable) {
        $add('bad', 'The contract contains a mint function',
             'More tokens can be created after launch, which dilutes everyone holding.');
    } else {
        $add('good', 'No mint function found', 'The supply cannot be increased.');
    }
    if ($canPause) {
        $add('bad', 'Owner can restrict trading',
             'Found a function that can pause trading, blacklist wallets or cap transactions.');
    }
    if ($feeSetter) {
        $add('warn', 'Fees can be changed after launch',
             'The owner can alter the buy or sell tax. Check what it is set to now, and who can change it.');
    }
    if ($hasOwner && !$canPause && !$feeSetter) {
        $add('warn', 'Contract has an owner',
             'Ownership exists but no dangerous function was spotted. Worth checking if it is renounced.');
    }
}

// 3. Who holds it?
$top = [];
$topShare = null;
if (!$reached['holders']) {
    $add('unknown', 'Could not read the holder list',
         'No verdict on how concentrated the supply is.');
} elseif (!empty($holders['items']) && $supply) {
    $sum = 0.0;
    foreach (array_slice($holders['items'], 0, 10) as $h) {
        $v = (float)($h['value'] ?? 0) / (10 ** $decimals);
        $sum += $v;
        $top[] = [
            'address' => $h['address']['hash'] ?? '',
            'pct' => $supply > 0 ? round($v / $supply * 100, 2) : null,
            'isContract' => !empty($h['address']['is_contract']),
        ];
    }
    $topShare = $supply > 0 ? round($sum / $supply * 100, 1) : null;

    // The pool itself holding most of the supply is healthy, not a red flag.
    $poolPct = 0.0;
    foreach ($top as $t) if ($t['isContract']) $poolPct += (float)$t['pct'];
    $walletPct = round(($topShare ?? 0) - $poolPct, 1);

    if ($walletPct >= 50) {
        $add('bad', 'Top wallets hold ' . $walletPct . '% of supply',
             'A handful of people could sell into everyone else at any moment.');
    } elseif ($walletPct >= 25) {
        $add('warn', 'Top wallets hold ' . $walletPct . '% of supply',
             'Concentrated, though not unusual early on. Worth watching what those wallets do.');
    } else {
        $add('good', 'Supply is spread out',
             'The largest wallets hold ' . $walletPct . '% between them, excluding the pool.');
    }
}

// 4. Is there enough liquidity to get out?
if (!$reached['dexscreener']) {
    $add('unknown', 'Could not reach the market data source',
         'No verdict on liquidity, price or volume.');
} elseif ($liquidity !== null && $mcap) {
    $ratio = $mcap > 0 ? $liquidity / $mcap : 0;
    if ($liquidity < 5000) {
        $add('bad', 'Liquidity is only ' . usdShort($liquidity),
             'Thin enough that a modest sell moves the price hard. Getting out may cost you more than you expect.');
    } elseif ($ratio < 0.03) {
        $add('warn', 'Liquidity is ' . round($ratio * 100, 1) . '% of market cap',
             'Low relative to the valuation. The price is more fragile than the market cap suggests.');
    } else {
        $add('good', 'Liquidity is ' . usdShort($liquidity) . ' (' . round($ratio * 100, 1) . '% of market cap)',
             'Deep enough to absorb normal trading.');
    }
}

// 5. How old is it?
if ($pairAgeH !== null) {
    if ($pairAgeH < 24) {
        $add('warn', 'Launched ' . round($pairAgeH) . ' hours ago',
             'Brand new. Most tokens this young do not survive the week.');
    } else {
        $add('good', 'Trading for ' . round($pairAgeH / 24) . ' days', 'It has some history behind it.');
    }
}

if ($reached['dexscreener'] && !$pair) {
    $add('bad', 'No liquidity pool found',
         'This token is not trading anywhere DexScreener can see. You may not be able to sell it.');
}

/* ── verdict ───────────────────────────────────────────────────────────── */
$bad     = count(array_filter($findings, fn($f) => $f['level'] === 'bad'));
$warn    = count(array_filter($findings, fn($f) => $f['level'] === 'warn'));
$unknown = count(array_filter($findings, fn($f) => $f['level'] === 'unknown'));

/* Too little to go on is its own answer. Saying "high risk" because we could
   not fetch anything would be a lie with someone's money attached, and saying
   "looks fine" would be worse. */
if ($unknown >= 2) {
    $verdict = 'unknown';
    $label   = 'Could not check';
} elseif ($bad >= 2)  { $verdict = 'high';    $label = 'High risk'; }
elseif ($bad === 1)   { $verdict = 'caution'; $label = 'Be careful'; }
elseif ($warn >= 2)   { $verdict = 'caution'; $label = 'Some concerns'; }
elseif ($unknown)     { $verdict = 'partial'; $label = 'Mostly clean, partly unchecked'; }
else                  { $verdict = 'ok';      $label = 'Nothing alarming'; }

$report = [
    'address'  => $addr,
    'name'     => $name,
    'symbol'   => $symbol,
    'verdict'  => $verdict,
    'label'    => $label,
    'stats'    => [
        'price' => $priceUsd, 'mcap' => $mcap, 'liquidity' => $liquidity,
        'volume24h' => $vol24, 'holders' => $holderCount,
        'supply' => $supply, 'ageHours' => $pairAgeH, 'verified' => $verified,
    ],
    'findings' => $findings,
    'top'      => array_slice($top, 0, 5),
    'summary'  => null,
    'unreachable' => $unreachable,
    'scannedAt' => time(),
];

/* ── the model's job: explain, never decide ────────────────────────────── */
$report['summary'] = summarise($report);

// Never cache a report we could not actually produce.
if ($verdict !== 'unknown') {
    @file_put_contents($cacheFile, json_encode($report), LOCK_EX);
}
echo json_encode($report, JSON_UNESCAPED_SLASHES);
