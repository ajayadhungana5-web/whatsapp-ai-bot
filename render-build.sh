#!/usr/bin/env bash
set -o errexit

# CRITICAL: Force Puppeteer to download Chrome INSIDE the project directory.
# Render deletes $HOME/.cache between build and runtime phases.
# Only files inside /opt/render/project/src/ survive to runtime.
export PUPPETEER_CACHE_DIR="/opt/render/project/src/.cache/puppeteer"

echo "=== PUPPETEER_CACHE_DIR set to: $PUPPETEER_CACHE_DIR ==="

echo "Installing npm dependencies..."
npm install

echo "Installing Chrome browser into project cache..."
npx puppeteer browsers install chrome

echo "Verifying Chrome was installed..."
ls -la "$PUPPETEER_CACHE_DIR/chrome/" || echo "WARNING: Chrome directory not found!"
find "$PUPPETEER_CACHE_DIR" -name "chrome" -type f || echo "WARNING: Chrome binary not found!"

echo "Build complete!"
