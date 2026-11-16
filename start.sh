#!/bin/sh
# Starts Crest Forge on http://localhost:8080 and opens your browser. Needs Node.js 22 or newer.
# The first run installs and builds the app (about a minute). Extra arguments go to the server:
#   ./start.sh --port 3000     another port
#   ./start.sh --lan           reachable from other devices on your network
#   ./start.sh --rebuild       rebuild first (after pulling changes)
#   ./start.sh --no-open       don't open a browser (servers, SSH sessions)
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Crest Forge needs Node.js 22 or newer: https://nodejs.org" >&2
  exit 1
fi

rebuild=0
for arg in "$@"; do
  [ "$arg" = "--rebuild" ] && rebuild=1
done

if [ "$rebuild" = 1 ] || [ ! -f dist/index.html ]; then
  if [ ! -d node_modules ]; then
    echo "Installing dependencies..."
    npx -y pnpm@10 install --frozen-lockfile
  fi
  echo "Building..."
  npx -y pnpm@10 build
fi

exec node tools/serve.mjs --open "$@"
