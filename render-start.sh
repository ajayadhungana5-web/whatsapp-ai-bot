#!/usr/bin/env bash
set -o errexit

export PUPPETEER_CACHE_DIR="/opt/render/project/src/puppeteer-cache"

echo "=== Installing Chrome browser at runtime ==="
npx @puppeteer/browsers install chrome@stable --path "$PUPPETEER_CACHE_DIR"

# Find and save the actual chrome binary path
CHROME_BIN=$(find "$PUPPETEER_CACHE_DIR" -name "chrome" -type f | head -1)
echo "=== Chrome installed at: $CHROME_BIN ==="

if [ -z "$CHROME_BIN" ]; then
    echo "ERROR: Chrome binary not found after install!"
    exit 1
fi

# Make it executable
chmod +x "$CHROME_BIN"

# Save path for Node.js to read
echo "$CHROME_BIN" > /opt/render/project/src/.chrome-path

echo "=== Starting server ==="
exec node src/server.js
