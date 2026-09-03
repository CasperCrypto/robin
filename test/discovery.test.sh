#!/usr/bin/env bash
# Proves the site can find a provider whose root, auth header and request shape
# all differ from the configured defaults — the situation that produced "The API
# key was rejected" on a key that was perfectly good.
set -uo pipefail
cd "$(dirname "$0")/.."

PORT=8791
pass=0; fail=0
ck() { if [ "$2" = "$3" ]; then echo "PASS  $1"; pass=$((pass+1));
       else echo "FAIL  $1"; echo "      got:  $2"; echo "      want: $3"; fail=$((fail+1)); fi }

selftest() { # $@ = extra $_GET keys as php array entries
  local get="$1"
  ROBIN_AI_KEY="${KEY:-GOODKEY}" ROBIN_AI_ROOTS="http://127.0.0.1:$PORT/v1" \
    timeout 60 php -r "\$_GET=$get;\$_SERVER['REQUEST_METHOD']='GET';include 'api/provider.php';" 2>&1
}

start() { MOCK_SHAPE="$1" php -S 127.0.0.1:$PORT -t test test/mock-provider.php >/dev/null 2>&1 & MOCK=$!; sleep 1.4; }
stop()  { kill $MOCK 2>/dev/null; sleep 0.4; }
trap 'kill $MOCK 2>/dev/null' EXIT

# ── discovery ────────────────────────────────────────────────────────────
# The mock lives at /v1, wants x-api-key, and speaks the Responses API —
# none of which match the defaults in api/provider.php.
start responses
rm -f /tmp/robin_endpoint.json
OUT=$(selftest '["selftest"=>"1","live"=>"1"]')

echo "$OUT" | grep -q "auth=x-api-key" && A=yes || A=no
ck "discovers the auth header" "$A" "yes"
echo "$OUT" | grep -q "shape=responses" && B=yes || B=no
ck "discovers the request shape" "$B" "yes"
echo "$OUT" | grep -qE "RESULT +the model answered" && C=yes || C=no
ck "gets a real answer back" "$C" "yes"
echo "$OUT" | grep -qE "THIS SHAPE WORKS: responses" && F=yes || F=no
ck "names the shape that worked" "$F" "yes"

# the working combination is cached so later requests skip discovery
[ -f /tmp/robin_endpoint.json ] && D=yes || D=no
ck "caches the combination" "$D" "yes"

# A wrong key must not be discovered past. Only the local root is offered here,
# so this stays fast — pointing it at the real candidate list would spend the
# whole discovery budget waiting on hosts this sandbox cannot reach.
rm -f /tmp/robin_endpoint.json
OUT2=$(KEY=WRONGKEY selftest '["selftest"=>"1"]')
echo "$OUT2" | grep -q "auth=x-api-key" && E=no || E=yes
ck "a bad key is not discovered past" "$E" "yes"
stop

# ── the cascade ──────────────────────────────────────────────────────────
# A provider whose /responses rejects the request with a 400 and only answers
# at /chat/completions. A 400 has to move the search on just like a 404 does.
start chat
rm -f /tmp/robin_endpoint.json
OUT3=$(selftest '["selftest"=>"1","live"=>"1"]')

echo "$OUT3" | grep -qE "THIS SHAPE WORKS: chat" && G=yes || G=no
ck "falls through a 400 to the shape that works" "$G" "yes"
echo "$OUT3" | grep -q "does not support the input parameter" && H=yes || H=no
ck "shows the provider's own rejection" "$H" "yes"
stop

# ── transient upstream failure ───────────────────────────────────────────
# A 5xx gets one quiet retry, then a report carrying the provider's own words
# rather than a shrug. This is what "try again in a moment" used to hide.
start fail500
rm -f /tmp/robin_endpoint.json
OUT4=$(selftest '["selftest"=>"1","live"=>"1"]')

echo "$OUT4" | grep -q "server error, twice" && I=yes || I=no
ck "a 5xx is retried before reporting" "$I" "yes"
echo "$OUT4" | grep -q "upstream capacity exceeded" && J=yes || J=no
ck "the report quotes the provider" "$J" "yes"
echo "$OUT4" | grep -q '"tried"' && K=yes || K=no
ck "the report is machine-readable for the copy button" "$K" "yes"
stop

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
