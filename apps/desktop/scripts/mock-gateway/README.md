# Mock gateway — scripted backend for onboarding dev

A zero-dependency stand-in for the real `hermes serve` backend. The dev
desktop window boots against it and gets every guided-onboarding turn
replayed from `scenario.py` — deterministic, millisecond-fast, fully
offline, no portal auth, no venv, no model calls.

This is the fix for "keep having issues running a dev copy of the desktop":
the flaky parts of the dev chain (backend spawn from the worktree venv,
portal auth pre-seed, slow real model turns, hidden populate sessions) are
gone. Vite + Electron still run locally because the renderer is what you
are iterating on.

## Run it

```bash
apps/desktop/scripts/dev-magic-mock.sh
```

One command: wipes the scratch profile, reuses or starts vite (5176), then
launches the dev window (CDP 9224). `HERMES_DESKTOP_PYTHON` points at
`mock_hermes_shim.py`, which intercepts the backend spawn the desktop
performs per profile:

- argv arrives as `-m hermes_cli.main --profile <p> serve --host … --port 0`
- the shim binds, announces `HERMES_BACKEND_READY port=<N>` on stdout (the
  exact contract the desktop main process parses), and serves the mock
- each PROFILE gets its own shim process; all processes share one state
  file (`HERMES_MOCK_STATE`, default `<profile-dir>/mock-state.json`, with
  an fcntl lock so cross-process updates are atomic) — Setup's chat, the
  minted task bot, and the roster are one logical gateway
- `/` serves the injected `window.__HERMES_SESSION_TOKEN__` page so the
  desktop's served-token adoption resolves cleanly

Standalone mode (no Electron spawn) still works too:

```bash
python3 apps/desktop/scripts/mock-gateway/mock_gateway.py   # port 8778
HERMES_DESKTOP_REMOTE_URL=http://127.0.0.1:8778 HERMES_DESKTOP_REMOTE_TOKEN=mock-dev npx electron .
```

## What it speaks

- **REST** (`/api/*`): status, health, config, model info/options, sessions
  list + messages (transcript hydration survives reload), profiles (+
  active, sessions, sidebar), cron, skills, env, memory, toolsets,
  fs/default-cwd, mcp, messaging, pairing, analytics, gh-auth, update-check
  — canned but shape-correct, so boot surfaces stay quiet.
- **WebSocket JSON-RPC 2.0** (`/api/ws?token=<anything>`): `session.create`
  (seeded messages, hidden, title), `session.list` (`include_hidden` +
  exact-title filter — the adopt-before-mint lookup), `session.title /
  resume / close / interrupt / set_hidden`, `config.set/get`,
  `setup.status / setup.runtime_check` (boot-paced, see below),
  `prompt.submit` (scenario-driven), `profiles.create / configure / list`
  (bot minting; duplicate profile name raises the same RPC error the real
  gateway does), `model.options`, `commands.catalog`, plus quiet stubs.
  Events broadcast to every open WS exactly like the real gateway:
  `session.info` running=true → `message.start` → `message.delta`* →
  `message.complete` → `session.info` running=false (the trailing
  running=false is what clears the composer's busy state).

## The scenario (scenario.py)

Routed by session profile:

| chat | trigger | reply |
|---|---|---|
| Setup (`hermes-setup`) | first visible message (the name) | `::onboarding{step="name" value="…"}` + look card |
| Setup | `[setup] accent color: …` (hidden) | connectors card |
| Setup | `[setup] connect later: …` (hidden) | layout card |
| Setup | `[setup] layout: …` (hidden) | the fork `::ask{question="Know what you'd like it to make?" …}` |
| Setup | fork: "Automate something I already do" | `::onboarding{step="first" options="…"}` chip card |
| Setup | fork: "I have something in mind" | asks what it is |
| Setup | fork: "Let's figure it out together" | probe question → chip card |
| Setup | the task (typed or chip tap) | `::onboarding{step="handoff" task="…" brief="…" surface="…"}` |
| Setup | `[setup] handoff complete` (hidden) | goodbye-for-now line |
| Setup | `[setup] handoff failed` (hidden) | builds in its own chat + progress card |
| task bot (any other profile) | the visible brief | permissions note + `::onboarding{step="progress" title="…"}` card |
| hidden helper (default profile) | "Design starter-screen modules" / "Fill in the starter screen" | validator-clean module / populate JSON (dormant dashboard flow) |

The handoff surface follows the layout rule: Elite → `session`, anything
else → `bot`. The handoff card renders both options and the user's tap
decides, so the mock never needs to know which one won.

## Boot pacing

The first-run intro only plays while the runtime reads UNCONFIGURED
(`configured === false` exactly). The mock answers readiness instantly, so
without pacing the app flips straight to configured and the cinematic is
skipped. For the first `MOCK_UNCONFIGURED_MS` (default 6000) of each shim
process's life, `setup.status` / `setup.runtime_check` answer unconfigured
— the same shape a real backend boot produces.

## Knobs

- `MOCK_PORT` / `MOCK_HOST` — standalone server bind
- `MOCK_CHAR_MS` (default 28) — streaming speed; visible turns replay at
  ~110 chars/s, hidden helper turns complete in ~120ms
- `MOCK_UNCONFIGURED_MS` (default 6000) — unconfigured boot window
- `HERMES_MOCK_STATE` — shared state file (all shim processes)
- `MOCK_TRACE=1` — append per-turn scenario traces to /tmp/mock-scenario.log
- Mock log: the shim's stdout is captured by the desktop (desktop.log);
  standalone logs go to stdout

## Tests

```bash
python3 apps/desktop/scripts/mock-gateway/test_mock.py
```

Exercises the whole Setup-bot flow at the protocol level: profile minting
(+ duplicate-name RPC error), seeded hidden canonical creation, the
adopt-before-mint title lookup, seed-message hydration, every guide turn,
the fork branches, the handoff directive, the task-bot brief + progress
card, the [setup] whisper back, cross-process shared-state visibility, and
the dormant dashboard JSON.

## Extending

Add a `Route` via the `@route('GET', r'/api/...')` decorator, an RPC branch
in `Gateway.handle_rpc`, or a scenario rule in `scenario.py`. Keep replies
on-contract with the renderer parsers — directive lines
(`::onboarding{step="…"}`, `::ask{…}`) must sit alone as their own
paragraph. The flow's authoritative spec is
`apps/desktop/src/components/onboarding-chat/FLOW.md`; keep the scenario in
sync with it.
