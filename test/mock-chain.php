<?php
/**
 * Stands in for Blockscout and DexScreener so the scanner's scoring can be
 * tested against known token profiles.
 *
 * MOCK_TOKEN=clean  a verified, fixed-supply token with deep liquidity
 * MOCK_TOKEN=rug    unverified, one wallet holds most of it, thin liquidity
 */
$path  = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$kind  = getenv('MOCK_TOKEN') ?: 'clean';
header('Content-Type: application/json');

$DEC = 18;
$SUP = '1000000000' . str_repeat('0', $DEC);
$unit = fn($n) => (string)$n . str_repeat('0', $DEC);

if (str_ends_with($path, '/holders')) {
    $items = $kind === 'rug'
        ? [['value'=>$unit(780000000),'address'=>['hash'=>'0xaaa1','is_contract'=>false]],
           ['value'=>$unit(90000000), 'address'=>['hash'=>'0xaaa2','is_contract'=>false]],
           ['value'=>$unit(40000000), 'address'=>['hash'=>'0xpool','is_contract'=>true]]]
        : [['value'=>$unit(600000000),'address'=>['hash'=>'0xpool','is_contract'=>true]],
           ['value'=>$unit(30000000), 'address'=>['hash'=>'0xbbb1','is_contract'=>false]],
           ['value'=>$unit(20000000), 'address'=>['hash'=>'0xbbb2','is_contract'=>false]]];
    echo json_encode(['items' => $items]); exit;
}

if (str_contains($path, '/smart-contracts/')) {
    if ($kind === 'rug') { http_response_code(404); echo '{"message":"not verified"}'; exit; }
    echo json_encode([
        'is_verified' => true,
        'source_code' => "contract Robin is ERC20 {\n  constructor(){ _mint(msg.sender, 1e27); }\n}",
    ]); exit;
}

if (str_contains($path, '/dex/tokens/')) {
    $liq = $kind === 'rug' ? 1800 : 240000;
    echo json_encode(['pairs'=>[[
        'priceUsd'=>'0.00007','liquidity'=>['usd'=>$liq],'volume'=>['h24'=>52000],
        'marketCap'=>70000,'pairCreatedAt'=>(time()-86400*40)*1000,
    ]]]); exit;
}

if (str_contains($path, '/tokens/')) {
    echo json_encode(['name'=>'Mock Token','symbol'=>'MOCK','decimals'=>(string)$DEC,
                      'total_supply'=>$SUP,'holders'=>$kind==='rug'?42:3100]); exit;
}
http_response_code(404); echo '{"message":"not found"}';
