#!/usr/bin/env bash
set -o errexit

# CRITICAL: Force Puppeteer to download Chrome INSIDE the project directory.
# Render deletes $HOME/.cache between build and runtime phases.
# Only files inside /opt/render/project/src/ survive to runtime.
# IMPORTANT: Use a NON-HIDDEN directory name (no dot prefix) to avoid cleanup.
export PUPPETEER_CACHE_DIR="/opt/render/project/src/puppeteer-cache"

echo "=== PUPPETEER_CACHE_DIR set to: $PUPPETEER_CACHE_DIR ==="

echo "Installing npm dependencies..."
npm install

echo "Installing Chrome browser into project cache..."
# Use @puppeteer/browsers CLI with explicit --path for guaranteed installation location
npx @puppeteer/browsers install chrome@stable --path "$PUPPETEER_CACHE_DIR"

echo "Verifying Chrome was installed..."
ls -laR "$PUPPETEER_CACHE_DIR/" 2>/dev/null | head -30 || echo "WARNING: Cache directory empty!"
CHROME_BIN=$(find "$PUPPETEER_CACHE_DIR" -name "chrome" -type f | head -1)
echo "=== Chrome binary found at: $CHROME_BIN ==="

if [ -z "$CHROME_BIN" ]; then
    echo "ERROR: Chrome binary not found! Trying fallback install..."
    npx puppeteer browsers install chrome
    CHROME_BIN=$(find "$PUPPETEER_CACHE_DIR" -name "chrome" -type f | head -1)
    echo "=== Fallback Chrome binary: $CHROME_BIN ==="
fi

# Save the resolved path for runtime to read
echo "$CHROME_BIN" > /opt/render/project/src/.chrome-path
echo "=== Chrome path saved to .chrome-path ==="

echo "Making Chrome binary executable..."
find "$PUPPETEER_CACHE_DIR" -name "chrome" -type f -exec chmod +x {} \;

echo "Ensuring logs directory exists..."
mkdir -p logs

echo "Build complete!"
