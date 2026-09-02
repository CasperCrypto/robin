#!/usr/bin/env bash
# Builds dist/ — exactly what gets uploaded to the web host — and zips it.
set -euo pipefail
cd "$(dirname "$0")"

rm -rf dist robin-site.zip
mkdir -p dist
cp -r index.html assets api README.md dist/
cp .htaccess dist/

# forge-sample.webp exists only so the offline preview has something to show.
rm -f dist/assets/img/forge-sample.webp

# Ship the config file ready to edit, never with a key in it.
cat > dist/api/config.php <<'PHP'
<?php
/**
 * Paste your Concentrate.ai (or other provider) API key between the quotes,
 * save, and upload. That is the only thing the meme forge needs.
 *
 * This file is git-ignored and blocked from the web by .htaccess. If your key
 * has ever been pasted into a chat, an email or a screenshot, rotate it first.
 */
return ['ROBIN_AI_KEY' => ''];
PHP

( cd dist && zip -qr ../robin-site.zip . )
echo "dist/ ready · $(find dist -type f | wc -l) files · $(du -sh robin-site.zip | cut -f1) zip"
