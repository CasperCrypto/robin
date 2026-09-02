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
/**
 * Your provider's API root, WITHOUT a trailing slash and without an endpoint
 * path. Everything else is derived from it. If your docs show a different
 * root, this is the only line you need to change.
 */
const API_ROOT   = 'https://api.concentrate.ai/api/v1';

/** Endpoint paths appended to API_ROOT. */
const PATH_CHAT   = '/chat/completions';
const PATH_MODELS = '/models';

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

// ── self-test ─────────────────────────────────────────────────────────────
/**
 * Open  api/ai.php?selftest=1        in a browser to check the setup.
 * Add   &image=1                     to also spend one real image generation.
 *
 * It reports whether the key is found, whether the API root answers, which of
 * your models can output images, and (optionally) whether a generation really
 * comes back. The key itself is never printed — only its first few characters
 * so you can tell which one is loaded.
 */
if (isset($_GET['selftest'])) {
    header('Content-Type: text/plain; charset=utf-8');

    $line = fn(string $l = '') => print($l . "\n");
    $line('$ROBIN meme forge — self test');
    $line(str_repeat('=', 46));
    $line();

    $key = apiKey();
    if ($key === '') {
        $line('KEY        MISSING');
        $line();
        $line('Set ROBIN_AI_KEY as an environment variable, or create');
        $line('api/config.php containing:');
        $line("    <?php return ['ROBIN_AI_KEY' => 'your-key'];");
        exit;
    }
    $line('KEY        found (' . substr($key, 0, 8) . '…, ' . strlen($key) . ' chars)');
    $line('API ROOT   ' . API_ROOT);
    $line('MODEL      ' . MODEL);
    $line('PHP        ' . PHP_VERSION . (function_exists('curl_init') ? ', cURL ok' : ', cURL MISSING'));
    $line('REF IMAGE  ' . (is_readable(REF_IMAGE) ? 'ok' : 'NOT READABLE at ' . REF_IMAGE));
    $line();

    // ── can we list models? ──────────────────────────────────────────────
    $line('--- ' . API_ROOT . PATH_MODELS . ' ---');
    $ch = curl_init(API_ROOT . PATH_MODELS);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $key, 'Accept: application/json'],
    ]);
    $raw  = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $cerr = curl_error($ch);
    curl_close($ch);

    if ($raw === false) {
        $line('FAILED     ' . $cerr);
        $line('           Your host may block outbound HTTPS. Ask them to allow it.');
    } else {
        $line('HTTP       ' . $code);
        $j = json_decode((string)$raw, true);
        $models = $j['data'] ?? (is_array($j) && isset($j[0]) ? $j : null);

        if ($code === 401 || $code === 403) {
            $line('           The key was rejected. Check it is the right one and still active.');
        } elseif ($code === 404) {
            $line('           No /models here. Your API root is probably different —');
            $line('           change API_ROOT at the top of this file to match your docs.');
        } elseif (is_array($models)) {
            $line('MODELS     ' . count($models) . ' visible');
            $img = [];
            foreach ($models as $m) {
                $id = is_array($m) ? ($m['id'] ?? '') : (string)$m;
                if ($id === '') continue;
                $blob = strtolower(json_encode($m));
                // either the id looks like an image model, or it declares image output
                if (strpos($blob, '"image"') !== false || preg_match('/image|dall|flux|imagen|sdxl|stable-diffusion/i', $id)) {
                    $img[] = $id;
                }
            }
            if ($img) {
                $line();
                $line('IMAGE-CAPABLE MODELS (put one in ai.model in assets/js/config.js):');
                foreach (array_slice($img, 0, 40) as $id) $line('    ' . $id);
                $line();
                $line(in_array(MODEL, $img, true)
                    ? 'Your configured model IS in the list. Good.'
                    : 'NOTE: "' . MODEL . '" is not in that list. Pick one from above.');
            } else {
                $line();
                $line('No obviously image-capable model found. Check your provider docs');
                $line('for the right model id, then set it in assets/js/config.js.');
            }
        } else {
            $line('           Unexpected response shape. First 400 chars:');
            $line('           ' . substr(preg_replace('/\s+/', ' ', (string)$raw), 0, 400));
        }
    }

    // ── optionally spend one real generation ─────────────────────────────
    if (isset($_GET['image'])) {
        $line();
        $line('--- live image test (this costs one generation) ---');
        $content = [['type' => 'text', 'text' => 'Draw a simple green circle on a white background.']];
        $ch = curl_init(API_ROOT . PATH_CHAT);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 120,
            CURLOPT_POSTFIELDS => json_encode([
                'model' => MODEL,
                'modalities' => ['image', 'text'],
                'messages' => [['role' => 'user', 'content' => $content]],
            ]),
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Authorization: Bearer ' . $key],
        ]);
        $raw  = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        $line('HTTP       ' . $code);
        $j = json_decode((string)$raw, true);
        $img = extractImage(is_array($j) ? $j : []);
        if ($img) {
            $line('RESULT     an image came back (' . strlen($img) . ' chars of data URL)');
            $line();
            $line('Everything works. The meme forge is ready.');
        } else {
            $said = $j['choices'][0]['message']['content'] ?? '';
            $line('RESULT     NO IMAGE');
            if (is_string($said) && $said !== '') {
                $line('           The model replied with text instead:');
                $line('           "' . substr(trim($said), 0, 200) . '"');
                $line('           That means it is a text model. Pick an image model above.');
            } else {
                $line('           Raw response, first 500 chars:');
                $line('           ' . substr(preg_replace('/\s+/', ' ', (string)$raw), 0, 500));
            }
        }
    } else {
        $line();
        $line('Add &image=1 to the URL to also run a real generation test.');
    }
    exit;
}

/**
 * Providers differ in where they put a generated image, so accept the common
 * shapes rather than betting on one. Returns a data/https URL, or null.
 */
function extractImage(array $j): ?string {
    $msg = $j['choices'][0]['message'] ?? [];
    if (!empty($msg['images'][0]['image_url']['url'])) return $msg['images'][0]['image_url']['url'];
    if (!empty($msg['images'][0]['url']))              return $msg['images'][0]['url'];
    if (is_array($msg['content'] ?? null)) {
        foreach ($msg['content'] as $part) {
            if (!empty($part['image_url']['url'])) return $part['image_url']['url'];
            if (($part['type'] ?? '') === 'output_image' && !empty($part['data'])) {
                return 'data:image/png;base64,' . $part['data'];
            }
        }
    }
    if (!empty($j['data'][0]['b64_json'])) return 'data:image/png;base64,' . $j['data'][0]['b64_json'];
    if (!empty($j['data'][0]['url']))      return $j['data'][0]['url'];
    return null;
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

$ch = curl_init(API_ROOT . PATH_CHAT);
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
$url = extractImage($j);

// Only ever return something that is definitely an image. The response is
// third-party text; a javascript: or data:text/html URL would end up in an
// <a href> on the page.
if ($url !== null && !preg_match('#^(data:image/[a-z.+-]+;base64,|https://)#i', $url)) {
    error_log('[robin-forge] refusing unexpected image URL scheme');
    $url = null;
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
