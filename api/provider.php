<?php
/**
 * provider.php — the connection to your AI provider.
 *
 * Finds your key, works out which API your provider actually speaks, and makes
 * one text request. Nothing here decides anything about a token; that is
 * scan.php's job. This file only carries words back and forth, and keeps your
 * API key on the server where it belongs.
 *
 * SETUP — pick one:
 *   1. Environment variable:  ROBIN_AI_KEY=sk-...
 *   2. Or create api/config.php next to this file:
 *        <?php return ['ROBIN_AI_KEY' => 'sk-...'];
 *      (api/config.php is git-ignored — never commit your key.)
 *
 * The site works without a key. The scanner's checks are all computed from
 * chain data; the key only buys the plain-English paragraph on top of them.
 *
 * Check your setup by opening  api/provider.php?selftest=1  in a browser.
 * Add &live=1 to spend one real request and prove the whole path works.
 *
 * Requires PHP 7.4+ with cURL.
 */

declare(strict_types=1);

// ── config ────────────────────────────────────────────────────────────────
/**
 * Your provider's API root, WITHOUT a trailing slash and without an endpoint
 * path. Everything else is derived from it. If your docs show a different
 * root, this is the only line you need to change — and discovery below will
 * probably find it anyway.
 */
const API_ROOT = 'https://api.concentrate.ai/api/v1';

/**
 * How the key is sent. 'bearer' suits most providers.
 * One of: 'bearer' | 'x-api-key' | 'raw' | 'api-key'
 */
const AUTH_STYLE = 'bearer';

/** Endpoint paths appended to API_ROOT. */
const PATH_RESPONSES = '/responses';
const PATH_CHAT      = '/chat/completions';
const PATH_MODELS    = '/models';

/**
 * Which API shape this provider speaks.
 *   'responses' — POST /responses with `input`   (a "Create response" endpoint)
 *   'chat'      — POST /chat/completions with `messages`
 *   'auto'      — try both and keep whichever answers
 */
const API_SHAPE = 'auto';

/** Any capable text model your key can reach. */
const AI_TEXT_MODEL = 'anthropic/claude-sonnet-4.5';

const TIMEOUT = 45;

/** The auth header for this provider, per AUTH_STYLE. */
function authHeader(string $key, ?string $style = null): string {
    switch ($style ?: AUTH_STYLE) {
        case 'x-api-key': return 'x-api-key: ' . $key;
        case 'raw':       return 'Authorization: ' . $key;
        case 'api-key':   return 'api-key: ' . $key;
        default:          return 'Authorization: Bearer ' . $key;
    }
}

// ── the key ───────────────────────────────────────────────────────────────
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

function apiKey(): string { return apiKeySource()[0]; }

/* ══════════════════════════════════════════════════════════ discovery ══
   Providers disagree about the API root, the auth header and the request
   shape, and a wrong root frequently answers 401 rather than 404 — so a
   misconfiguration is indistinguishable from a bad key. Rather than make the
   operator work that out by hand, find the working combination once, cache it,
   and use it from then on.
   ---------------------------------------------------------------------- */

const DISCO_TTL     = 86400;     // re-check once a day
const DISCO_TIMEOUT = 10;        // per probe request

function discoFile(): string { return sys_get_temp_dir() . '/robin_endpoint.json'; }

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
 * discovery never spends a request.
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
            error_log('[robin] discovered provider ' . json_encode($combo));
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

// ── the request ───────────────────────────────────────────────────────────
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

/** Try the discovered shape first, then the other one. */
function shapeOrder(string $preferred): array {
    $all = ['responses', 'chat'];
    return array_values(array_unique(array_merge([$preferred], $all)));
}

function bodyFor(string $shape, string $model, string $prompt): array {
    return $shape === 'responses'
        ? ['model' => $model, 'input' => [['role' => 'user',
             'content' => [['type' => 'input_text', 'text' => $prompt]]]]]
        : ['model' => $model, 'messages' => [['role' => 'user', 'content' => $prompt]]];
}

/** Pull the text out of whichever shape answered. */
function extractText(array $j): ?string {
    if (is_array($j['output'] ?? null)) {          // Responses API
        foreach ($j['output'] as $item) {
            foreach (($item['content'] ?? []) as $part) {
                if (!empty($part['text'])) return trim((string)$part['text']);
            }
        }
    }
    if (!empty($j['output_text'])) {
        return is_array($j['output_text'])
            ? trim(implode('', $j['output_text']))
            : trim((string)$j['output_text']);
    }
    $t = $j['choices'][0]['message']['content'] ?? null;   // chat completions
    return (is_string($t) && $t !== '') ? trim($t) : null;
}

/** The provider's own words, wherever it chose to put them. */
function providerMessage($j, string $raw): string {
    if (is_array($j)) {
        foreach ([['error','message'], ['error'], ['message'], ['detail']] as $path) {
            $v = $j;
            foreach ($path as $k) { $v = is_array($v) ? ($v[$k] ?? null) : null; }
            if (is_string($v) && $v !== '') return $v;
        }
    }
    return trim(substr($raw, 0, 300));
}

/**
 * Ask the model one question.
 *
 * Returns ['text' => string|null, 'error' => string|null, 'detail' => array].
 *
 * Two behaviours worth knowing about. A 400/404/405 means "wrong shape for
 * this provider", so the next shape is tried rather than the whole thing
 * failing — that misreading is what once produced a flat refusal on a key that
 * worked perfectly. A 5xx is the provider having a bad moment, so it gets one
 * quiet retry before anything is reported.
 */
function askText(string $prompt, ?string $model = null, int $timeout = TIMEOUT): array {
    $key = apiKey();
    if ($key === '') {
        return ['text' => null, 'error' => 'No API key is configured.', 'detail' => []];
    }
    $model = $model ?: AI_TEXT_MODEL;
    $ep = endpoint($key);
    $tried = [];

    foreach (shapeOrder($ep['shape']) as $shape) {
        $path = $shape === 'responses' ? PATH_RESPONSES : PATH_CHAT;
        $url  = $ep['root'] . $path;

        [$code, $j, $raw, $curlErr] = post($url, $key, bodyFor($shape, $model, $prompt), $timeout, $ep['auth']);

        // One quiet retry for a provider having a bad moment.
        if ($code >= 500) {
            [$code, $j, $raw, $curlErr] = post($url, $key, bodyFor($shape, $model, $prompt), $timeout, $ep['auth']);
            if ($code >= 500) {
                $tried[] = ['shape' => $shape, 'url' => $url, 'status' => $code,
                            'said' => providerMessage($j, (string)$raw), 'note' => 'server error, twice'];
                continue;
            }
        }

        if ($code === 200) {
            $text = is_array($j) ? extractText($j) : null;
            if ($text !== null && $text !== '') {
                if ($shape !== $ep['shape']) {
                    discoSave(['root' => $ep['root'], 'auth' => $ep['auth'], 'shape' => $shape]);
                }
                // Carry the failed attempts along even on success: "it works,
                // and here is what it had to step over to get there" is what
                // the operator actually needs when a provider is misbehaving.
                return ['text' => $text, 'error' => null,
                        'detail' => ['shape' => $shape, 'tried' => $tried]];
            }
            $tried[] = ['shape' => $shape, 'url' => $url, 'status' => 200,
                        'said' => 'answered, but with no text in it'];
            continue;
        }

        $tried[] = ['shape' => $shape, 'url' => $url, 'status' => $code,
                    'said' => $curlErr !== '' ? $curlErr : providerMessage($j, (string)$raw)];

        // Anything other than "wrong shape" is not going to be fixed by
        // trying a different endpoint on the same provider.
        if (!in_array($code, [400, 404, 405, 422], true)) break;
    }

    $last = end($tried) ?: [];
    return [
        'text'  => null,
        'error' => ($last['status'] ?? 0) === 401 || ($last['status'] ?? 0) === 403
                   ? 'The API key was rejected.'
                   : 'The model did not answer.',
        'detail' => ['tried' => $tried],
    ];
}

// ── self-test ─────────────────────────────────────────────────────────────
/**
 * Open  api/provider.php?selftest=1        to check the setup.
 * Add   &live=1                            to spend one real request.
 *
 * Reports where the key was found, which root and auth header answered, which
 * shape the provider speaks, and — with &live=1 — whether a real question
 * comes back answered. The key is never printed beyond its first characters,
 * so you can tell which one is loaded without exposing it.
 */
if (isset($_GET['selftest'])) {
    header('Content-Type: text/plain; charset=utf-8');
    header('X-Accel-Buffering: no');       // stop nginx buffering the stream

    /* This walks several endpoints, so it must survive a default execution
       limit AND show its work as it goes. Without flushing, a host that kills
       the script mid-probe throws away the buffer and prints nothing at all —
       which looks exactly like a blank page. */
    @set_time_limit(300);
    @ini_set('zlib.output_compression', '0');
    while (ob_get_level() > 0) { ob_end_flush(); }
    ob_implicit_flush(true);

    $line = function (string $s = '') { echo $s . "\n"; @flush(); };

    $line('$ROBIN provider self-test');
    $line(str_repeat('=', 46));

    [$key, $where] = apiKeySource();
    if ($key === '') {
        $line('KEY      not found');
        $line();
        $line('Set ROBIN_AI_KEY in the environment, or create api/config.php:');
        $line('  <?php return [\'ROBIN_AI_KEY\' => \'sk-...\'];');
        $line();
        $line('The site works without one. Only the scanner\'s written summary');
        $line('needs it — every check it reports is computed without a model.');
        exit;
    }
    $line('KEY      found in ' . $where);
    $line('         starts ' . substr($key, 0, 8) . '…  (' . strlen($key) . ' chars)');
    $line();

    $line('--- finding your provider ---');
    $ep = endpoint($key, true);
    if (!empty($ep['guessed'])) {
        $line('  no root answered; falling back to the configured one');
        $line('  root=' . $ep['root'] . '  auth=' . $ep['auth'] . '  shape=' . $ep['shape']);
        $line();
        $line('Nothing accepted this key. Either the key is wrong, or your');
        $line('provider\'s API root is none of the ones tried. Set it with');
        $line('ROBIN_AI_ROOTS, or edit API_ROOT at the top of this file.');
        exit;
    }
    $line('  root=' . $ep['root']);
    $line('  auth=' . $ep['auth']);
    $line('  shape=' . $ep['shape']);
    $line('  cached in ' . discoFile());
    $line();

    if (!isset($_GET['live'])) {
        $line('Add &live=1 to the URL to spend one real request and prove it end to end.');
        exit;
    }

    $line('--- live request (this costs one call) ---');
    $line('  model=' . AI_TEXT_MODEL);
    $r = askText('Reply with exactly: ROBIN OK', null, 40);

    foreach (($r['detail']['tried'] ?? []) as $t) {
        $line('  tried ' . $t['shape'] . ' -> ' . $t['status']
              . (isset($t['note']) ? ' (' . $t['note'] . ')' : ''));
        if (!empty($t['said'])) $line('        said: ' . $t['said']);
    }

    if ($r['text'] !== null) {
        $line('  THIS SHAPE WORKS: ' . ($r['detail']['shape'] ?? '?'));
        $line('  RESULT   the model answered: ' . substr($r['text'], 0, 120));
        $line();
        $line('Everything is working. The scanner will write its summaries.');
    } else {
        $line();
        $line('>>> ' . $r['error']);
        $line();
        $line('Copy the block below if you need to ask your provider about it:');
        $line(json_encode(['error' => $r['error']] + $r['detail'], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
    }
    exit;
}
