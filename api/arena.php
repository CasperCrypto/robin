<?php
/**
 * arena.php — the Robin Arena round engine.
 *
 * The game: back-to-back five-minute rounds on the $ROBIN price. While one
 * round is running, entry is open for the next, so a player is always watching
 * one and queued for the following. Pick UP or DOWN. Robin picks too, and his
 * record is public — the hook is beating him, not predicting a chart.
 *
 * ── Three decisions worth reading before changing anything ────────────────
 *
 * 1. NOBODY DEPOSITS ANYTHING. Entry is gated by *holding* $ROBIN, checked
 *    server-side with balanceOf. That means no custody, no pot, and no
 *    private key anywhere near this server — which is the only responsible
 *    answer while the site runs on shared hosting. It still costs real money
 *    to farm the leaderboard with fake wallets, and a bigger bag scores
 *    faster, so the token still does work. Swapping in real pots later means
 *    changing settle() and nothing else; the front end never knew.
 *
 * 2. ROUNDS ARE CLOCK SLOTS, NOT RECORDS. Round id is floor(time / ROUND_SEC),
 *    so every visitor agrees on which round is live without anything having to
 *    create it. No cron is required: the first request after a round ends is
 *    what settles it.
 *
 * 3. A ROUND WITH NO PRICE VOIDS. Prices are snapshotted on every poll, and
 *    settlement uses the snapshot nearest the boundary. If there is none close
 *    enough — nobody was on the site — the round is void and nobody wins or
 *    loses. Settling a game on a price we had to guess at would be worse than
 *    not settling it at all.
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

require_once __DIR__ . '/lib.php';
require_once __DIR__ . '/provider.php';

const ROUND_SEC   = 300;      // one round
const TICK_MAX_AGE= 20;       // refresh the price if the newest tick is older
const SNAP_WINDOW = 100;      // a boundary price must be within this many seconds
const HISTORY     = 12;       // rounds kept on the board

const TOKEN   = '0x280413fbF06CcC1114094A5967dB2191d49EE75e';
const DECIMALS= 18;
const RPC_URL = 'https://rpc.mainnet.chain.robinhood.com';
const DS_URL  = 'https://api.dexscreener.com/latest/dex/tokens/';

/** Balance tiers. First match from the top wins. */
const TIERS = [
    ['name' => 'Sheriff', 'min' => 5000000, 'mult' => 3.0],
    ['name' => 'Outlaw',  'min' => 1000000, 'mult' => 2.0],
    ['name' => 'Archer',  'min' =>  250000, 'mult' => 1.5],
    ['name' => 'Scout',   'min' =>   50000, 'mult' => 1.0],
];
const BASE_POINTS = 100;

/* Test hooks: point the engine at a mock chain and a fake clock. */
function cfg(string $k, string $d): string { $v = getenv($k); return $v === false || $v === '' ? $d : $v; }
function now(): int {
    $t = getenv('ARENA_NOW');
    return ($t !== false && $t !== '') ? (int)$t : time();
}
function rpcUrl(): string { return cfg('ARENA_RPC', RPC_URL); }
function dsUrl(): string  { return cfg('ARENA_DS', DS_URL); }

/* ── storage ───────────────────────────────────────────────────────────── */
function db(): PDO {
    static $pdo = null;
    if ($pdo) return $pdo;

    if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
        jfail(500, 'The arena needs PDO SQLite, which this server does not have. '
                 . 'Ask your host to enable the pdo_sqlite extension.');
    }
    $dir = cfg('ARENA_DIR', __DIR__ . '/data');
    if (!is_dir($dir)) @mkdir($dir, 0700, true);

    $pdo = new PDO('sqlite:' . $dir . '/arena.sqlite');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->exec('PRAGMA journal_mode=WAL');       // survives concurrent visitors
    $pdo->exec('PRAGMA busy_timeout=4000');
    $pdo->exec('
      CREATE TABLE IF NOT EXISTS rounds(
        id INTEGER PRIMARY KEY, status TEXT NOT NULL,
        lock_price REAL, settle_price REAL,
        robin_side TEXT, robin_note TEXT, robin_won INTEGER,
        settled_at INTEGER);
      CREATE TABLE IF NOT EXISTS entries(
        round_id INTEGER NOT NULL, addr TEXT NOT NULL, side TEXT NOT NULL,
        tier TEXT NOT NULL, mult REAL NOT NULL, at INTEGER NOT NULL,
        won INTEGER, points INTEGER,
        PRIMARY KEY(round_id, addr));
      CREATE TABLE IF NOT EXISTS players(
        addr TEXT PRIMARY KEY, points INTEGER DEFAULT 0, wins INTEGER DEFAULT 0,
        played INTEGER DEFAULT 0, streak INTEGER DEFAULT 0, best INTEGER DEFAULT 0,
        tier TEXT, seen INTEGER);
      CREATE TABLE IF NOT EXISTS ticks(t INTEGER PRIMARY KEY, price REAL NOT NULL);
    ');
    return $pdo;
}

/* ── the clock ─────────────────────────────────────────────────────────── */
function liveId(): int { return intdiv(now(), ROUND_SEC); }   // running now
function openId(): int { return liveId() + 1; }               // taking entries
function startOf(int $id): int { return $id * ROUND_SEC; }

/* ── price ─────────────────────────────────────────────────────────────── */
/** Record a price snapshot if the newest one is stale. Returns the latest. */
function tick(): ?float {
    $db = db();
    $row = $db->query('SELECT t, price FROM ticks ORDER BY t DESC LIMIT 1')->fetch(PDO::FETCH_ASSOC);
    if ($row && now() - (int)$row['t'] < TICK_MAX_AGE) return (float)$row['price'];

    $j = getJson(dsUrl() . TOKEN, 8);
    $best = null;
    foreach (($j['pairs'] ?? []) as $p) {
        if (!$best || ($p['liquidity']['usd'] ?? 0) > ($best['liquidity']['usd'] ?? 0)) $best = $p;
    }
    $price = $best ? (float)($best['priceUsd'] ?? 0) : 0.0;
    if ($price <= 0) return $row ? (float)$row['price'] : null;

    $st = $db->prepare('INSERT OR REPLACE INTO ticks(t, price) VALUES(?, ?)');
    $st->execute([now(), $price]);
    $db->exec('DELETE FROM ticks WHERE t < ' . (now() - 86400));
    return $price;
}

/** The snapshot nearest $when, or null if none is close enough to trust. */
function priceAt(int $when): ?float {
    $st = db()->prepare(
        'SELECT price, ABS(t - ?) AS d FROM ticks WHERE ABS(t - ?) <= ? ORDER BY d LIMIT 1');
    $st->execute([$when, $when, SNAP_WINDOW]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    return $r ? (float)$r['price'] : null;
}

/* ── chain ─────────────────────────────────────────────────────────────── */
/** balanceOf(addr), in whole tokens. null means we could not ask. */
function balanceOf(string $addr): ?float {
    $data = '0x70a08231' . str_pad(substr(strtolower($addr), 2), 64, '0', STR_PAD_LEFT);
    $body = json_encode(['jsonrpc' => '2.0', 'id' => 1, 'method' => 'eth_call',
        'params' => [['to' => TOKEN, 'data' => $data], 'latest']]);

    $ch = curl_init(rpcUrl());
    curl_setopt_array($ch, [
        CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10,
        CURLOPT_POSTFIELDS => $body,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
    ]);
    $raw = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($raw === false || $code !== 200) return null;

    $j = json_decode((string)$raw, true);
    $hex = $j['result'] ?? null;
    if (!is_string($hex) || !preg_match('/^0x[0-9a-fA-F]*$/', $hex)) return null;
    $hex = ltrim(substr($hex, 2), '0');
    if ($hex === '') return 0.0;
    // The balance overflows a 64-bit int at 18 decimals, so scale as a float.
    return (float)hexdec(substr($hex, 0, 15)) * pow(16, max(0, strlen($hex) - 15)) / pow(10, DECIMALS);
}

function tierFor(float $balance): ?array {
    foreach (TIERS as $t) if ($balance >= $t['min']) return $t;
    return null;
}

/* ── Robin's pick ──────────────────────────────────────────────────────── */
/**
 * One model call per round, and only for the round now taking entries. If it
 * fails, Robin sits the round out — an invented pick would corrupt the one
 * number the whole feature rests on, which is his record.
 */
function robinPick(int $roundId, ?float $price): void {
    $db = db();
    $st = $db->prepare('SELECT robin_side FROM rounds WHERE id = ?');
    $st->execute([$roundId]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if ($row && $row['robin_side'] !== null) return;          // already called it
    if (apiKey() === '') return;

    $hist = $db->query("SELECT settle_price - lock_price AS d FROM rounds
                        WHERE status = 'settled' ORDER BY id DESC LIMIT 6")
               ->fetchAll(PDO::FETCH_COLUMN);
    $moves = implode(', ', array_map(fn($d) => ($d > 0 ? '+' : '') . round((float)$d / max($price ?: 1e-9, 1e-9) * 100, 2) . '%', $hist));

    $r = askText(
        "You are Robin Nakamoto, a memecoin mascot who bets on his own token every five minutes.\n"
      . "Price now: $" . ($price ?? 0) . "\n"
      . "Last few 5-minute moves: " . ($moves ?: 'no history yet') . "\n\n"
      . "Call the next five minutes. Reply with exactly two lines:\n"
      . "UP or DOWN\n"
      . "one sentence of trash talk, under 90 characters, in character, no emoji\n",
        null, 20);

    if ($r['text'] === null) return;
    $lines = preg_split('/\R/', trim($r['text']));
    $side  = strtoupper(trim($lines[0] ?? ''));
    if ($side !== 'UP' && $side !== 'DOWN') return;
    $note  = trim($lines[1] ?? '');

    $db->prepare("INSERT INTO rounds(id, status, robin_side, robin_note) VALUES(?, 'open', ?, ?)
                  ON CONFLICT(id) DO UPDATE SET robin_side = excluded.robin_side,
                                                robin_note = excluded.robin_note")
       ->execute([$roundId, $side, mb_substr($note, 0, 120)]);
}

/* ── settlement ────────────────────────────────────────────────────────── */
/** Settle every finished round that has not been settled yet. */
function settleDue(): void {
    $db = db();
    $live = liveId();

    // Anything with entries or a Robin pick, plus anything a player joined.
    $ids = $db->query('SELECT DISTINCT round_id FROM entries WHERE round_id < ' . $live)
              ->fetchAll(PDO::FETCH_COLUMN);
    $ids = array_unique(array_merge($ids, $db->query(
        "SELECT id FROM rounds WHERE id < $live AND status NOT IN ('settled','void')")
        ->fetchAll(PDO::FETCH_COLUMN)));
    sort($ids);

    foreach ($ids as $id) {
        $id = (int)$id;
        $st = $db->prepare('SELECT status FROM rounds WHERE id = ?');
        $st->execute([$id]);
        $s = $st->fetchColumn();
        if ($s === 'settled' || $s === 'void') continue;

        $lock   = priceAt(startOf($id));
        $settle = priceAt(startOf($id + 1));

        if ($lock === null || $settle === null) {
            $db->prepare("INSERT INTO rounds(id, status) VALUES(?, 'void')
                          ON CONFLICT(id) DO UPDATE SET status = 'void'")->execute([$id]);
            $db->prepare('UPDATE entries SET won = NULL, points = 0 WHERE round_id = ?')->execute([$id]);
            continue;
        }

        // Dead flat is a loss for nobody: it voids, rather than quietly
        // handing the round to one side.
        if ($settle === $lock) {
            $db->prepare("INSERT INTO rounds(id, status, lock_price, settle_price) VALUES(?, 'void', ?, ?)
                          ON CONFLICT(id) DO UPDATE SET status = 'void',
                            lock_price = excluded.lock_price, settle_price = excluded.settle_price")
               ->execute([$id, $lock, $settle]);
            $db->prepare('UPDATE entries SET won = NULL, points = 0 WHERE round_id = ?')->execute([$id]);
            continue;
        }

        $winner = $settle > $lock ? 'UP' : 'DOWN';

        $db->beginTransaction();
        try {
            $st = $db->prepare('SELECT robin_side FROM rounds WHERE id = ?');
            $st->execute([$id]);
            $robin = $st->fetchColumn();

            $db->prepare("INSERT INTO rounds(id, status, lock_price, settle_price, robin_won, settled_at)
                          VALUES(?, 'settled', ?, ?, ?, ?)
                          ON CONFLICT(id) DO UPDATE SET status = 'settled',
                            lock_price = excluded.lock_price, settle_price = excluded.settle_price,
                            robin_won = excluded.robin_won, settled_at = excluded.settled_at")
               ->execute([$id, $lock, $settle,
                          $robin === false || $robin === null ? null : (int)($robin === $winner), now()]);

            $rows = $db->prepare('SELECT addr, side, mult FROM entries WHERE round_id = ?');
            $rows->execute([$id]);
            foreach ($rows->fetchAll(PDO::FETCH_ASSOC) as $e) {
                $won = $e['side'] === $winner;

                $p = $db->prepare('SELECT streak, best FROM players WHERE addr = ?');
                $p->execute([$e['addr']]);
                $cur = $p->fetch(PDO::FETCH_ASSOC) ?: ['streak' => 0, 'best' => 0];

                $streak = $won ? (int)$cur['streak'] + 1 : 0;
                // A run is worth more than the same wins spread out; capped so
                // one lucky night cannot put the board out of reach.
                $points = $won ? (int)round(BASE_POINTS * (float)$e['mult'] * (1 + 0.2 * min($streak - 1, 5))) : 0;

                $db->prepare('UPDATE entries SET won = ?, points = ? WHERE round_id = ? AND addr = ?')
                   ->execute([(int)$won, $points, $id, $e['addr']]);
                $db->prepare('UPDATE players SET points = points + ?, wins = wins + ?, played = played + 1,
                                streak = ?, best = MAX(best, ?) WHERE addr = ?')
                   ->execute([$points, (int)$won, $streak, $streak, $e['addr']]);
            }
            $db->commit();
        } catch (Throwable $ex) {
            $db->rollBack();
            throw $ex;
        }
    }
}

/* ── views ─────────────────────────────────────────────────────────────── */
function roundView(int $id): array {
    $st = db()->prepare('SELECT * FROM rounds WHERE id = ?');
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC) ?: [];

    $c = db()->prepare('SELECT side, COUNT(*) n FROM entries WHERE round_id = ? GROUP BY side');
    $c->execute([$id]);
    $counts = ['UP' => 0, 'DOWN' => 0];
    foreach ($c->fetchAll(PDO::FETCH_ASSOC) as $row) $counts[$row['side']] = (int)$row['n'];

    // The last few people to pick, so the page can show them arriving. Just
    // the address and the side — there is nothing else here worth showing.
    $jn = db()->prepare('SELECT addr, side, tier FROM entries WHERE round_id = ? ORDER BY at DESC LIMIT 6');
    $jn->execute([$id]);

    return [
        'id'         => $id,
        'startsAt'   => startOf($id),
        'endsAt'     => startOf($id + 1),
        'status'     => $r['status'] ?? 'pending',
        'lockPrice'  => isset($r['lock_price'])   ? (float)$r['lock_price']   : null,
        'settlePrice'=> isset($r['settle_price']) ? (float)$r['settle_price'] : null,
        'robinSide'  => $r['robin_side'] ?? null,
        'robinNote'  => $r['robin_note'] ?? null,
        'robinWon'   => isset($r['robin_won']) ? (bool)$r['robin_won'] : null,
        'up'         => $counts['UP'],
        'down'       => $counts['DOWN'],
        'joins'      => $jn->fetchAll(PDO::FETCH_ASSOC),
    ];
}

function entryView(?string $addr, int $id): ?array {
    if (!$addr) return null;
    $st = db()->prepare('SELECT side, tier, mult, won, points FROM entries WHERE round_id = ? AND addr = ?');
    $st->execute([$id, strtolower($addr)]);
    $e = $st->fetch(PDO::FETCH_ASSOC);
    return $e ? ['side' => $e['side'], 'tier' => $e['tier'], 'mult' => (float)$e['mult'],
                 'won' => $e['won'] === null ? null : (bool)$e['won'], 'points' => (int)$e['points']] : null;
}

/* ── request ───────────────────────────────────────────────────────────── */
$action = $_GET['a'] ?? 'state';

if ($action === 'tick') {                    // for an optional keep-alive cron
    $p = tick();
    settleDue();
    echo json_encode(['ok' => true, 'price' => $p, 'round' => liveId()]);
    exit;
}

if ($action === 'join') {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') jfail(405, 'POST only');
    if (rateLimited('arena', 30, 300)) jfail(429, 'Slow down a moment.');

    $b = json_decode((string)file_get_contents('php://input'), true);
    $addr = strtolower(trim((string)($b['address'] ?? '')));
    $side = strtoupper(trim((string)($b['side'] ?? '')));

    if (!preg_match('/^0x[0-9a-f]{40}$/', $addr)) jfail(400, 'Connect a wallet first.');
    if ($side !== 'UP' && $side !== 'DOWN')       jfail(400, 'Pick UP or DOWN.');

    $id = openId();

    $bal = balanceOf($addr);
    if ($bal === null) jfail(503, 'Could not read your balance from the chain. Try again in a moment.');
    $tier = tierFor($bal);
    if (!$tier) {
        jfail(403, 'You need at least ' . number_format(TIERS[count(TIERS) - 1]['min'])
                 . ' $ROBIN to enter. You hold ' . number_format($bal) . '.');
    }

    // Reading the balance takes a moment, and the clock can cross a boundary
    // while it does. Re-check rather than dropping someone into a round that
    // locked while they were being verified.
    if (openId() !== $id) jfail(409, 'That round locked while you were joining. Try the next one.');

    try {
        db()->prepare('INSERT INTO entries(round_id, addr, side, tier, mult, at) VALUES(?,?,?,?,?,?)')
            ->execute([$id, $addr, $side, $tier['name'], $tier['mult'], now()]);
    } catch (PDOException $e) {
        jfail(409, 'You are already in this round.');
    }
    db()->prepare('INSERT INTO players(addr, tier, seen) VALUES(?,?,?)
                   ON CONFLICT(addr) DO UPDATE SET tier = excluded.tier, seen = excluded.seen')
        ->execute([$addr, $tier['name'], now()]);

    echo json_encode(['ok' => true, 'round' => $id, 'side' => $side,
                      'tier' => $tier['name'], 'mult' => $tier['mult'], 'balance' => $bal]);
    exit;
}

/* default: the whole board */
$price = tick();
settleDue();
robinPick(openId(), $price);

$addr = isset($_GET['addr']) && preg_match('/^0x[0-9a-fA-F]{40}$/', $_GET['addr'])
      ? strtolower($_GET['addr']) : null;

$top = db()->query('SELECT addr, points, wins, played, streak, best, tier FROM players
                    WHERE played > 0 ORDER BY points DESC, wins DESC LIMIT 10')
           ->fetchAll(PDO::FETCH_ASSOC);

$recent = [];
for ($i = 1; $i <= HISTORY; $i++) $recent[] = roundView(liveId() - $i);

$me = null;
if ($addr) {
    $st = db()->prepare('SELECT points, wins, played, streak, best, tier FROM players WHERE addr = ?');
    $st->execute([$addr]);
    $me = $st->fetch(PDO::FETCH_ASSOC) ?: null;
}

$last = null;
if ($addr) {
    $st = db()->prepare('SELECT round_id, side, won, points FROM entries
                         WHERE addr = ? AND won IS NOT NULL ORDER BY round_id DESC LIMIT 1');
    $st->execute([$addr]);
    $l = $st->fetch(PDO::FETCH_ASSOC);
    if ($l) $last = ['round' => (int)$l['round_id'], 'side' => $l['side'],
                     'won' => (bool)$l['won'], 'points' => (int)$l['points']];
}

$rw = db()->query('SELECT SUM(robin_won) w, COUNT(robin_won) n FROM rounds WHERE robin_won IS NOT NULL')
          ->fetch(PDO::FETCH_ASSOC);

echo json_encode([
    'now'      => now(),
    'roundSec' => ROUND_SEC,
    'price'    => $price,
    'live'     => roundView(liveId()),
    'open'     => roundView(openId()),
    'yourLive' => entryView($addr, liveId()),
    'yourOpen' => entryView($addr, openId()),
    'you'      => $me ? ['points' => (int)$me['points'], 'wins' => (int)$me['wins'],
                         'played' => (int)$me['played'], 'streak' => (int)$me['streak'],
                         'best' => (int)$me['best'], 'tier' => $me['tier'],
                         /* The last round that actually resolved for this player. The page
                            uses the round id to celebrate a win exactly once, however many
                            times it polls. */
                         'last' => $last] : null,
    'robin'    => ['wins' => (int)($rw['w'] ?? 0), 'rounds' => (int)($rw['n'] ?? 0)],
    'top'      => $top,
    'recent'   => $recent,
    'tiers'    => TIERS,
], JSON_UNESCAPED_SLASHES);
