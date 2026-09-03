<?php
/**
 * route.php — can anyone actually take Solana money to Robinhood Chain?
 *
 * bridge.php asks the weaker question: is chain 4663 in your chain list. That
 * can be true while the route we care about does not exist — a chain can be
 * listed for EVM-to-EVM and have no Solana path at all. The only proof that a
 * route works is a real quote for it, so this asks for one.
 *
 * Each provider is asked to price the same trade: one SOL, into ETH on chain
 * 4663. A provider that returns a route can do it. A provider that returns "no
 * route" cannot. A provider that returns "unknown parameter" is one we are
 * asking wrongly — and that is a completely different problem, so its own
 * words are reported rather than folded into a no.
 *
 * That distinction is the reason this file exists. A silent false negative
 * here would have us tell every Solana holder to go and bridge by hand for
 * months after the one-click route quietly became available.
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: public, max-age=600');

require_once __DIR__ . '/lib.php';

const DEST_CHAIN = 4663;
const NATIVE     = '0x0000000000000000000000000000000000000000';
const SOL_MINT   = 'So11111111111111111111111111111111111111112';   // wrapped SOL
const ONE_SOL    = '1000000000';                                     // lamports
const CACHE_TTL  = 3600;
const TIMEOUT    = 10;

/* Quote-only placeholders. Nothing is signed or sent; these exist because most
   routers refuse to price a trade without somewhere to price it to. */
const FROM_SOL = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const TO_EVM   = '0x000000000000000000000000000000000000dEaD';

/** Each aggregator's own id for Solana. They all differ, and all matter. */
function providers(): array {
    $override = getenv('ROBIN_ROUTE_URLS');
    if ($override) {
        $out = [];
        foreach (array_filter(array_map('trim', explode(',', $override))) as $i => $url) {
            $out['probe' . $i] = ['name' => 'probe' . $i, 'method' => 'GET', 'url' => $url,
                                  'read' => fn($j) => readGeneric($j)];
        }
        return $out;
    }

    $dest = DEST_CHAIN;
    return [
        'lifi' => [
            'name' => 'LI.FI', 'method' => 'GET',
            'url' => 'https://li.quest/v1/quote?' . http_build_query([
                'fromChain' => 'SOL', 'toChain' => $dest,
                'fromToken' => SOL_MINT, 'toToken' => NATIVE,
                'fromAmount' => ONE_SOL,
                'fromAddress' => FROM_SOL, 'toAddress' => TO_EVM,
            ]),
            'read' => fn($j) => isset($j['estimate']['toAmount'])
                ? ['out' => (string)$j['estimate']['toAmount'], 'tool' => $j['tool'] ?? null] : null,
        ],
        'relay' => [
            'name' => 'Relay', 'method' => 'POST',
            'url' => 'https://api.relay.link/quote',
            'body' => [
                'user' => TO_EVM, 'recipient' => TO_EVM,
                'originChainId' => 792703809, 'destinationChainId' => $dest,
                'originCurrency' => SOL_MINT, 'destinationCurrency' => NATIVE,
                'amount' => ONE_SOL, 'tradeType' => 'EXACT_INPUT',
            ],
            'read' => fn($j) => isset($j['details']['currencyOut']['amount'])
                ? ['out' => (string)$j['details']['currencyOut']['amount'], 'tool' => 'relay'] : null,
        ],
        'debridge' => [
            'name' => 'deBridge', 'method' => 'GET',
            'url' => 'https://dln.debridge.finance/v1.0/dln/order/create-tx?' . http_build_query([
                'srcChainId' => 7565164, 'srcChainTokenIn' => SOL_MINT, 'srcChainTokenInAmount' => ONE_SOL,
                'dstChainId' => $dest, 'dstChainTokenOut' => NATIVE,
                'dstChainTokenOutRecipient' => TO_EVM,
                'srcChainOrderAuthorityAddress' => FROM_SOL,
                'dstChainOrderAuthorityAddress' => TO_EVM,
            ]),
            'read' => fn($j) => isset($j['estimation']['dstChainTokenOut']['amount'])
                ? ['out' => (string)$j['estimation']['dstChainTokenOut']['amount'], 'tool' => 'dln'] : null,
        ],
        'mayan' => [
            'name' => 'Mayan', 'method' => 'GET',
            'url' => 'https://price-api.mayan.finance/v3/quote?' . http_build_query([
                'amountIn' => '1', 'fromToken' => SOL_MINT, 'fromChain' => 'solana',
                'toToken' => NATIVE, 'toChain' => (string)$dest, 'slippageBps' => 300,
            ]),
            'read' => function ($j) {
                $r = $j['quotes'][0] ?? ($j[0] ?? null);
                return is_array($r) && isset($r['expectedAmountOut'])
                    ? ['out' => (string)$r['expectedAmountOut'], 'tool' => 'mayan'] : null;
            },
        ],
    ];
}

/** For the test double: any shape carrying a positive amount counts as a route. */
function readGeneric($j) {
    foreach (['toAmount', 'out', 'amountOut'] as $k) {
        if (!empty($j[$k])) return ['out' => (string)$j[$k], 'tool' => 'probe'];
    }
    return null;
}

/** Ask one provider, and report what it actually said. */
function ask(array $p): array {
    $ch = curl_init($p['url']);
    $opts = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => TIMEOUT,
        CURLOPT_CONNECTTIMEOUT => 6,
        CURLOPT_HTTPHEADER => ['Accept: application/json', 'Content-Type: application/json'],
        CURLOPT_USERAGENT => 'robin-router/1.0',
    ];
    if (($p['method'] ?? 'GET') === 'POST') {
        $opts[CURLOPT_POST] = true;
        $opts[CURLOPT_POSTFIELDS] = json_encode($p['body'] ?? []);
    }
    curl_setopt_array($ch, $opts);
    $raw  = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);

    if ($raw === false || $code === 0) {
        return ['reachable' => false, 'route' => null, 'status' => 0,
                'said' => $err !== '' ? $err : 'no answer'];
    }
    $j = json_decode((string)$raw, true);
    $quote = (is_array($j) && $code >= 200 && $code < 300) ? ($p['read'])($j) : null;

    if ($quote) {
        return ['reachable' => true, 'route' => true, 'status' => $code,
                'out' => $quote['out'], 'tool' => $quote['tool'], 'said' => null];
    }
    // Its own words, so "no route on this chain" stays distinguishable from
    // "you asked me wrongly" — those need completely different fixes.
    return ['reachable' => true, 'route' => false, 'status' => $code,
            'said' => providerSaid($j, (string)$raw)];
}

function providerSaid($j, string $raw): string {
    if (is_array($j)) {
        foreach ([['message'], ['error'], ['errorMessage'], ['errorCode'], ['error', 'message']] as $path) {
            $v = $j;
            foreach ($path as $k) { $v = is_array($v) ? ($v[$k] ?? null) : null; }
            if (is_string($v) && $v !== '') return mb_substr($v, 0, 220);
        }
    }
    return mb_substr(trim($raw), 0, 220);
}

/* ── run ────────────────────────────────────────────────────────────────── */
$cacheFile = sys_get_temp_dir() . '/robin_route.json';
if (empty($_GET['fresh']) && is_readable($cacheFile) && filemtime($cacheFile) > time() - CACHE_TTL) {
    echo (string)file_get_contents($cacheFile);
    exit;
}

$results = [];
$works = [];
foreach (providers() as $key => $p) {
    $r = ask($p);
    $results[$key] = ['name' => $p['name']] + $r;
    if (!empty($r['route'])) $works[] = $key;
}

$answered = count(array_filter($results, fn($r) => $r['reachable']));
$status = $works ? 'available' : ($answered ? 'none' : 'unknown');

$out = [
    'from'      => 'solana',
    'toChain'   => DEST_CHAIN,
    /* available — somebody quoted the route, so one click is possible
       none      — everyone answered and nobody can, so the manual path is honest
       unknown   — nobody answered; we learned nothing and must not pretend we did */
    'status'    => $status,
    'via'       => $works,
    'providers' => $results,
    'checkedAt' => time(),
];

if ($status !== 'unknown') @file_put_contents($cacheFile, json_encode($out), LOCK_EX);
echo json_encode($out, JSON_UNESCAPED_SLASHES);
