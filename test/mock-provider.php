<?php
/* A provider that only accepts x-api-key, lives at /v1, and speaks the
   Responses API. Exactly the combination the site must discover unaided. */
$path   = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$method = $_SERVER['REQUEST_METHOD'];
$hdrs   = array_change_key_case(getallheaders(), CASE_LOWER);
$ok     = ($hdrs['x-api-key'] ?? '') === 'GOODKEY';

header('Content-Type: application/json');

if (!$ok) { http_response_code(401); echo '{"error":{"message":"bad auth"}}'; exit; }

if ($path === '/v1/models') { echo '{"data":[{"id":"mock/image-1"},{"id":"mock/text-1"}]}'; exit; }
if ($path === '/v1/chat/completions') { http_response_code(404); echo '{"error":{"message":"no such route"}}'; exit; }
if ($path === '/v1/responses') {
  if ($method === 'GET') { http_response_code(405); echo '{"error":{"message":"method not allowed"}}'; exit; }
  $png = base64_encode(hex2bin('89504e470d0a1a0a'));
  echo json_encode(['model'=>'mock/image-1','output'=>[['type'=>'image_generation_call','result'=>$png]]]);
  exit;
}
http_response_code(404); echo '{"error":{"message":"not found"}}';
