<?php
/**
 * A stand-in provider for the discovery tests.
 *
 * MOCK_SHAPE decides which endpoint actually answers:
 *   responses (default) — POST /v1/responses
 *   chat                — POST /v1/chat/completions, and /responses rejects
 *                         with a 400 the way a real gateway does when a model
 *                         cannot take the parameters it was sent
 *   fail500             — every request 503s, so the retry-then-report path
 *                         can be exercised
 *
 * It only accepts x-api-key and lives at /v1, so the site has to discover the
 * root and the auth header as well as the shape.
 */
$path   = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$method = $_SERVER['REQUEST_METHOD'];
$hdrs   = array_change_key_case(getallheaders(), CASE_LOWER);
$ok     = ($hdrs['x-api-key'] ?? '') === 'GOODKEY';
$shape  = getenv('MOCK_SHAPE') ?: 'responses';

if ($shape === 'fail500' && $path !== '/v1/models' && $method === 'POST') {
    http_response_code(503);
    echo '{"error":{"message":"upstream capacity exceeded"}}';
    exit;
}

header('Content-Type: application/json');
if (!$ok) { http_response_code(401); echo '{"error":{"message":"bad auth"}}'; exit; }

const ANSWER = 'ROBIN OK';

if ($path === '/v1/models') {
    echo '{"data":[{"id":"mock/text-1"},{"id":"mock/text-2"}]}';
    exit;
}

if ($path === '/v1/responses') {
    if ($method === 'GET') { http_response_code(405); echo '{"error":{"message":"method not allowed"}}'; exit; }
    if ($shape !== 'responses') {
        http_response_code(400);
        echo '{"error":{"message":"model does not support the input parameter"}}';
        exit;
    }
    echo json_encode(['model'=>'mock/text-1','output'=>[
        ['type'=>'message','content'=>[['type'=>'output_text','text'=>ANSWER]]]]]);
    exit;
}

if ($path === '/v1/chat/completions') {
    if ($method === 'GET') { http_response_code(405); echo '{"error":{"message":"method not allowed"}}'; exit; }
    if ($shape !== 'chat') {
        http_response_code(404);
        echo '{"error":{"message":"no such route"}}';
        exit;
    }
    echo json_encode(['model'=>'mock/text-1','choices'=>[['message'=>['content'=>ANSWER]]]]);
    exit;
}

http_response_code(404);
echo '{"message":"not found"}';
