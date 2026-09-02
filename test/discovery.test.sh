#!/usr/bin/env bash
# Proves the proxy can find a provider whose root, auth header and request
# shape all differ from the configured defaults — the situation that produced
# "The image service refused the request".
set -uo pipefail
cd "$(dirname "$0")/.."

PORT=8791
pass=0; fail=0
ck() { if [ "$2" = "$3" ]; then echo "PASS  $1"; pass=$((pass+1));
       else echo "FAIL  $1"; echo "      got:  $2"; echo "      want: $3"; fail=$((fail+1)); fi }

php -S 127.0.0.1:$PORT -t test test/mock-provider.php >/dev/null 2>&1 &
MOCK=$!
trap 'kill $MOCK 2>/dev/null' EXIT
sleep 1.5

rm -f /tmp/robin_endpoint.json

# The mock lives at /v1, wants x-api-key, and speaks the Responses API —
# none of which match the defaults in api/ai.php.
OUT=$(ROBIN_AI_KEY=GOODKEY ROBIN_AI_ROOTS="http://127.0.0.1:$PORT/v1" \
  php -r '$_GET=["selftest"=>"1","image"=>"1"];$_SERVER["REQUEST_METHOD"]="GET";include "api/ai.php";' 2>&1)

echo "$OUT" | grep -q "auth=x-api-key" && A=yes || A=no
ck "discovers the auth header" "$A" "yes"
echo "$OUT" | grep -q "shape=responses" && B=yes || B=no
ck "discovers the request shape" "$B" "yes"
echo "$OUT" | grep -q "RESULT     an image came back" && C=yes || C=no
ck "gets a real image back" "$C" "yes"

# the working combination is cached so later requests skip discovery
[ -f /tmp/robin_endpoint.json ] && D=yes || D=no
ck "caches the combination" "$D" "yes"

# A wrong key must not be discovered past. Only the local root is offered here,
# so this stays fast — pointing it at the real candidate list would spend the
# whole discovery budget waiting on hosts this sandbox cannot reach.
rm -f /tmp/robin_endpoint.json
OUT2=$(ROBIN_AI_KEY=WRONGKEY ROBIN_AI_ROOTS="http://127.0.0.1:$PORT/v1" \
  timeout 40 php -r '
    $_GET=["selftest"=>"1"];$_SERVER["REQUEST_METHOD"]="GET";include "api/ai.php";' 2>&1)
echo "$OUT2" | grep -q "auth=x-api-key" && E=no || E=yes
ck "a bad key is not discovered past" "$E" "yes"

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
