<?php
/**
 * A stand-in provider for the discovery tests.
 *
 * MOCK_SHAPE decides which endpoint actually produces a picture:
 *   responses (default) — POST /v1/responses
 *   images              — POST /v1/images/generations, and /responses rejects
 *                         with a 400 the way a real gateway does when a model
 *                         cannot take the tools parameter
 *
 * It only accepts x-api-key and lives at /v1, so the site has to discover the
 * root and the auth header as well as the shape.
 */
$path   = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$method = $_SERVER['REQUEST_METHOD'];
$hdrs   = array_change_key_case(getallheaders(), CASE_LOWER);
$ok     = ($hdrs['x-api-key'] ?? '') === 'GOODKEY';
$shape  = getenv('MOCK_SHAPE') ?: 'responses';

// 'fail500' makes every generation attempt return a server error, so the
// retry-then-report path can be exercised.
if ($shape === 'fail500' && $path !== '/v1/models' && $method === 'POST') {
    http_response_code(503);
    echo '{"error":{"message":"upstream capacity exceeded"}}';
    exit;
}

header('Content-Type: application/json');
if (!$ok) { http_response_code(401); echo '{"error":{"message":"bad auth"}}'; exit; }

$png = fn() => base64_encode(hex2bin('89504e470d0a1a0a'));

if ($path === '/v1/models') {
    echo '{"data":[{"id":"mock/image-1"},{"id":"mock/text-1"}]}';
    exit;
}

if ($path === '/v1/chat/completions') {
    http_response_code(404);
    echo '{"error":{"message":"no such route"}}';
    exit;
}

if ($path === '/v1/responses') {
    if ($method === 'GET') { http_response_code(405); echo '{"error":{"message":"method not allowed"}}'; exit; }
    if ($shape !== 'responses') {
        http_response_code(400);
        echo '{"error":{"message":"model does not support the tools parameter"}}';
        exit;
    }
    echo json_encode(['model'=>'mock/image-1','output'=>[['type'=>'image_generation_call','result'=>$png()]]]);
    exit;
}

if ($path === '/v1/images/generations') {
    if ($method === 'GET') { http_response_code(405); echo '{"error":{"message":"method not allowed"}}'; exit; }
    if ($shape !== 'images') {
        http_response_code(404);
        echo '{"error":{"message":"not enabled"}}';
        exit;
    }
    echo json_encode(['model'=>'mock/image-1','data'=>[['b64_json'=>$png()]]]);
    exit;
}

http_response_code(404);
echo '{"error":{"message":"not found"}}';
