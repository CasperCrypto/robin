<?php
/**
 * Stands in for DexScreener and the chain RPC so the arena's round engine can
 * be driven against a known price series and a known wallet balance.
 *
 * The test writes the current values into two files next to this one, so it can
 * move the price and the balance between requests without restarting anything.
 */
$dir   = getenv('ARENA_DIR') ?: sys_get_temp_dir();
$price = trim(@file_get_contents($dir . '/price.txt') ?: '0.0001');
$balHex= trim(@file_get_contents($dir . '/balance.txt') ?: '0');
header('Content-Type: application/json');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {          // the RPC
    echo json_encode(['jsonrpc' => '2.0', 'id' => 1,
                      'result' => '0x' . str_pad($balHex, 64, '0', STR_PAD_LEFT)]);
    exit;
}

echo json_encode(['pairs' => [[                                // DexScreener
    'priceUsd' => $price, 'liquidity' => ['usd' => 41800],
    'volume' => ['h24' => 18400], 'marketCap' => 70000,
]]]);
