#!/usr/bin/env bash
# Builds dist/ — exactly what gets uploaded to the web host — and zips it.
set -euo pipefail
cd "$(dirname "$0")"

rm -rf dist robin-site.zip
mkdir -p dist
cp -r index.html assets api README.md dist/

# Ship a starter config for the PHP key, but never a real one.
cat > dist/api/config.example.php <<'PHP'
<?php
/* Rename to config.php and paste your key. config.php is git-ignored.
   Prefer a real environment variable if your host supports one. */
return ['OPENROUTER_API_KEY' => 'sk-or-v1-...'];
PHP

( cd dist && zip -qr ../robin-site.zip . )
echo "dist/ ready · $(find dist -type f | wc -l) files · $(du -sh robin-site.zip | cut -f1) zip"
