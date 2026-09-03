#!/usr/bin/env bash
# The token list and the bridge probe.
#
# The bridge probe exists because nobody can currently answer "does anything
# bridge into chain 4663" — so the site has to ask for itself, and the three
# answers it can get (yes / asked-and-no / nobody-answered) must stay distinct.
# Conflating the last two would have the page claim a fact it never learned.
set -uo pipefail
cd "$(dirname "$0")/.."

MOCK=8792
pass=0; fail=0
ck() { if [ "$2" = "$3" ]; then echo "PASS  $1"; pass=$((pass+1));
       else echo "FAIL  $1"; echo "      got:  $2"; echo "      want: $3"; fail=$((fail+1)); fi }
j() { echo "$1" | python3 -c "import sys,json;d=json.load(sys.stdin);print($2)" 2>/dev/null || echo PARSE_ERROR; }

# One server for the whole run. Each case selects its behaviour with ?mode=,
# rather than restarting on the same port between assertions.
php -S 127.0.0.1:$MOCK -t test test/mock-market.php >/dev/null 2>&1 & SRV=$!
sleep 1.2
trap 'kill $SRV 2>/dev/null' EXIT

run() { # $1 = script, rest = env
  rm -f /tmp/robin_tokens.json /tmp/robin_bridge.json
  env SCAN_EXPLORER="http://127.0.0.1:$MOCK/api/v2" SCAN_DS="http://127.0.0.1:$MOCK/dex" \
    php -r "\$_GET=[];\$_SERVER['REQUEST_METHOD']='GET';include '$1';" 2>&1
}

# ── the token list ───────────────────────────────────────────────────────
T=$(run api/tokens.php)
ck "the list is built"            "$(j "$T" 'd["count"]')" "2"
ck "the deepest market leads"     "$(j "$T" 'd["tokens"][0]["symbol"]')" "DEEP"
ck "a token too thin to trade is dropped" "$(j "$T" '"DEAD" in [t["symbol"] for t in d["tokens"]]')" "False"
ck "…and it really was in the explorer's list" "$(j "$T" 'd["count"] < 3')" "True"
ck "prices came through"          "$(j "$T" 'round(d["tokens"][1]["priceUsd"],8)')" "7.012e-05"
ck "so did liquidity"             "$(j "$T" 'int(d["tokens"][0]["liquidity"])')" "260000"
ck "and the explorer's metadata"  "$(j "$T" 'd["tokens"][1]["name"]')" "Robin Nakamoto"
ck "both sources are reported"    "$(j "$T" 'd["reached"]["explorer"] and d["reached"]["dexscreener"]')" "True"


# ── the bridge probe ─────────────────────────────────────────────────────
# The probe queries real aggregators, so point every provider at the stand-in.
bridge() { # $1 = what the aggregators should answer
  rm -f /tmp/robin_bridge.json
  ROBIN_BRIDGE_URLS="http://127.0.0.1:$MOCK/chains?mode=$1" \
    php -r "\$_GET=[];\$_SERVER['REQUEST_METHOD']='GET';include 'api/bridge.php';" 2>&1
}

B=$(bridge no)
ck "asked, and nobody bridges it" "$(j "$B" 'd["status"]')" "none"
ck "no route is claimed"          "$(j "$B" 'len(d["via"])')" "0"

# ── one aggregator lists it ──────────────────────────────────────────────
B=$(bridge yes)
ck "a listed chain is found"      "$(j "$B" 'd["status"]')" "available"
ck "and the route is named"       "$(j "$B" 'len(d["via"]) > 0')" "True"

# ── nobody answers ───────────────────────────────────────────────────────
rm -f /tmp/robin_bridge.json
B=$(ROBIN_BRIDGE_URLS="http://127.0.0.1:9/chains" \
     php -r "\$_GET=[];\$_SERVER['REQUEST_METHOD']='GET';include 'api/bridge.php';" 2>&1)
ck "silence is not a no"          "$(j "$B" 'd["status"]')" "unknown"
ck "and silence is never cached"  "$([ -f /tmp/robin_bridge.json ] && echo yes || echo no)" "no"

# ── can Solana money actually get here? ──────────────────────────────────
# A chain being listed is not the same as the route existing, and "no route"
# is not the same as "we asked you wrongly". All three have to stay separate.
route() { # $1 = what the provider should answer
  rm -f /tmp/robin_route.json
  ROBIN_ROUTE_URLS="http://127.0.0.1:$MOCK/quote?mode=$1" \
    php -r "\$_GET=[];\$_SERVER['REQUEST_METHOD']='GET';include 'api/route.php';" 2>&1
}

R=$(route yes)
ck "a real quote proves the route"  "$(j "$R" 'd["status"]')" "available"
ck "and the amount comes back"      "$(j "$R" 'd["providers"]["probe0"]["out"]')" "318400000000000000"

R=$(route no)
ck "no route is a definite no"      "$(j "$R" 'd["status"]')" "none"
ck "in the provider's own words"    "$(j "$R" '"no route found" in d["providers"]["probe0"]["said"]')" "True"

R=$(route bad)
ck "a bad request is not a no"      "$(j "$R" 'd["providers"]["probe0"]["said"]')" "unknown parameter toChain"
ck "…and is still reachable"        "$(j "$R" 'd["providers"]["probe0"]["reachable"]')" "True"

rm -f /tmp/robin_route.json
R=$(ROBIN_ROUTE_URLS="http://127.0.0.1:9/quote" \
     php -r "\$_GET=[];\$_SERVER['REQUEST_METHOD']='GET';include 'api/route.php';" 2>&1)
ck "silence is not a no"            "$(j "$R" 'd["status"]')" "unknown"
ck "and is never cached"            "$([ -f /tmp/robin_route.json ] && echo yes || echo no)" "no"

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
