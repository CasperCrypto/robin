<?php
/**
 * ai.php — server-side image proxy for the $ROBIN meme forge.
 *
 * The browser sends a short prompt. This file adds the house style, attaches
 * the official Robin artwork as a reference image so the generated dog is
 * always *your* dog, calls your provider, and returns one PNG as a data URL.
 *
 * Your API key never reaches the browser.
 *
 * SETUP — pick one:
 *   1. Environment variable:  ROBIN_AI_KEY=sk-...
 *   2. Or create api/config.php next to this file:
 *        <?php return ['ROBIN_AI_KEY' => 'sk-...'];
 *      (api/config.php is git-ignored — never commit your key.)
 *
 * Requires PHP 7.4+ with cURL.
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
header('Cache-Control: no-store');

// ── config ────────────────────────────────────────────────────────────────
const API_BASE   = 'https://api.concentrate.ai/api/v1/chat/completions';
const MODEL      = 'google/gemini-2.5-flash-image';
const REF_IMAGE  = __DIR__ . '/../assets/img/robin-logo.png';

const MAX_PROMPT = 400;
const RATE_MAX   = 8;      // image calls…
const RATE_WINDOW= 600;    // …per this many seconds, per IP
const TIMEOUT    = 120;

function fail(int $code, string $msg): void {
    http_response_code($code);
    echo json_encode(['error' => $msg]);
    exit;
}

function apiKey(): string {
    foreach (['ROBIN_AI_KEY', 'OPENROUTER_API_KEY', 'CONCENTRATE_API_KEY'] as $n) {
        $v = getenv($n) ?: ($_SERVER[$n] ?? '');
        if ($v) return trim((string)$v);
    }
    if (is_readable(__DIR__ . '/config.php')) {
        $cfg = require __DIR__ . '/config.php';
        if (is_array($cfg)) {
            foreach (['ROBIN_AI_KEY', 'OPENROUTER_API_KEY', 'CONCENTRATE_API_KEY'] as $n) {
                if (!empty($cfg[$n])) return trim((string)$cfg[$n]);
            }
        }
    }
    return '';
}

// ── method, rate limit, input ─────────────────────────────────────────────
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') fail(405, 'POST only');

$ip = $_SERVER['HTTP_CF_CONNECTING_IP'] ?? $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
$bucket = sys_get_temp_dir() . '/robin_forge_' . sha1($ip) . '.json';
$now = time();
$hits = [];
if (is_readable($bucket)) {
    $raw = json_decode((string)@file_get_contents($bucket), true);
    if (is_array($raw)) $hits = $raw;
}
$hits = array_values(array_filter($hits, fn($t) => is_int($t) && $t > $now - RATE_WINDOW));
if (count($hits) >= RATE_MAX) {
    fail(429, 'That is a lot of memes. Give it a couple of minutes.');
}

$body = json_decode((string)file_get_contents('php://input'), true);
if (!is_array($body)) fail(400, 'Bad request body');

$prompt = mb_substr(trim((string)($body['prompt'] ?? '')), 0, MAX_PROMPT);
if ($prompt === '') fail(400, 'Tell it what to draw first.');

$key = apiKey();
if ($key === '') fail(503, 'The meme forge is not configured yet — set ROBIN_AI_KEY on the server.');

// count the attempt only once we know we are really going to call out
$hits[] = $now;
@file_put_contents($bucket, json_encode($hits), LOCK_EX);

// ── build the request ─────────────────────────────────────────────────────
$style = "You are illustrating official artwork for the \$ROBIN (Robin Nakamoto) memecoin.\n\n"
    . "The attached image is the canonical character: a Shiba Inu wearing a bright green\n"
    . "Robin Hood hat with a white feather and thick black rectangular glasses.\n\n"
    . "Draw a NEW square image of this exact character in the scene the user describes.\n"
    . "Rules:\n"
    . "- Keep the character on-model: same shiba, same green feathered hat, same black glasses.\n"
    . "- Match the source style: bold clean outlines, flat cel shading, saturated colours,\n"
    . "  cartoon/vector look. No photorealism, no 3D render.\n"
    . "- Use the brand lime green (#A8DC2B) somewhere prominent, usually the background.\n"
    . "- Keep it readable as a small square thumbnail on social media.\n"
    . "- No text or lettering in the image unless the user explicitly asks for words.\n"
    . "- Nothing hateful, sexual, or depicting real people.\n\n"
    . "SCENE: " . $prompt;

$content = [['type' => 'text', 'text' => $style]];

// attach the reference artwork so the dog stays on-model
if (is_readable(REF_IMAGE)) {
    $raw = @file_get_contents(REF_IMAGE);
    if ($raw !== false && strlen($raw) < 6_000_000) {
        $content[] = [
            'type' => 'image_url',
            'image_url' => ['url' => 'data:image/png;base64,' . base64_encode($raw)],
        ];
    }
}

$payload = [
    'model'      => (string)($body['model'] ?? '') ?: MODEL,
    'modalities' => ['image', 'text'],
    'messages'   => [['role' => 'user', 'content' => $content]],
];

$origin = (($_SERVER['HTTPS'] ?? '') === 'on' ? 'https://' : 'http://')
        . ($_SERVER['HTTP_HOST'] ?? 'shopping.io');

$ch = curl_init(API_BASE);
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => TIMEOUT,
    CURLOPT_POSTFIELDS => json_encode($payload),
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        'Authorization: Bearer ' . $key,
        'HTTP-Referer: ' . $origin,
        'X-Title: ROBIN Meme Forge',
    ],
]);
$res  = curl_exec($ch);
$code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err  = curl_error($ch);
curl_close($ch);

if ($res === false) fail(502, 'Could not reach the image service: ' . $err);
$j = json_decode((string)$res, true);

if ($code !== 200) {
    $m = $j['error']['message'] ?? 'Upstream error';
    error_log('[robin-forge] ' . $code . ': ' . $m);
    if ($code === 401 || $code === 403) fail(502, 'The API key was rejected — check ROBIN_AI_KEY.');
    if ($code === 429) fail(429, 'The image service is rate-limiting us. Try again shortly.');
    fail(502, 'The image service is busy. Try again in a moment.');
}

// ── pull the image out of the response ────────────────────────────────────
// Providers differ slightly, so accept the common shapes rather than one.
$msg = $j['choices'][0]['message'] ?? [];
$url = null;

if (!empty($msg['images'][0]['image_url']['url'])) {
    $url = $msg['images'][0]['image_url']['url'];
} elseif (!empty($msg['images'][0]['url'])) {
    $url = $msg['images'][0]['url'];
} elseif (is_array($msg['content'] ?? null)) {
    foreach ($msg['content'] as $part) {
        if (!empty($part['image_url']['url'])) { $url = $part['image_url']['url']; break; }
        if (($part['type'] ?? '') === 'output_image' && !empty($part['data'])) {
            $url = 'data:image/png;base64,' . $part['data']; break;
        }
    }
} elseif (!empty($j['data'][0]['b64_json'])) {
    $url = 'data:image/png;base64,' . $j['data'][0]['b64_json'];
}

if (!$url) {
    // The model answered with words instead of a picture — usually the wrong model.
    $said = is_string($msg['content'] ?? null) ? trim($msg['content']) : '';
    error_log('[robin-forge] no image in response; text was: ' . mb_substr($said, 0, 300));
    fail(502, $said !== ''
        ? 'That model replied with text instead of an image. Point ai.model at an image model.'
        : 'No image came back. Try a different scene.');
}

echo json_encode(['image' => $url, 'model' => $j['model'] ?? MODEL], JSON_UNESCAPED_SLASHES);
