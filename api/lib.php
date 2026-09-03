<?php
/**
 * lib.php — the bits the scanner needs beyond the provider connection: HTTP,
 * rate limiting, formatting, and the one call that asks a language model to
 * explain a set of findings it is not allowed to overturn.
 */

declare(strict_types=1);

/** Fail with a JSON body and stop. */
function jfail(int $code, string $msg, array $detail = []): void {
    http_response_code($code);
    $out = ['error' => $msg];
    if ($detail) $out['detail'] = $detail;
    echo json_encode($out);
    exit;
}

/** Per-IP token bucket, shared by every endpoint that costs money. */
function rateLimited(string $bucketName, int $max, int $window): bool {
    $ip = $_SERVER['HTTP_CF_CONNECTING_IP'] ?? $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    $file = sys_get_temp_dir() . '/robin_' . $bucketName . '_' . sha1($ip) . '.json';
    $now  = time();

    $hits = [];
    if (is_readable($file)) {
        $j = json_decode((string)@file_get_contents($file), true);
        if (is_array($j)) $hits = $j;
    }
    $hits = array_values(array_filter($hits, fn($t) => is_int($t) && $t > $now - $window));
    if (count($hits) >= $max) return true;

    $hits[] = $now;
    @file_put_contents($file, json_encode($hits), LOCK_EX);
    return false;
}

/**
 * GET some JSON, or null. Never throws — a missing source is a finding, not a crash.
 *
 * $status comes back as the HTTP code, or 0 when the request never got an
 * answer at all. Callers need that difference: a 404 from the explorer is a
 * real answer ("no such record"), while a timeout means we know nothing.
 */
function getJson(string $url, int $timeout = 12, ?int &$status = null): ?array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_CONNECTTIMEOUT => 6,
        CURLOPT_HTTPHEADER => ['Accept: application/json'],
        CURLOPT_USERAGENT => 'robin-scanner/1.0',
    ]);
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $status = $body === false ? 0 : $code;
    if ($body === false || $code !== 200) return null;
    $j = json_decode((string)$body, true);
    return is_array($j) ? $j : null;
}

/** Compact USD for prose. */
function usdShort(?float $n): string {
    if ($n === null) return 'unknown';
    if ($n >= 1e9) return '$' . round($n / 1e9, 2) . 'B';
    if ($n >= 1e6) return '$' . round($n / 1e6, 2) . 'M';
    if ($n >= 1e3) return '$' . round($n / 1e3, 1) . 'K';
    return '$' . round($n, 2);
}

/**
 * Ask the model to explain findings that were already decided.
 *
 * It is given the verdict and the facts and asked to write the paragraph a
 * knowledgeable friend would say out loud. It is explicitly told not to
 * overturn the verdict, because the verdict came from arithmetic and the model
 * has no better information than the numbers it was handed.
 *
 * Returns null on any failure — the report stands on its own without prose.
 */
function summarise(array $report): ?string {
    if (!function_exists('askText') || apiKey() === '') return null;

    $facts = [];
    foreach ($report['findings'] as $f) {
        $facts[] = strtoupper($f['level']) . ': ' . $f['what'] . ' — ' . $f['why'];
    }

    $s = $report['stats'];
    $prompt =
        "You are Robin, the assistant on a token safety scanner for Robinhood Chain.\n\n"
      . "TOKEN: " . ($report['name'] ?? 'unknown') . " (" . ($report['symbol'] ?? '?') . ")\n"
      . "VERDICT ALREADY DECIDED: " . $report['label'] . "\n\n"
      . "FINDINGS (computed from on-chain data, all true):\n- " . implode("\n- ", $facts) . "\n\n"
      . "NUMBERS: price " . usdShort($s['price'] ?? null)
      . ", market cap " . usdShort($s['mcap'] ?? null)
      . ", liquidity " . usdShort($s['liquidity'] ?? null)
      . ", 24h volume " . usdShort($s['volume24h'] ?? null)
      . ", holders " . ($s['holders'] ?? 'unknown') . "\n\n"
      . "Write 2-3 sentences a knowledgeable friend would say out loud about this token.\n"
      . "RULES:\n"
      . "- Do not contradict the verdict. It came from arithmetic, not opinion.\n"
      . "- Do not invent any number or fact that is not above.\n"
      . "- Say what would actually worry someone, or why it looks fine. Be specific.\n"
      . "- Never tell anyone to buy or sell. This is a safety read, not advice.\n"
      . "- Plain language, no headings, no bullet points, no hedging filler.";

    $r = askText($prompt, null, 45);
    if ($r['text'] === null) {
        error_log('[robin-scan] summary unavailable: ' . $r['error']);
        return null;
    }
    return $r['text'];
}
