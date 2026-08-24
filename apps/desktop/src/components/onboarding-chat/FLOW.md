# Guided Onboarding — "First Build" Flow

The first-run chain: **cinematic → solo guided chat → the user's first task, built live.**
No wizard window, no sign-in card, no survey-for-its-own-sake. The user walks out
having *done something* — that's the only real onboarding.

## Script (the model's runbook)

1. **Name** — "What should I call you?" (one turn, warm)
2. **Theme** — `::onboarding{step="look"}` (accent pick, live retint)
3. **Connectors** — `::onboarding{step="connectors"}` (tools they use; stored, not wired)
4. **Layout** — `::onboarding{step="layout"}` (the app assembles around the chat)
5. **The fork** — "Do you know what you'd like to build with me? We can automate
   something you already do on the computer, or we can figure it out together."

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
    user's request. If their idea needs one, build the no-auth core first and
    name the connection as a later step.
7a. **Start the task.** The chip tap (or their message) IS the go signal — a real
    visible turn, and the model begins the work in the same conversation.
8a. **Permissions note** (one short turn, woven in as the work starts):
    "I'll ask for permissions as we go, and surface any connectors this needs.
    Say no to anything you don't want me to touch — or tell me if you have
    something specific in mind."
9a. **Progress artifact** — `::onboarding{step="progress"}` renders a live-updating
    card in the transcript (steps done / in-flight / next) while the build runs.
    Permissions prompts ride the session concurrently in the background.

### Branch B — not sure

6c. "What's something you wish you spent less time doing on the computer?"
    - They answer → follow up generatively (1 turn, get specific) → Branch A (6a).
    - "idk" → 7d: "What do you use your computer for?" → follow up generatively
      → Branch A (6a).

## What the user walks away with

- A configured app (theme, layout, connectors noted) — the old wizard's job, done
  conversationally.
- A first task *started or built* — the competence moment.
- A mental model of how Hermes works: it asks, it surfaces options, it builds,
  it asks permission, it shows progress.

## What deliberately does NOT happen

- **No bot is minted** unless the user asks for one (directly or indirectly).
  Bots are a power feature; onboarding's job is the first task, not the roster.
- **No login wall.** Inference is already configured (or the classic runtime
  check catches the first send). The chain never stops to authenticate.
- **No survey fatigue.** Every question either configures the app or feeds the
  first build. Nothing is collected "for later."

## Flow graph

```
                ┌─────────────┐
                │  cinematic  │  (intro reveal — welcome splash)
                └──────┬──────┘
                       ▼
                ┌─────────────┐
                │  solo chat  │  small window, no sidebar/statusbar
                │  1. name    │
                └──────┬──────┘
                       ▼
                ┌─────────────┐
                │ 2. theme    │  ::onboarding{step="look"}
                └──────┬──────┘
                       ▼
                ┌─────────────┐
                │ 3. connectors│ ::onboarding{step="connectors"}
                └──────┬──────┘
                       ▼
                ┌─────────────┐
                │ 4. layout   │  ::onboarding{step="layout"} → app assembles
                └──────┬──────┘
                       ▼
                ┌─────────────┐
                │ 5. the fork │  "Do you know what you'd like to build?"
                └──┬───┬───┬──┘
                   │   │   │
        ┌──────────┘   │   └──────────┐
        ▼              ▼              ▼
  ┌──────────┐  ┌──────────┐  ┌──────────────┐
  │ specific │  │ general  │  │  not sure    │
  │ in mind  │  │  idea    │  │              │
  └────┬─────┘  └────┬─────┘  └──────┬───────┘
       │             │               ▼
       │             │        ┌──────────────┐
       │             │        │ 6c. "what do │  ──idk──▶ 7d. "what do you
       │             │        │ you wish you │         use your computer
       │             │        │ spent less   │         for?"
       │             │        │ time doing?" │◀────────┘
       │             │        └──────┬───────┘
       │             │               │ (follow up, get specific)
       │             ▼               │
       │      ┌──────────────┐       │
       │      │ 6a. generated │◀──────┘
       │      │ options card  │  ::onboarding{step="first" options="…"}
       │      └──────┬───────┘
       │             │ tap = the go signal
       ▼             ▼
       ┌────────────────────┐
       │ 7a/6b. START TASK  │  real turn, work begins in this chat
       └─────────┬──────────┘
                 ▼
       ┌────────────────────┐
       │ 8a/7b. permissions │  "I'll ask as we go; say no to anything"
       │ note (one turn)    │
       └─────────┬──────────┘
                 ▼
       ┌────────────────────┐
       │ 9a/8b. progress    │  ::onboarding{step="progress"} — live card,
       │ artifact in convo  │  permissions ride concurrently in background
       └────────────────────┘
```

## The cards (transcript directives)

| step | attrs | renders | tap does |
|------|-------|---------|----------|
| `look` | — | accent swatches | retints live, hidden `[setup]` report |
| `connectors` | — | connector chips | stored, hidden `[setup]` report |
| `layout` | — | layout previews | assembles the app live, hidden `[setup]` report |
| `first` | `options="A\|B\|C"` | generated chips | **visible user turn** — the task starts |
| `progress` | `title="…"` | live build card | read-only; updates as the work streams |
