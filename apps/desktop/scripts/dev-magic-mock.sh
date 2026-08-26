#!/bin/bash
# Relaunch the onboarding dev chain against the MOCK backend. The desktop app
# spawns its own local backend for profile "default" — we intercept that spawn
# with HERMES_DESKTOP_PYTHON pointing at mock_hermes_shim.py, which announces
# HERMES_BACKEND_READY like `hermes serve` and then serves a scripted,
# deterministic gateway (no venv, no portal auth, no LLM). Every turn in the
# guided flow replays from scripts/mock-gateway/scenario.py in milliseconds.
#
# Pair this with dev-magic-flow.sh: the real-backend chain stays available for
# integration passes; this one is for UI iteration and demo takes.
set -euo pipefail

PROFILE=/tmp/hermes-magic-flow
WORKTREE=~/Documents/Work/nous/hermes-agent-src/.worktrees/chat-onboarding-anim
MOCK_DIR="$WORKTREE/apps/desktop/scripts/mock-gateway"

# 1. Down OUR previous dev instance only (the one carrying CDP 9224 in its
#    env). The production app and other worktrees' instances are left alone.
for PID in $(pgrep -f "Electron\.app/Contents/MacOS/Electron" 2>/dev/null || true); do
  if ps eww -p "$PID" -o command= 2>/dev/null | grep -q "HERMES_DESKTOP_CDP_PORT=9224"; then
    kill "$PID" 2>/dev/null || true
  fi
done
sleep 2

# 2. Fresh profile — nothing to seed: the mock answers everything.
rm -rf "$PROFILE"
mkdir -p "$PROFILE"

# 3. Vite: start it if 5176 isn't already serving.
if ! curl -s -o /dev/null --max-time 2 http://127.0.0.1:5176; then
  cd "$WORKTREE/apps/desktop"
  nohup env VITE_INTRO_REVEAL=1 npx vite --host 127.0.0.1 --port 5176 \
    > /tmp/magic-flow-vite.log 2>&1 &
  for _ in $(seq 1 30); do
    curl -s -o /dev/null --max-time 1 http://127.0.0.1:5176 && break
    sleep 1
  done
fi

# 4. Launch. HERMES_DESKTOP_PYTHON intercepts the local backend spawn; the
#    shim announces readiness on an ephemeral port and serves the mock. Every
#    shim process (one per profile) shares HERMES_MOCK_STATE, so Setup's chat,
#    the minted task bot, and the roster are one logical gateway.
cd "$WORKTREE/apps/desktop"
exec env HERMES_HOME="$PROFILE" HERMES_DESKTOP_USER_DATA_DIR="$PROFILE" \
  HERMES_DESKTOP_CDP_PORT=9224 HERMES_DESKTOP_DEV_SERVER=http://127.0.0.1:5176 \
  HERMES_DESKTOP_PYTHON="$MOCK_DIR/mock_hermes_shim.py" \
  HERMES_MOCK_STATE="$PROFILE/mock-state.json" \
  VITE_INTRO_REVEAL=1 npx electron . \
  --disable-backgrounding-occluded-windows --disable-renderer-backgrounding
