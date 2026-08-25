# Guided Onboarding — "Setup Bot" Flow

The first-run chain: **cinematic → solo guided chat with the Setup bot → the
user's first task, built live by a bot minted for it.** No wizard window, no
sign-in card, no survey-for-its-own-sake. The user walks out having *done
something* — and with two agents in their roster: the one that built it, and
the guide that stays.

Bot mode's twist on the first-build flow: the guided chat is not an anonymous
session. It is the canonical **Bot Chat of a persistent `hermes-setup`
profile** ("Setup" in the agents roster). Setup runs the same beats as before,
but it does not build the task itself — once the task is decided it hands off
to a **new bot minted around that task**, and stays alive as training wheels:
it hears how the handoff went, schedules its own check-in crons, and offers
the next step when there is a genuinely useful one.

## Script (the model's runbook)

1. **Name** — "What should I call you?" (one turn, warm)
2. **Theme** — `::onboarding{step="look"}` (accent pick, live retint)
3. **Connectors** — `::onboarding{step="connectors"}` (tools they use; stored, not wired)
4. **Layout** — `::onboarding{step="layout"}` (the app assembles around the chat)
5. **The fork** — "Do you know what you'd like to build? I'll spin up an agent
   dedicated to it. We can automate something you already do on the computer,
   or figure it out together."

### Branch A — they have something in mind (general or specific)

6a. If general: surface **generated options** as tappable chips —
    `::onboarding{step="first" options="…|…|…"}` — 2–4 options spanning simple
    (a reminder) to complex (a dashboard), all specific to what they said.
    If specific: skip the card, go straight to 7a.

    **Every branch is NO-AUTH, not local-only.** The first build must need
    zero external accounts — but the browser, web search, scripts, and
    computer use are all fair game, and the more VISIBLE the better (research
    with the browser shown to the user as it works is the strongest demo).
    Never Gmail/Slack/Google sign-in: connectors get wired later, on the
    user's request. If their idea needs one, shape the task around its
    no-auth core and name the connection as a later step.
7a. **The handoff.** The chip tap (or their message) decides the task. Setup
    replies with ONE short framing sentence and emits
    `::onboarding{step="handoff" task="…" brief="…"}` — it does NOT start the
    work. The renderer mints a profile around the task (soul from the
    conversation, name from the task), seeds its hidden Bot Chat with the
    work-side runbook, moves the user into it, and submits Setup's brief as
    the user's first visible turn. The build starts from that turn.
8a. **Permissions note** (task bot, one short sentence as work begins):
    "I'll ask for permissions as we go — say no to anything."
9a. **Progress artifact** — `::onboarding{step="progress"}` renders a
    live-updating card in the TASK bot's transcript while the build runs.

### Branch B — not sure

6c. "What's something you wish you spent less time doing on the computer?"
    - They answer → follow up generatively (1 turn, get specific) → Branch A (6a).
    - "idk" → 7d: "What do you use your computer for?" → follow up generatively
      → Branch A (6a).

### After the handoff — Setup stays alive

- The renderer whispers a hidden `[setup] handoff complete` note into Setup's
  chat. Setup says one goodbye-for-now line and **schedules itself a check-in
  cron** (cronjob tool) that reviews what the user has actually set up so far
  and offers ONE next step when a useful one exists — wiring a connector they
  named, scheduling something they repeat, a second build.
- The desktop backend ticks every profile's cron store (live-enumerated), so
  those check-ins fire without the app babysitting a per-profile backend.
- If minting the task bot fails, the whisper says so instead and Setup builds
  the task in its own chat — the PR-12 single-chat shape as the fallback, so
  the flow never dead-ends.

## What the user walks away with

- A configured app (theme, layout, connectors noted) — the old wizard's job,
  done conversationally.
- A first task *started or built* — the competence moment.
- **A roster**: the task bot that owns their first build, and Setup — a guide
  they can always come back to, ignore, or retire. Training wheels.
- A mental model of how Hermes works: agents are minted around jobs, they ask,
  they build, they show progress, they check in.

## What deliberately does NOT happen

- **No login wall.** Inference is already configured (or the classic runtime
  check catches the first send). The chain never stops to authenticate.
  (When the sign-in / cloud-vs-local moment lands, it belongs AFTER the task
  has been decided and begun — likely anchored at the handoff — not here.)
- **No survey fatigue.** Every question either configures the app or feeds the
  first build. Nothing is collected "for later."
- **No nagging.** Setup's check-ins are one concrete suggestion or silence;
  "stop checking in" stops them.

## Flow graph

```
                ┌─────────────┐
                │  cinematic  │  (intro reveal — welcome splash)
                └──────┬──────┘
                       ▼
                ┌──────────────────┐
                │  solo chat        │  small window, no sidebar/statusbar —
                │  = Setup's        │  the hidden canonical Bot Chat of the
                │  Bot Chat         │  hermes-setup profile
                │  1. name          │
                └──────┬───────────┘
                       ▼
                (2. theme → 3. connectors → 4. layout — cards as before,
                 app assembles at the layout pick)
                       ▼
                ┌─────────────┐
                │ 5. the fork │  "Do you know what you'd like to build?"
                └──┬───┬───┬──┘
                   │   │   │
        ┌──────────┘   │   └──────────┐
        ▼              ▼              ▼
  ┌──────────┐  ┌──────────┐  ┌──────────────┐
  │ specific │  │ general  │  │  not sure    │
  │ in mind  │  │  idea    │  │ (6c/7d probe)│
  └────┬─────┘  └────┬─────┘  └──────┬───────┘
       │             ▼               │
       │      ┌──────────────┐       │
       │      │ 6a. generated │◀──────┘
       │      │ options card  │  ::onboarding{step="first" options="…"}
       │      └──────┬───────┘
       │             │ tap = the task is decided
       ▼             ▼
       ┌─────────────────────────┐
       │ 7a. HANDOFF              │  ::onboarding{step="handoff" task brief}
       │ mint task bot + its      │  renderer: profiles.create → seeded
       │ hidden Bot Chat          │  session.create → switch → visible brief
       └───────┬─────────────┬───┘
               ▼             ▼
   ┌───────────────────┐   ┌────────────────────────┐
   │ TASK BOT's chat   │   │ SETUP's chat (alive)   │
   │ 8a. permissions   │   │ hidden [setup] note →  │
   │ 9a. progress cards│   │ goodbye-for-now line + │
   │ the build runs    │   │ check-in cron schedule │
   └───────────────────┘   └────────────────────────┘
```

## The cards (transcript directives)

| step | attrs | renders | tap does |
|------|-------|---------|----------|
| `look` | — | accent swatches | retints live, hidden `[setup]` report |
| `connectors` | — | connector chips | stored, hidden `[setup]` report |
| `layout` | — | layout previews | assembles the app live, hidden `[setup]` report |
| `first` | `options="A\|B\|C"` | generated chips | **visible user turn** — decides the task |
| `handoff` | `task="…" brief="…"` | one-line status (spinning up → built) | none — raises the handoff beacon on settle; the wiring mints + switches |
| `progress` | `title="…"` | live build card (task bot's chat) | read-only; updates as the work streams |
