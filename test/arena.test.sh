#!/usr/bin/env bash
# Drives the jackpot engine through real rounds on a controlled clock.
# Everything here decides who keeps points, so it gets proven before anything
# is drawn on a screen — including that the result really was fixed before
# anyone entered, which is the claim the whole game rests on.
set -uo pipefail
cd "$(dirname "$0")/.."

MOCK=8795
DIR=$(mktemp -d)
trap 'rm -rf "$DIR"; kill $SRV 2>/dev/null' EXIT

pass=0; fail=0
ck() { if [ "$2" = "$3" ]; then echo "PASS  $1"; pass=$((pass+1));
       else echo "FAIL  $1"; echo "      got:  $2"; echo "      want: $3"; fail=$((fail+1)); fi }

A1=0x1111111111111111111111111111111111111111
A2=0x2222222222222222222222222222222222222222
A3=0x3333333333333333333333333333333333333333

BAL_DUST=21e19e0c9bab2400000          #    10,000 ROBIN — under the bar
BAL_SCOUT=cb49b44ba602d800000         #    60,000 ROBIN — Scout,  500/day
BAL_OUTLAW=13da329b6336471800000      # 1,500,000 ROBIN — Outlaw, 4000/day
bal() { echo -n "$1" > "$DIR/balance.txt"; }

ARENA_DIR="$DIR" php -S 127.0.0.1:$MOCK -t test test/mock-arena.php >/dev/null 2>&1 &
SRV=$!
sleep 1.2

env_() { echo "ARENA_NOW=$1 ARENA_DIR=$DIR ROBIN_RATE_DIR=$DIR ARENA_RPC=http://127.0.0.1:$MOCK/rpc ROBIN_AI_KEY="; }

get() {  # $1 = time, $2 = php $_GET literal
  env $(env_ "$1") php -r "\$_GET=$2;\$_SERVER['REQUEST_METHOD']='GET';include 'api/arena.php';" 2>&1
}
post() { # $1 = time, $2 = action, $3 = json body
  env $(env_ "$1") php -r "
    \$_GET=['a'=>'$2'];\$_SERVER['REQUEST_METHOD']='POST';\$_SERVER['REMOTE_ADDR']='9.9.9.9';
    \$GLOBALS['__b']='$3';
    class In{ public \$context; private \$d; private \$p=0;
      function stream_open(\$a,\$b,\$c,&\$d){ \$this->d=\$GLOBALS['__b']; return true; }
      function stream_read(\$n){ \$r=substr(\$this->d,\$this->p,\$n); \$this->p+=strlen(\$r); return \$r; }
      function stream_eof(){ return \$this->p>=strlen(\$this->d);} function stream_stat(){return [];} }
    stream_wrapper_unregister('php'); stream_wrapper_register('php','In');
    include 'api/arena.php';" 2>&1
}
claim() { post "$1" claim "{\"address\":\"$2\"}"; }
join()  { post "$1" join  "{\"address\":\"$2\",\"stake\":$3}"; }
j() { echo "$1" | python3 -c "import sys,json;d=json.load(sys.stdin);print($2)" 2>/dev/null || echo PARSE_ERROR; }
# Same, but for checks that need statements rather than one expression.
jx() { echo "$1" | python3 -c "
import sys,json,hmac,hashlib
d=json.load(sys.stdin)
$2" 2>/dev/null || echo PARSE_ERROR; }

T=$((1900000000 / 90 * 90 + 90))     # the start of a round
R=$((T / 90))

# ── the allowance ────────────────────────────────────────────────────────
bal $BAL_DUST
ck "under the bar cannot claim"  "$(j "$(claim $((T+1)) $A1)" 'd.get("error","")[:19]')" "You need at least 5"
bal $BAL_OUTLAW
ck "an Outlaw claims 4000"       "$(j "$(claim $((T+2)) $A1)" 'd["claimed"]')" "4000"
ck "and now holds them"          "$(j "$(claim $((T+3)) $A1)" 'd.get("error","")[:14]')" "Next allowance"
bal $BAL_SCOUT
ck "a Scout claims 500"          "$(j "$(claim $((T+4)) $A2)" 'd["claimed"]')" "500"
ck "a day later they claim again" "$(j "$(claim $((T+90000)) $A2)" 'd["points"]')" "1000"

# ── staking ──────────────────────────────────────────────────────────────
ck "below the minimum is refused" "$(j "$(join $((T+5)) $A1 10)" 'd.get("error","")')" "Minimum stake is 50 points."
ck "you cannot stake what you lack" "$(j "$(join $((T+5)) $A1 99999)" 'd.get("error","")[:14]')" "You only have "

ck "a stake is taken up front"  "$(j "$(join $((T+6)) $A1 1000)" 'd["points"]')" "3000"
ck "topping up takes more"      "$(j "$(join $((T+7)) $A1 500)"  'd["points"]')" "2500"

S=$(get $((T+8)) "['a'=>'state','addr'=>'$A1']")
ck "the pot is the sum"         "$(j "$S" 'd["live"]["pot"]')" "1500"
ck "the seed hash is published" "$(j "$S" 'len(d["live"]["seedHash"])')" "64"
ck "the seed itself is not"     "$(j "$S" 'd["live"]["seed"] is None')" "True"

# a second player, so it is a game
join $((T+9)) $A2 500 >/dev/null
ck "two players, bigger pot"    "$(j "$(get $((T+10)) "['a'=>'state']")" 'd["live"]["pot"]')" "2000"
ck "entries closed after 65s"   "$(j "$(join $((T+70)) $A2 100)" 'd.get("error","")[:18]')" "This round has clo"

# ── resolution ───────────────────────────────────────────────────────────
S=$(get $((T+95)) "['a'=>'state','addr'=>'$A1']")
LAST=$(j "$S" "[r for r in d['recent'] if r['id']==$R][0]")
ck "the round settled"          "$(j "$S" "[r for r in d['recent'] if r['id']==$R][0]['phase']")" "settled"
ck "the seed is revealed now"   "$(j "$S" "len([r for r in d['recent'] if r['id']==$R][0]['seed'] or '')")" "64"
ck "the pot went to one winner" "$(j "$S" "[r for r in d['recent'] if r['id']==$R][0]['winner'] in ('$A1','$A2')")" "True"

# The hash published before the round must match the seed published after it,
# and the ticket must be the one that seed produces. This is the whole promise.
ck "the seed matches its hash" "$(jx "$S" "
r=[x for x in d['recent'] if x['id']==$R][0]
print(hashlib.sha256(r['seed'].encode()).hexdigest()==r['seedHash'])")" "True"
ck "the ticket follows from the seed" "$(jx "$S" "
r=[x for x in d['recent'] if x['id']==$R][0]
t=int(hmac.new(r['seed'].encode(),str($R).encode(),hashlib.sha256).hexdigest()[:13],16)%r['pot']
print(t==r['ticket'])")" "True"

# Points are conserved: the pot left the players and came back whole.
TOT=$(j "$S" 'sum(p["points"] for p in d["top"])')
ck "no points were created or lost" "$TOT" "5000"
ck "the winner banked the pot"      "$(j "$S" 'max(p["biggest"] for p in d["top"])')" "2000"

# ── a round nobody else joined ───────────────────────────────────────────
T2=$((T + 90)); R2=$((T2 / 90))
join $((T2+5)) $A1 800 >/dev/null
S=$(get $((T2+95)) "['a'=>'state','addr'=>'$A1']")
ck "a one-player round voids"   "$(j "$S" "[r for r in d['recent'] if r['id']==$R2][0]['phase']")" "void"
ck "and the stake comes back"   "$(j "$S" 'sum(p["points"] for p in d["top"])')" "5000"
ck "a void round is not counted" "$(j "$S" 'sum(p["rounds"] for p in d["top"])')" "2"

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
