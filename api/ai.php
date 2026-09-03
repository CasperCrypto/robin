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

/**
 * How the key is sent. 'bearer' suits most providers; run
 * api/ai.php?selftest=1&probe=1 if yours rejects it.
 * One of: 'bearer' | 'x-api-key' | 'raw' | 'api-key'
 */
const AUTH_STYLE = 'bearer';

/** Endpoint paths appended to API_ROOT. */
const PATH_RESPONSES = '/responses';
const PATH_CHAT      = '/chat/completions';
const PATH_IMAGES    = '/images/generations';
const PATH_MODELS    = '/models';

/**
 * Which API shape this provider speaks.
 *   'responses' — POST /responses with `input` and an image_generation tool
 *                 (what a "Create response" endpoint in the docs means)
 *   'chat'      — POST /chat/completions with `messages` and `modalities`
 *   'auto'      — try 'responses', fall back to 'chat' if the path is missing
 * Run api/ai.php?selftest=1&probe=1 to see which one your provider has.
 */
const API_SHAPE = 'auto';

const MODEL      = 'google/gemini-2.5-flash-image';

/** Model used for written analysis. Any capable text model your key can reach. */
const AI_TEXT_MODEL = 'anthropic/claude-sonnet-4.5';
const REF_IMAGE  = __DIR__ . '/../assets/img/robin-logo.png';

const MAX_PROMPT = 400;
const RATE_MAX   = 8;      // image calls…
const RATE_WINDOW= 600;    // …per this many seconds, per IP
const TIMEOUT    = 120;

/**
 * `detail` is for whoever runs the site: the provider's own words, the endpoint
 * that was tried, what came back. It is shown behind a button rather than in
 * the visitor's face, and describes our own request rather than anyone's data.
 */
function fail(int $code, string $msg, array $detail = []): void {
    http_response_code($code);
    $out = ['error' => $msg];
    if ($detail) $out['detail'] = $detail;
    echo json_encode($out);
    exit;
}

/** The auth header for this provider, per AUTH_STYLE. */
function authHeader(string $key, ?string $style = null): string {
    switch ($style ?: AUTH_STYLE) {
        case 'x-api-key': return 'x-api-key: ' . $key;
        case 'raw':       return 'Authorization: ' . $key;
        case 'api-key':   return 'api-key: ' . $key;
        default:          return 'Authorization: Bearer ' . $key;
    }
}

const KEY_NAMES = ['ROBIN_AI_KEY', 'OPENROUTER_API_KEY', 'CONCENTRATE_API_KEY'];

function keyFromFile(string $file): string {
    if (!is_readable($file)) return '';
    $cfg = require $file;
    if (!is_array($cfg)) return '';
    foreach (KEY_NAMES as $n) {
        if (!empty($cfg[$n])) return trim((string)$cfg[$n]);
    }
    return '';
}

/**
 * Where the key came from, so the self-test can say which file is in play.
 * Order matters: config.local.php wins over config.php because config.php
 * ships in the zip and is overwritten by every upload. Put a rotated key in
 * config.local.php and no future upload can revert it.
 */
function apiKeySource(): array {
    foreach (KEY_NAMES as $n) {
        $v = getenv($n) ?: ($_SERVER[$n] ?? '');
        if ($v) return [trim((string)$v), 'environment variable ' . $n];
    }
    $k = keyFromFile(__DIR__ . '/config.local.php');
    if ($k !== '') return [$k, 'api/config.local.php'];

    $k = keyFromFile(__DIR__ . '/config.php');
    if ($k !== '') return [$k, 'api/config.php'];

    return ['', 'nowhere'];
}

function apiKey(): string {
    return apiKeySource()[0];
}

/* ══════════════════════════════════════════════════════════ discovery ══
   Providers disagree about the API root, the auth header and the request
   shape, and a wrong root frequently answers 401 rather than 404 — so a
   misconfiguration is indistinguishable from a bad key. Rather than make the
   operator work that out by hand, find the working combination once, cache it,
   and use it from then on.
   ---------------------------------------------------------------------- */

const DISCO_TTL = 86400;         // re-check once a day
const DISCO_TIMEOUT = 10;        // per probe request

function discoFile(): string {
    return sys_get_temp_dir() . '/robin_endpoint.json';
}

function discoLoad(): ?array {
    $f = discoFile();
    if (!is_readable($f) || filemtime($f) < time() - DISCO_TTL) return null;
    $j = json_decode((string)@file_get_contents($f), true);
    return (is_array($j) && !empty($j['root']) && !empty($j['shape'])) ? $j : null;
}

function discoSave(array $combo): void {
    @file_put_contents(discoFile(), json_encode($combo), LOCK_EX);
}

/**
 * Roots worth trying, configured one first. ROBIN_AI_ROOTS (comma separated)
 * can prepend your own, which is the quickest fix if your provider's root is
 * none of the guesses below.
 */
function candidateRoots(): array {
    $extra = getenv('ROBIN_AI_ROOTS') ?: '';
    $pre = array_filter(array_map('trim', explode(',', $extra)));
    return array_values(array_unique(array_merge($pre, [
        API_ROOT,
        'https://api.concentrate.ai/v1',
        'https://api.concentrate.ai/api/v1',
        'https://api.concentrate.ai',
        'https://concentrate.ai/api/v1',
        'https://concentrate.ai/v1',
        'https://concentrate.ai/api',
    ])));
}

function candidateAuths(): array {
    return array_values(array_unique([AUTH_STYLE, 'bearer', 'x-api-key', 'raw', 'api-key']));
}

/** GET a URL with one auth style. Returns [httpCode, body]. */
function probeGet(string $url, string $key, string $auth): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => DISCO_TIMEOUT,
        CURLOPT_HTTPHEADER => [authHeader($key, $auth), 'Accept: application/json'],
    ]);
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$code, $body === false ? '' : (string)$body];
}

/**
 * Work out root + auth + shape.
 *
 * Uses cheap GETs only: /models to find root and auth, then a GET against each
 * POST-only endpoint — 405/400/422 means it is there, 404 means it is not — so
 * discovery never spends a generation.
 */
function discover(string $key): ?array {
    foreach (candidateRoots() as $root) {
        $root = rtrim($root, '/');
        foreach (candidateAuths() as $auth) {
            [$code] = probeGet($root . PATH_MODELS, $key, $auth);
            if ($code !== 200) continue;

            $shape = null;
            foreach ([[PATH_RESPONSES, 'responses'], [PATH_CHAT, 'chat']] as [$path, $name]) {
                [$c] = probeGet($root . $path, $key, $auth);
                if (in_array($c, [400, 405, 422], true)) { $shape = $name; break; }
            }
            // Endpoints that answer 200 to a GET tell us nothing; assume the
            // documented shape rather than giving up.
            if (!$shape) $shape = (API_SHAPE === 'chat') ? 'chat' : 'responses';

            $combo = ['root' => $root, 'auth' => $auth, 'shape' => $shape];
            discoSave($combo);
            error_log('[robin-forge] discovered ' . json_encode($combo));
            return $combo;
        }
    }
    return null;
}

/** The combination to use: cached, else discovered, else the configured one. */
function endpoint(string $key, bool $forceRediscover = false): array {
    if (!$forceRediscover) {
        $c = discoLoad();
        if ($c) return $c;
    }
    $c = discover($key);
    if ($c) return $c;
    return ['root' => rtrim(API_ROOT, '/'), 'auth' => AUTH_STYLE,
            'shape' => (API_SHAPE === 'chat' ? 'chat' : 'responses'), 'guessed' => true];
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
    header('X-Accel-Buffering: no');       // stop nginx buffering the stream

    /* This walks a lot of endpoints, so it must survive a default 30-second
       execution limit AND show its work as it goes. Without flushing, a host
       that kills the script discards everything written so far — which looks
       exactly like the probe printing nothing at all. */
    @set_time_limit(300);
    @ini_set('output_buffering', '0');
    @ini_set('zlib.output_compression', '0');
    while (ob_get_level() > 0) { @ob_end_flush(); }
    @ob_implicit_flush(true);

    $line = function (string $l = '') {
        echo $l . "\n";
        @flush();
    };
    $line('$ROBIN meme forge — self test');
    $line(str_repeat('=', 46));
    $line();

    $key = apiKey();
    if ($key === '') {
        $line('KEY        MISSING');
        $line();
        $line('Set ROBIN_AI_KEY as an environment variable, or create');
        $line('api/config.local.php containing:');
        $line("    <?php return ['ROBIN_AI_KEY' => 'your-key'];");
        $line();
        $line('(config.local.php is preferred over config.php because it is never');
        $line(' shipped in the zip, so uploading a new build cannot overwrite it.)');
        exit;
    }
    $line('KEY        found (' . substr($key, 0, 8) . '…, ' . strlen($key) . ' chars)');
    $line('  from     ' . apiKeySource()[1]);
    if (apiKeySource()[1] === 'api/config.php') {
        $line('           note: config.php ships in the zip, so a future upload will');
        $line('           overwrite it. If you rotate the key, put the new one in');
        $line('           api/config.local.php instead — that file is never shipped.');
    }
    $line('CONFIGURED ' . API_ROOT . '  auth=' . AUTH_STYLE . '  shape=' . API_SHAPE);
    $cached = discoLoad();
    $line('DISCOVERED ' . ($cached
        ? $cached['root'] . '  auth=' . $cached['auth'] . '  shape=' . $cached['shape']
        : 'nothing cached yet'));
    $line('MODEL      ' . MODEL);
    $line('PHP        ' . PHP_VERSION . (function_exists('curl_init') ? ', cURL ok' : ', cURL MISSING'));
    $line('REF IMAGE  ' . (is_readable(REF_IMAGE) ? 'ok' : 'NOT READABLE at ' . REF_IMAGE));
    $line();

    /* ── probe mode ───────────────────────────────────────────────────
       Add &probe=1 when the key is being rejected. Providers differ in both
       the API root and the auth header they expect, and a wrong root often
       answers 401 rather than 404 — indistinguishable from a bad key. This
       tries the plausible combinations and prints what each one actually
       said, so the right pair is obvious rather than guessed at. */
    if (isset($_GET['probe'])) {
        $roots = [
            API_ROOT,
            'https://api.concentrate.ai/v1',
            'https://api.concentrate.ai',
            'https://concentrate.ai/api/v1',
            'https://concentrate.ai/v1',
        ];
        $auths = [
            'Authorization: Bearer'  => function ($k) { return ['Authorization: Bearer ' . $k]; },
            'x-api-key'              => function ($k) { return ['x-api-key: ' . $k]; },
            'Authorization: raw'     => function ($k) { return ['Authorization: ' . $k]; },
            'api-key'                => function ($k) { return ['api-key: ' . $k]; },
        ];

        $line('--- probing roots x auth styles against /models ---');
        $line('(looking for one that answers 200)');
        $line();
        $winner = null;
        $anyHttp = false;

        foreach (array_unique($roots) as $root) {
            foreach ($auths as $label => $mk) {
                // Printed before the request, so a hang shows where it stopped.
                echo '  ... ' . str_pad($label, 22) . ' ' . $root . "\r";
                @flush();

                $ch = curl_init(rtrim($root, '/') . PATH_MODELS);
                curl_setopt_array($ch, [
                    CURLOPT_RETURNTRANSFER => true,
                    CURLOPT_TIMEOUT => 6,
                    CURLOPT_CONNECTTIMEOUT => 4,
                    CURLOPT_HTTPHEADER => array_merge($mk($key), ['Accept: application/json']),
                ]);
                $raw  = curl_exec($ch);
                $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
                $cerr = curl_error($ch);
                curl_close($ch);

                $tag = str_pad($code ?: 'ERR', 4);
                $note = '';
                if ($raw === false) {
                    $note = $cerr;
                } else {
                    $j = json_decode((string)$raw, true);
                    $note = $j['error']['message']
                        ?? $j['message']
                        ?? $j['detail']
                        ?? (is_array($j) ? '' : substr(preg_replace('/\s+/', ' ', (string)$raw), 0, 90));
                    if ($code === 200 && !$winner) {
                        $winner = ['root' => $root, 'auth' => $label];
                        $n = is_array($j['data'] ?? null) ? count($j['data']) : '?';
                        $note = 'OK — ' . $n . ' models';
                    }
                }
                $line('  ' . $tag . ' ' . str_pad($label, 22) . ' ' . $root);
                if ($note !== '') $line('       ' . substr((string)$note, 0, 150));

                // No HTTP answer at all means the host is unreachable from this
                // server — the other three auth headers will fare no better.
                if ($code === 0) {
                    $line('       (no HTTP response — skipping the other auth styles for this root)');
                    break;
                }
                $anyHttp = true;
            }
        }

        // Which endpoints exist? A GET on a POST-only path answers 405 if it is
        // there and 404 if it is not — a free existence check.
        if ($winner) {
            $line();
            $line('--- endpoints at ' . $winner['root'] . ' ---');
            foreach ([PATH_RESPONSES, PATH_CHAT] as $path) {
                $ch = curl_init(rtrim($winner['root'], '/') . $path);
                curl_setopt_array($ch, [
                    CURLOPT_RETURNTRANSFER => true,
                    CURLOPT_TIMEOUT => 6,
                    CURLOPT_CONNECTTIMEOUT => 4,
                    CURLOPT_HTTPHEADER => [authHeader($key), 'Accept: application/json'],
                ]);
                curl_exec($ch);
                $c = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
                curl_close($ch);
                $verdict = ($c === 404) ? 'NOT present'
                         : (($c === 405 || $c === 400 || $c === 422) ? 'present' : 'HTTP ' . $c);
                $line('  ' . str_pad($path, 20) . $verdict);
                if ($verdict === 'present') {
                    $line('       -> set API_SHAPE to \''
                        . ($path === PATH_RESPONSES ? 'responses' : 'chat') . '\'');
                }
            }
        }

        $line();
        if ($winner) {
            $line('>>> WORKING COMBINATION FOUND');
            $line('    API root : ' . $winner['root']);
            $line('    Auth     : ' . $winner['auth']);
            $line();
            $line('    Set API_ROOT at the top of api/ai.php to that root.');
            if ($winner['auth'] !== 'Authorization: Bearer') {
                $line('    Also set AUTH_STYLE to: ' . $winner['auth']);
            }
        } elseif (!$anyHttp) {
            $line('>>> No host answered at all.');
            $line();
            $line('    Not one request got an HTTP response, so this is a network problem');
            $line('    on the server, not a key or endpoint problem. Your host is blocking');
            $line('    outbound HTTPS from PHP.');
            $line();
            $line('    On InMotion and most cPanel hosts this is fixed by asking support to');
            $line('    allow outbound connections on port 443 for your account, or to');
            $line('    whitelist the API domain. Quote them this line:');
            $line('        "PHP cURL cannot make outbound HTTPS requests to external APIs"');
        } else {
            $line('>>> Answers came back, but none was a 200.');
            $line();
            $line('    The server can reach the internet, so this is the key or the root:');
            $line('      * 401 / 403 everywhere  -> the key is wrong, inactive or out of credit');
            $line('      * 404 everywhere        -> the API root is none of the five tried;');
            $line('                                 take it from your provider docs and set');
            $line('                                 API_ROOT, or the ROBIN_AI_ROOTS env var');
            $line('    Read the provider messages above — they usually say which.');
        }
        exit;
    }

    // ── can we list models? ──────────────────────────────────────────────
    $line('--- ' . API_ROOT . PATH_MODELS . ' ---');
    $ch = curl_init(API_ROOT . PATH_MODELS);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_HTTPHEADER => [authHeader($key), 'Accept: application/json'],
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
        $ep = endpoint($key, true);
        $line('USING      ' . $ep['root'] . '  auth=' . $ep['auth'] . '  shape=' . $ep['shape']
              . (!empty($ep['guessed']) ? '   (guessed — discovery found nothing)' : '   (discovered)'));

        $prompt = 'Draw a simple flat green circle on a white background.';
        $won = false;

        foreach (shapeOrder($ep['shape']) as $shape) {
            $try = array_merge($ep, ['shape' => $shape]);
            $path = $shape === 'chat' ? PATH_CHAT
                  : ($shape === 'images' ? PATH_IMAGES : PATH_RESPONSES);

            $line();
            $line(strtoupper($shape) . '  POST ' . $ep['root'] . $path);
            [$c, $jj, $raw, $ce] = attempt($try, $key, MODEL, $prompt, null);

            if ($raw === false) { $line('  ERR      ' . $ce); break; }
            $line('  HTTP     ' . $c);

            $img = extractImage(is_array($jj) ? $jj : []);
            if ($c === 200 && $img) {
                $line('  RESULT   an image came back (' . strlen($img) . ' chars)');
                $line();
                $line('>>> THIS SHAPE WORKS: ' . $shape);
                $line('    The site has cached it; nothing needs changing.');
                discoSave($try);
                $won = true;
                break;
            }

            $err  = $jj['error']['message'] ?? $jj['message'] ?? '';
            $said = is_string($jj['choices'][0]['message']['content'] ?? null)
                  ? $jj['choices'][0]['message']['content'] : '';
            if ($err)  $line('  SAID     ' . substr($err, 0, 300));
            if ($said) $line('  TEXT     "' . substr(trim($said), 0, 200) . '"');
            if (!$err && !$said) {
                $line('  RAW      ' . substr(preg_replace('/\s+/', ' ', (string)$raw), 0, 300));
            }
            if ($c === 429 || $c >= 500) break;
        }

        if (!$won) {
            $line();
            $line('>>> No shape produced an image.');
            $line();
            $line('    Read the provider messages above. The usual causes:');
            $line('      * "model not found" / "unknown model"');
            $line('           -> ai.model in assets/js/config.js names a model this');
            $line('              provider does not serve. Pick one from the list above.');
            $line('      * "does not support tools" / "unknown parameter"');
            $line('           -> the model is text-only. You need one that outputs images.');
            $line('      * every shape 404s');
            $line('           -> this provider may not offer image generation at all.');
        }
    } else {
        $line();
        $line('Add &image=1 to the URL to also run a real generation test.');
    }
    exit;
}

/**
 * Build the request body for the Responses API: a single user turn carrying
 * the prompt and the reference artwork, with image generation offered as a
 * tool the model can call.
 */
function bodyResponses(string $model, string $text, ?string $refDataUrl): array {
    $content = [['type' => 'input_text', 'text' => $text]];
    if ($refDataUrl) {
        $content[] = ['type' => 'input_image', 'image_url' => $refDataUrl];
    }
    return [
        'model' => $model,
        'input' => [['role' => 'user', 'content' => $content]],
        'tools' => [['type' => 'image_generation']],
    ];
}

/**
 * Build the request body for the plain images endpoint. It takes no reference
 * image, so the character has to be carried by the words alone — which is why
 * the style prompt describes him in full rather than relying on the artwork.
 */
function bodyImages(string $model, string $text): array {
    return [
        'model' => $model,
        'prompt' => $text,
        'n' => 1,
        'size' => '1024x1024',
        'response_format' => 'b64_json',
    ];
}

/** Build the request body for the Chat Completions API. */
function bodyChat(string $model, string $text, ?string $refDataUrl): array {
    $content = [['type' => 'text', 'text' => $text]];
    if ($refDataUrl) {
        $content[] = ['type' => 'image_url', 'image_url' => ['url' => $refDataUrl]];
    }
    return [
        'model' => $model,
        'modalities' => ['image', 'text'],
        'messages' => [['role' => 'user', 'content' => $content]],
    ];
}

/** One POST, returning [httpCode, decodedJson, rawBody, curlError]. */
function post(string $url, string $key, array $payload, int $timeout = TIMEOUT,
              ?string $auth = null): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_POSTFIELDS => json_encode($payload),
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', authHeader($key, $auth)],
    ]);
    $raw  = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);
    return [$code, json_decode((string)$raw, true), $raw, $err];
}

/**
 * Providers differ in where they put a generated image, so accept the common
 * shapes rather than betting on one. Returns a data/https URL, or null.
 */
function extractImage(array $j): ?string {
    // Responses API: an image_generation_call carries base64 in `result`.
    if (is_array($j['output'] ?? null)) {
        foreach ($j['output'] as $item) {
            if (!is_array($item)) continue;
            if (($item['type'] ?? '') === 'image_generation_call' && !empty($item['result'])) {
                return 'data:image/png;base64,' . $item['result'];
            }
            if (is_array($item['content'] ?? null)) {
                foreach ($item['content'] as $part) {
                    if (($part['type'] ?? '') === 'output_image' && !empty($part['image_url'])) {
                        return $part['image_url'];
                    }
                    if (!empty($part['image_url']['url'])) return $part['image_url']['url'];
                }
            }
        }
    }

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

/* When another endpoint requires this file it wants the helpers above and
   nothing else — no rate limiting, no reading a request body, no upstream
   call. Everything below this line is the meme-forge endpoint proper. */
if (defined('ROBIN_LIB_ONLY')) return;

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
    fail(429, 'That is a lot of memes. Give it a couple of minutes.',
              ['limit' => 'this site, ' . RATE_MAX . ' per ' . RATE_WINDOW . 's per visitor']);
}

$body = json_decode((string)file_get_contents('php://input'), true);
if (!is_array($body)) fail(400, 'Bad request body');

$prompt = mb_substr(trim((string)($body['prompt'] ?? '')), 0, MAX_PROMPT);
if ($prompt === '') fail(400, 'Tell it what to draw first.');

$key = apiKey();
if ($key === '') {
    fail(503, 'Robin AI is not switched on yet — the site owner needs to add an API key. '
            . '(Owner: open api/ai.php?selftest=1 to see exactly what is missing.)');
}

// count the attempt only once we know we are really going to call out
$hits[] = $now;
@file_put_contents($bucket, json_encode($hits), LOCK_EX);

// ── build the request ─────────────────────────────────────────────────────
$style = "You are illustrating official artwork for the \$ROBIN (Robin Nakamoto) memecoin.\n\n"
    . "THE CHARACTER: a cartoon Shiba Inu with cream and tan fur, wearing a bright green\n"
    . "Robin Hood hat with an upturned brim and a single white feather, and thick black\n"
    . "rectangular glasses. Friendly, slightly smug expression. If a reference image is\n"
    . "attached, match it exactly; otherwise draw him from this description.\n\n"
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

// Reference artwork, so the generated dog is always this dog.
$ref = null;
if (is_readable(REF_IMAGE)) {
    $raw = @file_get_contents(REF_IMAGE);
    if ($raw !== false && strlen($raw) < 6_000_000) {
        $ref = 'data:image/png;base64,' . base64_encode($raw);
    }
}

$model = (string)($body['model'] ?? '') ?: MODEL;

/**
 * Send one attempt with a given combination.
 * Returns [httpCode, decodedJson, rawBody, curlError].
 */
function attempt(array $ep, string $key, string $model, string $style, ?string $ref): array {
    switch ($ep['shape']) {
        case 'chat':
            return post($ep['root'] . PATH_CHAT, $key, bodyChat($model, $style, $ref),
                        TIMEOUT, $ep['auth']);
        case 'images':
            return post($ep['root'] . PATH_IMAGES, $key, bodyImages($model, $style),
                        TIMEOUT, $ep['auth']);
        default:
            return post($ep['root'] . PATH_RESPONSES, $key, bodyResponses($model, $style, $ref),
                        TIMEOUT, $ep['auth']);
    }
}

/** Every shape, starting with the one we believe in. */
function shapeOrder(string $first): array {
    $all = ['responses', 'chat', 'images'];
    return array_values(array_unique(array_merge([$first], $all)));
}

$ep = endpoint($key);

/*
 * Providers disagree about how to ask for a picture, and a wrong guess comes
 * back as a 400 just as readily as a 404 — "unknown parameter", "this model
 * does not support tools", "no such route". So try each shape in turn and keep
 * the first that works, remembering it for next time.
 *
 * Every rejection is kept, because the provider's own wording is the only
 * thing that actually explains a failure, and it is what the owner needs to
 * see when none of them work.
 */
$attempts = [];
$code = 0; $j = null; $rawBody = ''; $cerr = '';

foreach (shapeOrder($ep['shape']) as $shape) {
    $try = array_merge($ep, ['shape' => $shape]);
    [$code, $j, $rawBody, $cerr] = attempt($try, $key, $model, $style, $ref);

    if ($rawBody === false) break;                     // network, not shape

    if ($code === 200 && extractImage(is_array($j) ? $j : [])) {
        $ep = $try;
        discoSave($ep);                                // this one works; remember it
        break;
    }

    $why = $j['error']['message'] ?? $j['message'] ?? ('HTTP ' . $code);
    $attempts[] = $shape . ': ' . $code . ' ' . substr((string)$why, 0, 160);
    error_log('[robin-forge] ' . $shape . ' -> ' . $code . ' ' . $why);

    // A 429 or 5xx is about load, not shape — no point trying the others.
    if ($code === 429 || $code >= 500) break;
}

/* A 5xx or a timeout is usually a blip. Wait a moment and go once more with
   the same shape before bothering anyone about it. */
if ($rawBody === false || $code >= 500) {
    sleep(2);
    [$code, $j, $rawBody, $cerr] = attempt($ep, $key, $model, $style, $ref);
    if ($code === 200 && extractImage(is_array($j) ? $j : [])) {
        $attempts[] = 'recovered on retry';
    }
}

$ctx = [
    'root' => $ep['root'], 'auth' => $ep['auth'], 'shape' => $ep['shape'],
    'model' => $model, 'status' => $code, 'attempts' => $attempts,
];

if ($rawBody === false) {
    fail(502, 'Could not reach the image service.', $ctx + ['curl' => $cerr]);
}

if ($code !== 200) {
    if ($code === 429) {
        fail(429, 'Your provider is rate-limiting us. Wait a minute and try again.', $ctx);
    }
    if ($code === 401 || $code === 403) {
        fail(502, 'The image service refused the request.', $ctx);
    }
    if ($code >= 500) {
        fail(502, 'Your provider returned a server error, twice. It may be down.', $ctx);
    }

    /* A 4xx here is a configuration problem — a model that cannot draw, an
       unsupported parameter, a name the provider does not know. Those messages
       name the fix, so pass them through rather than hiding them behind
       something vague. They describe our own request, not anyone's data. */
    fail(502, 'Image generation was rejected. ' . implode(' | ', $attempts), $ctx);
}

// ── pull the image out of the response ────────────────────────────────────
$url = extractImage(is_array($j) ? $j : []);

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
        ? 'That model replied with words instead of a picture — it is a text model. '
          . 'Point ai.model at one that outputs images.'
        : 'No image came back.',
        ($ctx ?? []) + ['replied' => mb_substr($said, 0, 300)]);
}

echo json_encode(['image' => $url, 'model' => $j['model'] ?? MODEL], JSON_UNESCAPED_SLASHES);
