#!/usr/bin/env bash
# Drives the arena's round engine through a full game on a controlled clock and
# a controlled price. Everything here is the part that decides who won, so it
# gets tested before anything is drawn on a screen.
set -uo pipefail
cd "$(dirname "$0")/.."

MOCK=8795
DIR=$(mktemp -d)
trap 'rm -rf "$DIR"; kill $SRV 2>/dev/null' EXIT

pass=0; fail=0
ck() { if [ "$2" = "$3" ]; then echo "PASS  $1"; pass=$((pass+1));
       else echo "FAIL  $1"; echo "      got:  $2"; echo "      want: $3"; fail=$((fail+1)); fi }

# Balances as raw wei hex, so the mock never needs big-integer maths.
BAL_NONE=0
BAL_DUST=21e19e0c9bab2400000          #    10,000 ROBIN — under the entry bar
BAL_SCOUT=cb49b44ba602d800000         #    60,000 ROBIN — Scout, x1
BAL_OUTLAW=13da329b6336471800000      # 1,500,000 ROBIN — Outlaw, x2

price() { echo -n "$1" > "$DIR/price.txt"; }
bal()   { echo -n "$1" > "$DIR/balance.txt"; }

MOCK_ARENA_DIR="$DIR" ARENA_DIR="$DIR" php -S 127.0.0.1:$MOCK -t test test/mock-arena.php >/dev/null 2>&1 &
SRV=$!
sleep 1.2

# One request at a given instant. The engine reads the clock from ARENA_NOW, so
# each call can sit anywhere on the timeline.
call() { # $1 = unix time, rest = query string
  local t="$1"; shift
  ARENA_NOW="$t" ARENA_DIR="$DIR" \
  ARENA_RPC="http://127.0.0.1:$MOCK/rpc" ARENA_DS="http://127.0.0.1:$MOCK/dex/tokens/" \
  ROBIN_AI_KEY="" \
  php -r "\$_GET=$1;\$_SERVER['REQUEST_METHOD']='GET';include 'api/arena.php';" 2>&1
}
join() { # $1 = time, $2 = side
  local t="$1" side="$2"
  ARENA_NOW="$t" ARENA_DIR="$DIR" \
  ARENA_RPC="http://127.0.0.1:$MOCK/rpc" ARENA_DS="http://127.0.0.1:$MOCK/dex/tokens/" \
  ROBIN_AI_KEY="" \
  php -r "
    \$_GET=['a'=>'join'];\$_SERVER['REQUEST_METHOD']='POST';\$_SERVER['REMOTE_ADDR']='9.9.9.9';
    \$GLOBALS['__b']=json_encode(['address'=>'0x1111111111111111111111111111111111111111','side'=>'$side']);
    class In{ public \$context; private \$d; private \$p=0;
      function stream_open(\$a,\$b,\$c,&\$d){ \$this->d=\$GLOBALS['__b']; return true; }
      function stream_read(\$n){ \$r=substr(\$this->d,\$this->p,\$n); \$this->p+=strlen(\$r); return \$r; }
      function stream_eof(){ return \$this->p>=strlen(\$this->d);} function stream_stat(){return [];} }
    stream_wrapper_unregister('php'); stream_wrapper_register('php','In');
    include 'api/arena.php';" 2>&1
}
j() { echo "$1" | python3 -c "import sys,json;d=json.load(sys.stdin);print($2)" 2>/dev/null || echo PARSE_ERROR; }

# A round boundary to build the timeline around. R is the round under test.
T=1900000200                 # a real round boundary: divisible by 300
R=$((T / 300))

# ── the entry bar ────────────────────────────────────────────────────────
price 0.0001
bal $BAL_NONE
ck "a wallet with nothing cannot enter" "$(j "$(join $((T-100)) UP)" 'd.get("error","")[:19]')" "You need at least 5"
bal $BAL_DUST
ck "a wallet under the bar cannot enter" "$(j "$(join $((T-100)) UP)" 'd.get("error","")[:19]')" "You need at least 5"

# ── entering the open round ──────────────────────────────────────────────
bal $BAL_OUTLAW
OUT=$(join $((T-100)) UP)
ck "a real holder gets in"        "$(j "$OUT" 'd.get("ok")')" "True"
ck "entry lands in the NEXT round" "$(j "$OUT" 'd["round"]')" "$R"
ck "balance sets the tier"         "$(j "$OUT" 'd["tier"]')" "Outlaw"
ck "no double entry"               "$(j "$(join $((T-90)) DOWN)" 'd.get("error","")')" "You are already in this round."
# An entry can only ever land in a round that has not started yet.
ck "the round joined is still ahead" "$(j "$OUT" "d['round'] * 300 > $((T-100))")" "True"

# ── the round runs and settles ───────────────────────────────────────────
call $((T-100)) "['a'=>'tick']" >/dev/null      # a price before the lock
price 0.0001
call $T "['a'=>'tick']" >/dev/null              # the lock price, exactly on the boundary
price 0.00012                                    # up 20%
call $((T+300)) "['a'=>'tick']" >/dev/null      # the settle price

S=$(call $((T+301)) "['a'=>'state','addr'=>'0x1111111111111111111111111111111111111111']")
ck "the round settled"        "$(j "$S" "[r for r in d['recent'] if r['id']==$R][0]['status']")" "settled"
ck "UP won a rising round"    "$(j "$S" 'd["you"]["wins"]')" "1"
ck "an Outlaw win pays x2"    "$(j "$S" 'd["you"]["points"]')" "200"
ck "the streak started"       "$(j "$S" 'd["you"]["streak"]')" "1"
ck "the leaderboard has them" "$(j "$S" 'len(d["top"])')" "1"

# ── a losing round, on the same wallet ───────────────────────────────────
T2=$((T + 300)); R2=$((T2 / 300))
join $((T2-100)) UP >/dev/null
price 0.00012; call $T2 "['a'=>'tick']" >/dev/null
price 0.00009; call $((T2+300)) "['a'=>'tick']" >/dev/null
S=$(call $((T2+301)) "['a'=>'state','addr'=>'0x1111111111111111111111111111111111111111']")
ck "UP loses a falling round" "$(j "$S" 'd["you"]["wins"]')" "1"
ck "the streak is broken"     "$(j "$S" 'd["you"]["streak"]')" "0"
ck "points are not taken away" "$(j "$S" 'd["you"]["points"]')" "200"

# ── a flat round is nobody's win ─────────────────────────────────────────
T3=$((T2 + 300)); R3=$((T3 / 300))
join $((T3-100)) UP >/dev/null
price 0.00009; call $T3 "['a'=>'tick']" >/dev/null
call $((T3+300)) "['a'=>'tick']" >/dev/null      # same price at both ends
S=$(call $((T3+301)) "['a'=>'state','addr'=>'0x1111111111111111111111111111111111111111']")
ck "an unmoved round voids"   "$(j "$S" "[r for r in d['recent'] if r['id']==$R3][0]['status']")" "void"
ck "a void round is not played" "$(j "$S" 'd["you"]["played"]')" "2"

# ── nobody was watching, so there is no price to settle on ───────────────
T4=$((T3 + 300)); R4=$((T4 / 300))
join $((T4-100)) DOWN >/dev/null
# no ticks at all across this round
S=$(call $((T4+901)) "['a'=>'state','addr'=>'0x1111111111111111111111111111111111111111']")
ck "a round with no price voids" "$(j "$S" "[r for r in d['recent'] if r['id']==$R4][0]['status']")" "void"
ck "and still nobody loses"      "$(j "$S" 'd["you"]["played"]')" "2"

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
