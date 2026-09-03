#!/usr/bin/env bash
# Runs the scanner against two known token profiles and checks it reaches the
# right verdict for the right reasons.
#
# The point of these two cases: a clean token must not be smeared, and a bad
# one must be called out — but neither verdict may come from a source that
# simply failed to answer. "We could not check" is a third outcome, and the
# scanner has to keep it separate from the other two.
set -uo pipefail
cd "$(dirname "$0")/.."

APP=8793      # the site, serving api/scan.php
MOCK=8794     # stands in for Blockscout and DexScreener
ADDR=0x280413fbf06ccc1114094a5967db2191d49ee75e

pass=0; fail=0
ck() { if [ "$2" = "$3" ]; then echo "PASS  $1"; pass=$((pass+1));
       else echo "FAIL  $1"; echo "      got:  $2"; echo "      want: $3"; fail=$((fail+1)); fi }
has() { echo "$1" | grep -qF "$2" && echo yes || echo no; }
jq_() { echo "$1" | python3 -c "import sys,json;d=json.load(sys.stdin);print($2)"; }

scan() { # $1 = profile
  rm -f /tmp/robin_scan_*.json /tmp/robin_scan_*
  MOCK_TOKEN="$1" php -S 127.0.0.1:$MOCK -t test test/mock-chain.php >/dev/null 2>&1 &
  local m=$!
  SCAN_EXPLORER="http://127.0.0.1:$MOCK/api/v2" SCAN_DS="http://127.0.0.1:$MOCK/dex" ROBIN_AI_KEY="" \
    php -S 127.0.0.1:$APP -t . >/dev/null 2>&1 &
  local a=$!
  sleep 1.4
  curl -s -X POST "http://127.0.0.1:$APP/api/scan.php" \
       -H 'Content-Type: application/json' -d "{\"address\":\"$ADDR\"}"
  kill $m $a 2>/dev/null; wait $m $a 2>/dev/null
}

# Sources pointed at a port nothing is listening on: the scanner learns nothing
# and must say so, rather than turning silence into an accusation.
dead() {
  SCAN_EXPLORER="http://127.0.0.1:8799/api/v2" SCAN_DS="http://127.0.0.1:8799/dex" ROBIN_AI_KEY="" \
    php -S 127.0.0.1:$APP -t . >/dev/null 2>&1 &
  local a=$!
  sleep 1.2
  rm -f /tmp/robin_scan_*
  curl -s -X POST "http://127.0.0.1:$APP/api/scan.php" \
       -H 'Content-Type: application/json' -d "{\"address\":\"$ADDR\"}"
  kill $a 2>/dev/null; wait $a 2>/dev/null
}

CLEAN=$(scan clean)
RUG=$(scan rug)
DEAD=$(dead)

show() { echo "$1" | python3 -c '
import sys,json
d=json.load(sys.stdin)
print("  verdict:",d["verdict"],"-",d["label"],"  unreachable:",d["unreachable"] or "none")
for f in d["findings"]: print("   [%-7s] %s"%(f["level"],f["what"]))'; }
echo "=== clean ==="; show "$CLEAN"
echo "=== rug ===";   show "$RUG"
echo "=== unreachable ==="; show "$DEAD"
echo

ck "clean token passes"            "$(jq_ "$CLEAN" 'd["verdict"]')" "ok"
ck "clean token sees the pool"     "$(has "$CLEAN" 'No liquidity pool found')" "no"
ck "clean token has no unknowns"   "$(jq_ "$CLEAN" 'len(d["unreachable"])')" "0"
ck "clean token is verified"       "$(has "$CLEAN" 'Contract source is verified')" "yes"
ck "clean token reads liquidity"   "$(has "$CLEAN" 'Liquidity is $240')" "yes"

ck "rug is called high risk"       "$(jq_ "$RUG" 'd["verdict"]')" "high"
ck "rug: unverified is an answer"  "$(has "$RUG" 'Contract source is NOT verified')" "yes"
ck "rug: not blamed on the fetch"  "$(has "$RUG" 'Could not reach the explorer')" "no"
ck "rug: concentration is named"   "$(has "$RUG" 'Top wallets hold')" "yes"
ck "rug: thin liquidity is named"  "$(has "$RUG" 'Liquidity is only')" "yes"

ck "silence is not a verdict"      "$(jq_ "$DEAD" 'd["verdict"]')" "unknown"
ck "unreachable sources are named" "$(jq_ "$DEAD" 'len(d["unreachable"]) > 0')" "True"
ck "no risk claimed from nothing"  "$(jq_ "$DEAD" 'any(f["level"] == "bad" for f in d["findings"])')" "False"

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
