#!/bin/sh
cd "$(dirname "$0")"
NODE="${NODE:-node}"
if ! command -v "$NODE" >/dev/null 2>&1; then
  NODE="/Applications/Cursor.app/Contents/Resources/app/resources/helpers/node"
fi
PORT="${PORT:-8888}"
exec "$NODE" server.js
