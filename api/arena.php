<?php
/**
 * arena.php — Robin Arena: the jackpot engine.
 *
 * Everyone throws points into a shared pot. When the round closes a wheel
 * spins, one entry wins, and the winner takes everything. Your slice of the
 * wheel is your share of the pot, so a bigger stake is better odds and never a
 * guarantee.
 *
 * ── Four decisions worth reading before changing anything ─────────────────
 *
 * 1. NOBODY DEPOSITS A TOKEN. The currency is points, and points come from a
 *    daily allowance you can claim for *holding* $ROBIN — checked server-side
 *    with balanceOf. So the stakes are real, the losses are real, and there is
 *    no custody, no pot of anyone's money, and no private key anywhere near
 *    this server. A bigger bag buys a bigger allowance, which is what the
 *    token is for here.
 *
 * 2. IT IS PROVABLY FAIR. Each round's seed is generated and its SHA-256 hash
 *    published before a single entry is taken. The winning ticket is
 *    HMAC(seed, roundId) modulo the pot. After the round the seed itself is
 *    published, so anyone can recompute the result and confirm it was decided
 *    before they played. A game that asks people to risk something and cannot
 *    show its working is just asking them to trust us.
 *
 * 3. ROUNDS ARE CLOCK SLOTS, NOT RECORDS. A round's id is floor(time / 90),
 *    so every visitor agrees on which round is live without anything having to
 *    create it, and no cron is required: the first request after a round
 *    closes is what resolves it. Unlike a price game there is nothing
 *    time-sensitive to capture, so a quiet hour costs nothing — the round
 *    resolves correctly whenever someone next turns up.
 *
 * 4. A ROUND WITH ONE PLAYER IS RETURNED, NOT WON. Taking someone's stake and
 *    handing it back as a "win" would be theatre.
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

require_once __DIR__ . '/lib.php';
require_once __DIR__ . '/provider.php';

/* Bump this whenever the tables below change shape. */
const SCHEMA = 2;

const ROUND_SEC = 90;      // one round, end to end
const ENTRY_SEC = 65;      // …of which this much takes entries; the rest is the spin
const HISTORY   = 8;
const MIN_STAKE = 50;
const CLAIM_SEC = 86400;   // one allowance a day

const TOKEN    = '0x280413fbF06CcC1114094A5967dB2191d49EE75e';
const DECIMALS = 18;
const RPC_URL  = 'https://rpc.mainnet.chain.robinhood.com';

/** Hold this much $ROBIN, claim this many points a day. */
const TIERS = [
    ['name' => 'Sheriff', 'min' => 5000000, 'daily' => 10000],
    ['name' => 'Outlaw',  'min' => 1000000, 'daily' =>  4000],
    ['name' => 'Archer',  'min' =>  250000, 'daily' =>  1500],
    ['name' => 'Scout',   'min' =>   50000, 'daily' =>   500],
];

/* Test hooks: a fake clock and a mock chain. */
function cfg(string $k, string $d): string { $v = getenv($k); return $v === false || $v === '' ? $d : $v; }
function now(): int { $t = getenv('ARENA_NOW'); return ($t !== false && $t !== '') ? (int)$t : time(); }
function rpcUrl(): string { return cfg('ARENA_RPC', RPC_URL); }

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
    $pdo->exec('PRAGMA journal_mode=WAL');
    $pdo->exec('PRAGMA busy_timeout=5000');

    /* CREATE TABLE IF NOT EXISTS keeps whatever is already there, which is
       exactly wrong across a version that changed the columns: an older build's
       tables survive, half the queries still work against them, and the game
       misbehaves in ways nobody can explain. Stamp the schema and start clean
       when it does not match. Nothing here is worth migrating — points from a
       game that no longer exists are not a record anyone wants kept. */
    $have = (int)$pdo->query('PRAGMA user_version')->fetchColumn();
    if ($have !== SCHEMA) {
        foreach (['entries', 'players', 'rounds', 'ticks'] as $t) $pdo->exec('DROP TABLE IF EXISTS ' . $t);
        $pdo->exec('PRAGMA user_version = ' . SCHEMA);
    }

    $pdo->exec('
      CREATE TABLE IF NOT EXISTS rounds(
        id INTEGER PRIMARY KEY, seed TEXT NOT NULL, seed_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT "open",
        pot INTEGER DEFAULT 0, winner TEXT, ticket INTEGER,
        resolved_at INTEGER, reaction TEXT);
      CREATE TABLE IF NOT EXISTS entries(
        round_id INTEGER NOT NULL, addr TEXT NOT NULL,
        stake INTEGER NOT NULL, at INTEGER NOT NULL, seq INTEGER NOT NULL,
        PRIMARY KEY(round_id, addr));
      CREATE TABLE IF NOT EXISTS players(
        addr TEXT PRIMARY KEY, points INTEGER DEFAULT 0, staked INTEGER DEFAULT 0,
        won INTEGER DEFAULT 0, rounds INTEGER DEFAULT 0, wins INTEGER DEFAULT 0,
        biggest INTEGER DEFAULT 0, tier TEXT, last_claim INTEGER DEFAULT 0, seen INTEGER);
    ');
    return $pdo;
}

/* ── the clock ─────────────────────────────────────────────────────────── */
function liveId(): int { return intdiv(now(), ROUND_SEC); }
function startOf(int $id): int { return $id * ROUND_SEC; }
function closesAt(int $id): int { return startOf($id) + ENTRY_SEC; }
function phaseOf(int $id): string {
    if ($id > liveId()) return 'pending';
    if ($id < liveId()) return 'done';
    return now() < closesAt($id) ? 'entry' : 'spin';
}

/* ── provably fair ─────────────────────────────────────────────────────── */
/**
 * Make sure the round exists and its seed is committed. The hash goes out
 * immediately; the seed itself stays hidden until the round is resolved, so a
 * player can check afterwards that the answer was fixed before they entered.
 */
function ensureRound(int $id): array {
    $db = db();
    $st = $db->prepare('SELECT * FROM rounds WHERE id = ?');
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if ($r) return $r;

    $seed = bin2hex(random_bytes(32));
    try {
        $db->prepare('INSERT INTO rounds(id, seed, seed_hash) VALUES(?,?,?)')
           ->execute([$id, $seed, hash('sha256', $seed)]);
    } catch (PDOException $e) {
        // Another visitor created it in the same instant; theirs is the seed.
    }
    $st->execute([$id]);
    return $st->fetch(PDO::FETCH_ASSOC);
}

/** The winning ticket for a round: a number in [0, pot). */
function ticketFor(string $seed, int $roundId, int $pot): int {
    $h = hash_hmac('sha256', (string)$roundId, $seed);
    // 52 bits keeps this exact in a float and is far more range than any pot.
    return (int)(hexdec(substr($h, 0, 13)) % max(1, $pot));
}

/* ── chain ─────────────────────────────────────────────────────────────── */
/** balanceOf(addr) in whole tokens. null means we could not ask. */
function balanceOf(string $addr): ?float {
    $data = '0x70a08231' . str_pad(substr(strtolower($addr), 2), 64, '0', STR_PAD_LEFT);
    $ch = curl_init(rpcUrl());
    curl_setopt_array($ch, [
        CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10,
        CURLOPT_POSTFIELDS => json_encode(['jsonrpc' => '2.0', 'id' => 1, 'method' => 'eth_call',
            'params' => [['to' => TOKEN, 'data' => $data], 'latest']]),
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
    ]);
    $raw = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($raw === false || $code !== 200) return null;

    $hex = json_decode((string)$raw, true)['result'] ?? null;
    if (!is_string($hex) || !preg_match('/^0x[0-9a-fA-F]*$/', $hex)) return null;
    $hex = ltrim(substr($hex, 2), '0');
    if ($hex === '') return 0.0;
    // Balances overflow a 64-bit int at 18 decimals, so scale as a float. Only
    // the leading digits matter — this decides a tier, not a payout.
    return (float)hexdec(substr($hex, 0, 15)) * pow(16, max(0, strlen($hex) - 15)) / pow(10, DECIMALS);
}

function tierFor(float $balance): ?array {
    foreach (TIERS as $t) if ($balance >= $t['min']) return $t;
    return null;
}

/* ── resolution ────────────────────────────────────────────────────────── */
function resolveDue(): void {
    $db = db();
    $ids = $db->query("SELECT id FROM rounds WHERE status = 'open' ORDER BY id")
              ->fetchAll(PDO::FETCH_COLUMN);

    foreach ($ids as $id) {
        $id = (int)$id;
        if (now() < closesAt($id)) continue;              // still taking entries

        $db->beginTransaction();
        try {
            $st = $db->prepare('SELECT * FROM rounds WHERE id = ?');
            $st->execute([$id]);
            $r = $st->fetch(PDO::FETCH_ASSOC);
            if (!$r || $r['status'] !== 'open') { $db->rollBack(); continue; }

            $es = $db->prepare('SELECT addr, stake FROM entries WHERE round_id = ? ORDER BY seq');
            $es->execute([$id]);
            $entries = $es->fetchAll(PDO::FETCH_ASSOC);
            $pot = array_sum(array_map(fn($e) => (int)$e['stake'], $entries));

            // One player is not a game. Give it back.
            if (count($entries) < 2) {
                foreach ($entries as $e) {
                    $db->prepare('UPDATE players SET points = points + ?, staked = staked - ? WHERE addr = ?')
                       ->execute([(int)$e['stake'], (int)$e['stake'], $e['addr']]);
                }
                $db->prepare("UPDATE rounds SET status = 'void', pot = ?, resolved_at = ? WHERE id = ?")
                   ->execute([$pot, now(), $id]);
                $db->commit();
                continue;
            }

            $ticket = ticketFor($r['seed'], $id, $pot);
            $acc = 0; $winner = $entries[0]['addr'];
            foreach ($entries as $e) {
                $acc += (int)$e['stake'];
                if ($ticket < $acc) { $winner = $e['addr']; break; }
            }

            $db->prepare("UPDATE rounds SET status = 'settled', pot = ?, winner = ?, ticket = ?, resolved_at = ?
                          WHERE id = ?")->execute([$pot, $winner, $ticket, now(), $id]);

            foreach ($entries as $e) {
                $isWinner = $e['addr'] === $winner;
                $db->prepare('UPDATE players SET rounds = rounds + 1, wins = wins + ?,
                                points = points + ?, won = won + ?, staked = staked - ?,
                                biggest = MAX(biggest, ?) WHERE addr = ?')
                   ->execute([(int)$isWinner, $isWinner ? $pot : 0, $isWinner ? $pot : 0,
                              (int)$e['stake'], $isWinner ? $pot : 0, $e['addr']]);
            }
            $db->commit();
        } catch (Throwable $ex) {
            $db->rollBack();
            throw $ex;
        }
    }
}

/* ── views ─────────────────────────────────────────────────────────────── */
function roundView(int $id, bool $ensure = false): array {
    $r = $ensure ? ensureRound($id) : null;
    if (!$r) {
        $st = db()->prepare('SELECT * FROM rounds WHERE id = ?');
        $st->execute([$id]);
        $r = $st->fetch(PDO::FETCH_ASSOC) ?: null;
    }
    $es = db()->prepare('SELECT addr, stake FROM entries WHERE round_id = ? ORDER BY seq');
    $es->execute([$id]);
    $entries = array_map(fn($e) => ['addr' => $e['addr'], 'stake' => (int)$e['stake']],
                         $es->fetchAll(PDO::FETCH_ASSOC));
    $pot = array_sum(array_map(fn($e) => $e['stake'], $entries));

    return [
        'id'       => $id,
        'startsAt' => startOf($id),
        'closesAt' => closesAt($id),
        'endsAt'   => startOf($id + 1),
        'phase'    => $r && in_array($r['status'], ['settled', 'void'], true) ? $r['status'] : phaseOf($id),
        'pot'      => $pot,
        'entries'  => $entries,
        'winner'   => $r['winner'] ?? null,
        'ticket'   => isset($r['ticket']) ? (int)$r['ticket'] : null,
        'seedHash' => $r['seed_hash'] ?? null,
        // The seed is only ever published once the round can no longer be entered.
        'seed'     => ($r && in_array($r['status'], ['settled', 'void'], true)) ? $r['seed'] : null,
        'reaction' => $r['reaction'] ?? null,
    ];
}

/* ── request ───────────────────────────────────────────────────────────── */
$action = $_GET['a'] ?? 'state';
$addr = null;
if (isset($_GET['addr']) && preg_match('/^0x[0-9a-fA-F]{40}$/', $_GET['addr'])) {
    $addr = strtolower($_GET['addr']);
}

/** The body of a POST, as an array. */
function body(): array {
    $b = json_decode((string)file_get_contents('php://input'), true);
    return is_array($b) ? $b : [];
}
function requireAddr(array $b): string {
    $a = strtolower(trim((string)($b['address'] ?? '')));
    if (!preg_match('/^0x[0-9a-f]{40}$/', $a)) jfail(400, 'Connect a wallet first.');
    return $a;
}
function player(string $a): array {
    $st = db()->prepare('SELECT * FROM players WHERE addr = ?');
    $st->execute([$a]);
    return $st->fetch(PDO::FETCH_ASSOC) ?: ['addr' => $a, 'points' => 0, 'staked' => 0, 'won' => 0,
        'rounds' => 0, 'wins' => 0, 'biggest' => 0, 'tier' => null, 'last_claim' => 0];
}

if ($action === 'claim') {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') jfail(405, 'POST only');
    if (rateLimited('arena_claim', 20, 600)) jfail(429, 'Slow down a moment.');
    $a = requireAddr(body());

    $p = player($a);
    $wait = (int)$p['last_claim'] + CLAIM_SEC - now();
    if ($wait > 0) jfail(409, 'Next allowance in ' . ceil($wait / 3600) . 'h.', ['wait' => $wait]);

    $bal = balanceOf($a);
    if ($bal === null) jfail(503, 'Could not read your balance from the chain. Try again in a moment.');
    $tier = tierFor($bal);
    if (!$tier) {
        jfail(403, 'You need at least ' . number_format(TIERS[count(TIERS) - 1]['min'])
                 . ' $ROBIN to claim. You hold ' . number_format($bal) . '.');
    }

    db()->prepare('INSERT INTO players(addr, points, tier, last_claim, seen) VALUES(?,?,?,?,?)
                   ON CONFLICT(addr) DO UPDATE SET points = points + excluded.points,
                     tier = excluded.tier, last_claim = excluded.last_claim, seen = excluded.seen')
        ->execute([$a, $tier['daily'], $tier['name'], now(), now()]);

    $p = player($a);
    echo json_encode(['ok' => true, 'claimed' => $tier['daily'], 'tier' => $tier['name'],
                      'balance' => $bal, 'points' => (int)$p['points']]);
    exit;
}

if ($action === 'join') {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') jfail(405, 'POST only');
    if (rateLimited('arena_join', 60, 300)) jfail(429, 'Slow down a moment.');
    $b = body();
    $a = requireAddr($b);
    $stake = (int)($b['stake'] ?? 0);

    if ($stake < MIN_STAKE) jfail(400, 'Minimum stake is ' . MIN_STAKE . ' points.');

    $id = liveId();
    if (now() >= closesAt($id)) jfail(409, 'This round has closed. The next one is seconds away.');
    ensureRound($id);

    $db = db();
    $db->beginTransaction();
    try {
        $p = player($a);
        if ((int)$p['points'] < $stake) {
            $db->rollBack();
            jfail(400, 'You only have ' . (int)$p['points'] . ' points.');
        }
        // The clock can cross the close while the transaction is opening.
        if (now() >= closesAt($id)) { $db->rollBack(); jfail(409, 'This round just closed.'); }

        $seq = (int)$db->query('SELECT COALESCE(MAX(seq), 0) + 1 FROM entries WHERE round_id = ' . $id)
                       ->fetchColumn();
        $db->prepare('INSERT INTO entries(round_id, addr, stake, at, seq) VALUES(?,?,?,?,?)
                      ON CONFLICT(round_id, addr) DO UPDATE SET stake = stake + excluded.stake')
           ->execute([$id, $a, $stake, now(), $seq]);
        $db->prepare('INSERT INTO players(addr, points, staked, seen) VALUES(?, ?, ?, ?)
                      ON CONFLICT(addr) DO UPDATE SET points = points - ' . $stake . ',
                        staked = staked + ' . $stake . ', seen = ' . now())
           ->execute([$a, -$stake, $stake, now()]);
        $db->commit();
    } catch (Throwable $ex) {
        if ($db->inTransaction()) $db->rollBack();
        throw $ex;
    }

    $p = player($a);
    echo json_encode(['ok' => true, 'round' => $id, 'stake' => $stake, 'points' => (int)$p['points']]);
    exit;
}

if ($action === 'react') {
    /* Robin's line about a finished round. Separate from the poll on purpose:
       it costs a model call and a second or two, and the board should never
       wait on it. */
    $id = (int)($_GET['round'] ?? 0);
    $st = db()->prepare('SELECT * FROM rounds WHERE id = ?');
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r || $r['status'] !== 'settled') jfail(404, 'No such finished round.');
    if ($r['reaction']) { echo json_encode(['reaction' => $r['reaction']]); exit; }
    if (apiKey() === '' || rateLimited('arena_react', 60, 600)) { echo json_encode(['reaction' => null]); exit; }

    $es = db()->prepare('SELECT addr, stake FROM entries WHERE round_id = ? ORDER BY stake DESC');
    $es->execute([$id]);
    $entries = $es->fetchAll(PDO::FETCH_ASSOC);
    $win = null;
    foreach ($entries as $e) if ($e['addr'] === $r['winner']) $win = (int)$e['stake'];

    $out = askText(
        "You are Robin Nakamoto, the mascot who runs a jackpot game on his own memecoin site.\n"
      . "A round just finished.\n"
      . "Players: " . count($entries) . "\n"
      . "Pot: " . (int)$r['pot'] . " points\n"
      . "The winner staked " . (int)$win . " of it, so their odds were about "
      . round($win / max(1, (int)$r['pot']) * 100) . "%.\n\n"
      . "React in ONE sentence under 90 characters. In character, dry, no emoji, no hashtags.\n"
      . "Do not congratulate anyone by name and do not invent numbers.\n", null, 20);

    $line = $out['text'] ? mb_substr(trim(preg_replace('/\s+/', ' ', $out['text'])), 0, 140) : null;
    if ($line) db()->prepare('UPDATE rounds SET reaction = ? WHERE id = ?')->execute([$line, $id]);
    echo json_encode(['reaction' => $line]);
    exit;
}

/* default: the whole board */
resolveDue();
$live = liveId();
ensureRound($live);

$recent = [];
for ($i = 1; $i <= HISTORY; $i++) $recent[] = roundView($live - $i);

$top = db()->query('SELECT addr, points, won, wins, rounds, biggest, tier FROM players
                    WHERE rounds > 0 OR points > 0 ORDER BY points + won DESC LIMIT 10')
           ->fetchAll(PDO::FETCH_ASSOC);

$me = null;
if ($addr) {
    $p = player($addr);
    $me = ['points' => (int)$p['points'], 'staked' => (int)$p['staked'], 'won' => (int)$p['won'],
           'wins' => (int)$p['wins'], 'rounds' => (int)$p['rounds'], 'biggest' => (int)$p['biggest'],
           'tier' => $p['tier'], 'claimIn' => max(0, (int)$p['last_claim'] + CLAIM_SEC - now())];
}

echo json_encode([
    'now'       => now(),
    'roundSec'  => ROUND_SEC,
    'entrySec'  => ENTRY_SEC,
    'minStake'  => MIN_STAKE,
    'live'      => roundView($live, true),
    'last'      => $recent ? $recent[0] : null,
    'you'       => $me,
    'top'       => $top,
    'recent'    => $recent,
    'tiers'     => TIERS,
], JSON_UNESCAPED_SLASHES);
