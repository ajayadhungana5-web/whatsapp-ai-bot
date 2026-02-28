#!/usr/bin/env bash
set -o errexit

echo "Installing npm dependencies..."
npm install

echo "Ensuring logs directory exists..."
mkdir -p logs

echo "Build complete!"
