#!/usr/bin/env bash
# Exit on error
set -o errexit

echo "Installing Puppeteer dependencies..."

# Install all necessary shared libraries for Chrome on Debian/Ubuntu/Alpine depending on Render's base OS
# Playwright's dependency installer is the most robust way to get all Chrome deps without hardcoding them
npx playwright install-deps chromium

# Download the chromium browser into the cache
npx puppeteer browsers install chrome

echo "Installing npm dependencies..."
npm install
