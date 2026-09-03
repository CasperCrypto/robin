<?php
/**
 * bridge.php — does anyone actually bridge into Robinhood Chain yet?
 *
 * Cross-chain buying depends entirely on whether an aggregator has listed
 * chain 4663, and that is not a thing to hard-code: it is false until some
 * day it is true, and on that day this should start working without anyone
 * editing a file.
 *
 * So the site asks. It queries each aggregator's own chain list, caches the
 * answer for a day, and reports what it found. The swap panel offers a
 * cross-chain route only when one genuinely exists, and shows the honest
 * manual route when it does not — rather than advertising a path that dead
 * ends at someone's wallet.
 *
 * The fee is the other half. Every aggregator here supports an integrator fee
 * on the route, which is how this would earn: the fee is quoted to the user
 * before they commit, by the aggregator, in the same number they are agreeing
 * to. Nothing is skimmed after the fact.
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: public, max-age=300');

require_once __DIR__ . '/lib.php';

const CHAIN_ID  = 4663;
const CACHE_TTL = 86400;      // re-ask once a day
const PROBE_TIMEOUT = 8;

/**
 * Each entry says where to ask and how to read the answer. Adding an
 * aggregator is adding a row.
 */
function providers(): array {
    /* Tests point every provider at one stand-in rather than the live
       internet; production leaves this unset and uses the table below. */
    $override = getenv('ROBIN_BRIDGE_URLS');
    if ($override) {
        $out = [];
        foreach (array_filter(array_map('trim', explode(',', $override))) as $i => $url) {
            $out['probe' . $i] = [
                'name' => 'probe' . $i, 'url' => $url,
                'find' => fn(array $j) => hasId($j['chains'] ?? [], ['id', 'chainId']),
                'docs' => '',
            ];
        }
        return $out;
    }

    return [
        'lifi' => [
            'name' => 'LI.FI',
            'url'  => 'https://li.quest/v1/chains',
            'find' => fn(array $j) => hasId($j['chains'] ?? [], ['id', 'chainId']),
            'docs' => 'https://docs.li.fi',
        ],
        'relay' => [
            'name' => 'Relay',
            'url'  => 'https://api.relay.link/chains',
            'find' => fn(array $j) => hasId($j['chains'] ?? [], ['id', 'chainId']),
            'docs' => 'https://docs.relay.link',
        ],
        'squid' => [
            'name' => 'Squid',
            'url'  => 'https://apiplus.squidrouter.com/v2/chains',
            'find' => fn(array $j) => hasId($j['chains'] ?? [], ['chainId', 'id']),
            'docs' => 'https://docs.squidrouter.com',
        ],
        'rango' => [
            'name' => 'Rango',
            'url'  => 'https://api.rango.exchange/basic/meta?apiKey=c6381a79-2817-4602-83bf-6a641a409e32',
            'find' => fn(array $j) => hasId($j['blockchains'] ?? [], ['chainId', 'id']),
            'docs' => 'https://docs.rango.exchange',
        ],
    ];
}

/** Chain ids arrive as ints, as strings, and as "eip155:4663". Accept all. */
function hasId(array $rows, array $keys): bool {
    foreach ($rows as $row) {
        if (!is_array($row)) continue;
        foreach ($keys as $k) {
            if (!isset($row[$k])) continue;
            $v = $row[$k];
            if (is_int($v) && $v === CHAIN_ID) return true;
            if (is_string($v)) {
                if ($v === (string)CHAIN_ID) return true;
                if (preg_match('/(?:^|:)' . CHAIN_ID . '$/', $v)) return true;
            }
        }
    }
    return false;
}

$cacheFile = sys_get_temp_dir() . '/robin_bridge.json';
if (empty($_GET['fresh']) && is_readable($cacheFile) && filemtime($cacheFile) > time() - CACHE_TTL) {
    echo (string)file_get_contents($cacheFile);
    exit;
}

$results = [];
$supported = [];
foreach (providers() as $key => $p) {
    $j = getJson($p['url'], PROBE_TIMEOUT, $status);
    if ($j === null) {
        // Unreachable is not "unsupported". Say which it was.
        $results[$key] = ['name' => $p['name'], 'reachable' => false, 'supports' => null];
        continue;
    }
    $ok = ($p['find'])($j);
    $results[$key] = ['name' => $p['name'], 'reachable' => true, 'supports' => $ok];
    if ($ok) $supported[] = $key;
}

$asked   = count(array_filter($results, fn($r) => $r['reachable']));
$verdict = $supported ? 'available' : ($asked ? 'none' : 'unknown');

$out = [
    'chainId'   => CHAIN_ID,
    /* available — at least one aggregator lists the chain
       none      — we asked and nobody does, so the manual route is the honest one
       unknown   — nobody answered, so we know nothing and should not claim to */
    'status'    => $verdict,
    'via'       => $supported,
    'providers' => $results,
    'checkedAt' => time(),
];

// A verdict of "unknown" is an outage, not a finding. Never cache it.
if ($verdict !== 'unknown') @file_put_contents($cacheFile, json_encode($out), LOCK_EX);

echo json_encode($out, JSON_UNESCAPED_SLASHES);
