<?php
/**
 * room.php — live presence and reactions.
 *
 * The site was a page. This makes it a room: how many people are here right
 * now, and what they are all reacting to, as it happens. On a memecoin site
 * the first question a visitor silently asks is "is anything happening here",
 * and a number that moves answers it better than any copy could.
 *
 * ── Three decisions ──────────────────────────────────────────────────────
 *
 * 1. ONE REQUEST DOES EVERYTHING. A poll carries the heartbeat, an optional
 *    reaction, and the cursor for what this client has already seen, and comes
 *    back with the head count and whatever is new. Presence over polling on
 *    shared hosting lives or dies on the request count, so there is exactly
 *    one per client per tick.
 *
 * 2. REACTIONS ARE AN ALLOWLIST, NOT TEXT. Anything here is broadcast to every
 *    other visitor, so the only things that can be broadcast are six emoji
 *    chosen in advance. There is no path from a stranger's keyboard to another
 *    visitor's screen, which is the only version of this feature worth
 *    shipping without a moderation queue.
 *
 * 3. NOBODY IS IDENTIFIED. A client invents a random id for itself and that is
 *    the whole of it — no wallet, no address, no fingerprint. The head count
 *    is a count.
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

require_once __DIR__ . '/lib.php';

const SCHEMA      = 1;
const HERE_WINDOW = 40;    // a heartbeat counts as present for this long
const KEEP_REACTS = 90;    // reactions older than this are dropped
const MAX_RETURN  = 40;    // …and never more than this many in one answer
const REACT_MAX   = 40;    // reactions per client…
const REACT_WIN   = 60;    // …per this many seconds

/* The complete set of things anyone can put on anyone else's screen. */
const EMOJI = ['🚀', '🏹', '🐕', '💎', '🔥', '😂'];

function cfg(string $k, string $d): string { $v = getenv($k); return $v === false || $v === '' ? $d : $v; }
function now(): int { $t = getenv('ROOM_NOW'); return ($t !== false && $t !== '') ? (int)$t : time(); }

function db(): PDO {
    static $pdo = null;
    if ($pdo) return $pdo;

    if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
        jfail(500, 'The room needs PDO SQLite, which this server does not have.');
    }
    $dir = cfg('ROOM_DIR', __DIR__ . '/data');
    if (!is_dir($dir)) @mkdir($dir, 0700, true);

    // Its own file, deliberately: the arena rebuilds its database when its
    // schema changes, and that should never take the room down with it.
    $pdo = new PDO('sqlite:' . $dir . '/room.sqlite');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->exec('PRAGMA journal_mode=WAL');
    $pdo->exec('PRAGMA busy_timeout=3000');

    if ((int)$pdo->query('PRAGMA user_version')->fetchColumn() !== SCHEMA) {
        $pdo->exec('DROP TABLE IF EXISTS presence; DROP TABLE IF EXISTS reactions;');
        $pdo->exec('PRAGMA user_version = ' . SCHEMA);
    }
    $pdo->exec('
      CREATE TABLE IF NOT EXISTS presence(id TEXT PRIMARY KEY, seen INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS presence_seen ON presence(seen);
      CREATE TABLE IF NOT EXISTS reactions(
        id INTEGER PRIMARY KEY AUTOINCREMENT, emoji TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS reactions_at ON reactions(at);
    ');
    return $pdo;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') jfail(405, 'POST only');

$b = json_decode((string)file_get_contents('php://input'), true);
$b = is_array($b) ? $b : [];

$id = (string)($b['id'] ?? '');
if (!preg_match('/^[a-z0-9]{8,32}$/', $id)) jfail(400, 'Bad client id.');

/* -1 means "I have just arrived, do not replay anything at me". A real cursor
   of 0 means "the room was empty when I got here, tell me everything since" —
   two different things that both used to arrive as 0, which left anyone who
   turned up before the first reaction never receiving one. */
$since = isset($b['since']) && $b['since'] !== null ? (int)$b['since'] : -1;
$react = isset($b['react']) ? (string)$b['react'] : '';

$db = db();
$t = now();

/* heartbeat */
$db->prepare('INSERT INTO presence(id, seen) VALUES(?, ?)
              ON CONFLICT(id) DO UPDATE SET seen = excluded.seen')->execute([$id, $t]);

/* the reaction, if this poll carried one */
$sent = false;
if ($react !== '') {
    if (!in_array($react, EMOJI, true)) jfail(400, 'Not one of the six.');
    if (!rateLimited('room_' . substr(sha1($id), 0, 12), REACT_MAX, REACT_WIN)) {
        $db->prepare('INSERT INTO reactions(emoji, at) VALUES(?, ?)')->execute([$react, $t]);
        $sent = true;
    }
}

/* tidy up — cheap, and only now and then rather than on every single poll */
if (random_int(1, 12) === 1) {
    $db->exec('DELETE FROM presence WHERE seen < ' . ($t - HERE_WINDOW * 3));
    $db->exec('DELETE FROM reactions WHERE at < ' . ($t - KEEP_REACTS));
}

$here = (int)$db->query('SELECT COUNT(*) FROM presence WHERE seen > ' . ($t - HERE_WINDOW))->fetchColumn();

/* A first poll should not replay a minute and a half of backlog at someone —
   it would look like a party that stopped the moment they walked in. */
$rows = [];
if ($since >= 0) {
    $st = $db->prepare('SELECT id, emoji FROM reactions WHERE id > ? ORDER BY id LIMIT ' . MAX_RETURN);
    $st->execute([$since]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
}
$cursor = (int)$db->query('SELECT COALESCE(MAX(id), 0) FROM reactions')->fetchColumn();

echo json_encode([
    'here'      => $here,
    'reactions' => array_map(fn($r) => $r['emoji'], $rows),
    'cursor'    => $cursor,
    'sent'      => $sent,
    'emoji'     => EMOJI,
], JSON_UNESCAPED_UNICODE);
