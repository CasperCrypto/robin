<?php
/**
 * Stands in for the explorer, DexScreener and the bridge aggregators, so the
 * token list and the bridge probe can be tested against known answers.
 *
 * ?mode=yes   one aggregator lists chain 4663
 * ?mode=no    they all answer, none of them list it
 * ?mode=down  nobody answers at all
 */
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
/* Modes come from the query so one server can answer every case in a test run.
   Restarting a PHP server on the same port between assertions is not reliable,
   and when it fails the next probe silently talks to the previous server —
   which reads as a genuine result and is not one. */
$mode = $_GET['mode'] ?? (getenv('MOCK_BRIDGE') ?: 'no');
header('Content-Type: application/json');

/* The route prover: MOCK_ROUTE=yes a real quote comes back
                     no  the provider answers, with no route
                     bad we are asking wrongly, which is not the same as "no"
                     down nobody answers at all */
if (str_contains($path, '/quote')) {
    // Taken from the query rather than the environment so the test can change
    // it between probes without restarting this server — restarting it on the
    // same port is not reliable enough to build assertions on.
    $r = $_GET['mode'] ?? (getenv('MOCK_ROUTE') ?: 'no');
    if ($r === 'down') { http_response_code(503); echo '{"message":"upstream down"}'; exit; }
    if ($r === 'bad')  { http_response_code(400); echo '{"message":"unknown parameter toChain"}'; exit; }
    if ($r === 'yes')  { echo '{"toAmount":"318400000000000000","tool":"probe"}'; exit; }
    http_response_code(404); echo '{"message":"no route found for this pair"}'; exit;
}

if (str_contains($path, '/chains')) {
    if ($mode === 'down') { http_response_code(503); echo '{"message":"down"}'; exit; }
    $chains = [['id' => 1, 'name' => 'Ethereum'], ['id' => 8453, 'name' => 'Base']];
    if ($mode === 'yes') $chains[] = ['id' => 4663, 'name' => 'Robinhood Chain'];
    echo json_encode(['chains' => $chains]); exit;
}

if (str_contains($path, '/tokens') && !str_contains($path, '/dex/')) {
    echo json_encode(['items' => [
        ['address' => '0x280413fbf06ccc1114094a5967db2191d49ee75e', 'name' => 'Robin Nakamoto',
         'symbol' => 'ROBIN', 'decimals' => '18', 'holders' => 412],
        ['address' => '0xaaaa13fbf06ccc1114094a5967db2191d49ee75e', 'name' => 'Deep Token',
         'symbol' => 'DEEP', 'decimals' => '18', 'holders' => 900],
        ['address' => '0xbbbb13fbf06ccc1114094a5967db2191d49ee75e', 'name' => 'No Market',
         'symbol' => 'DEAD', 'decimals' => '18', 'holders' => 3],
    ]]); exit;
}

if (str_contains($path, '/dex/tokens/')) {
    echo json_encode(['pairs' => [
        ['pairAddress' => '0xpair1', 'priceUsd' => '0.00007012', 'priceNative' => '0.00000002',
         'liquidity' => ['usd' => 41800], 'volume' => ['h24' => 18400],
         'priceChange' => ['h24' => 12.6], 'marketCap' => 70120,
         'baseToken' => ['address' => '0x280413fbf06ccc1114094a5967db2191d49ee75e', 'symbol' => 'ROBIN'],
         'quoteToken' => ['address' => '0x0000000000000000000000000000000000000000', 'symbol' => 'ETH']],
        ['pairAddress' => '0xpair2', 'priceUsd' => '1.25', 'priceNative' => '0.0003',
         'liquidity' => ['usd' => 260000], 'volume' => ['h24' => 91000],
         'priceChange' => ['h24' => -3.1], 'marketCap' => 1250000,
         'baseToken' => ['address' => '0xaaaa13fbf06ccc1114094a5967db2191d49ee75e', 'symbol' => 'DEEP'],
         'quoteToken' => ['address' => '0x0000000000000000000000000000000000000000', 'symbol' => 'ETH']],
        // A pair too thin to count as a market at all.
        ['pairAddress' => '0xpair3', 'priceUsd' => '0.001', 'priceNative' => '0.0000001',
         'liquidity' => ['usd' => 12], 'volume' => ['h24' => 3],
         'baseToken' => ['address' => '0xbbbb13fbf06ccc1114094a5967db2191d49ee75e', 'symbol' => 'DEAD'],
         'quoteToken' => ['address' => '0x0000000000000000000000000000000000000000', 'symbol' => 'ETH']],
    ]]); exit;
}

http_response_code(404); echo '{"message":"not found"}';
