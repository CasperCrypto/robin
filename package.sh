#!/usr/bin/env bash
# Builds dist/ — exactly what gets uploaded to the web host — and zips it.
set -euo pipefail
cd "$(dirname "$0")"

rm -rf dist robin-site.zip
mkdir -p dist
cp -r index.html assets api README.md dist/
cp .htaccess dist/

# The arena writes its database into api/data at runtime. Ship the folder and
# its deny rule, never a local database.
mkdir -p dist/api/data
rm -f dist/api/data/arena.sqlite*

# Cache-bust: stamp every stylesheet and script with this build's id, so a
# re-upload is picked up immediately instead of being served from cache for an
# hour. This is why "I replaced the files and nothing changed" happens.
BUILD="$(date +%Y%m%d%H%M)"
sed -i -E "s|(href=\"assets/css/[^\"?]+)\"|\1?v=$BUILD\"|g; s|(src=\"assets/js/[^\"?]+)\"|\1?v=$BUILD\"|g" dist/index.html
echo "build id $BUILD stamped on $(grep -c "?v=$BUILD" dist/index.html) asset urls"


# The API key is injected from the environment at package time, never stored
# in this script or the repository:
#     ROBIN_AI_KEY=sk-... ./package.sh
# With no key set, the file ships empty and ready to edit.
KEY="${ROBIN_AI_KEY:-}"
cat > dist/api/config.php <<PHP
<?php
/**
 * API key for the scanner's plain-English summaries.
 *
 * SECURITY: if this key has ever been pasted into a chat, an email or a
 * screenshot, rotate it at your provider and replace the value below. This
 * file is blocked from the web by .htaccess and is git-ignored, but a key that
 * has already been shared is already public.
 */
return ['ROBIN_AI_KEY' => '${KEY}'];
PHP

if [ -n "$KEY" ]; then
  echo "api/config.php written WITH a key (${#KEY} chars) — rotate it if it has been shared"
else
  echo "api/config.php written empty — paste your key into it before uploading"
fi

( cd dist && zip -qr ../robin-site.zip . )
echo "dist/ ready · $(find dist -type f | wc -l) files · $(du -sh robin-site.zip | cut -f1) zip"
