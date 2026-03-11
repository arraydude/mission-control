#!/bin/zsh
set -euo pipefail
cd /Users/emilianorosso/.openclaw/workspace/mida/apps/mission-control
exec /opt/homebrew/bin/npm run preview -- --host 127.0.0.1 --port 4174
