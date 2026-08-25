/**
 * Onboarding wizard — the Dia-style first-run setup that follows the intro
 * cinematic. A small curated modal (not an app takeover): welcome → personalize
 * → connectors → appearance → system, an optional provider step when no
 * inference path exists, then a cinematic "Welcome to your agent" finale that
 * dissolves straight into the first chat.
 *
 * Trigger contract:
 * - First run: `finishIntroReveal()` calls `startOnboardingWizard()` after the
 *   cinematic (skips included). If the app restarts mid-wizard, the gate
 *   restarts it — the intro's seen-key is set but the wizard's done-key isn't.
 * - The wizard is gated by the same build flag as the intro
 *   (`VITE_INTRO_REVEAL=1`); neither exists in unflagged builds.
 *
 * Answers persist live (localStorage) so a mid-flow restart keeps them, and so
 * the first-chat kickoff can read them after the wizard unmounts.
 */

import { atom } from 'nanostores'

import { readJson, readKey, writeJson, writeKey } from '@/lib/storage'
import { VOICE_RULES } from '@/store/onboarding-first-screen'

import { $instantAccount, instantSuppressesOnboarding } from './instant-account'
import { clearIntroRevealSeen, hasSeenIntroReveal, isIntroRevealEnabled } from './intro-reveal'
import { $desktopOnboarding } from './onboarding'
import { setOnboardingSurfaceActive } from './onboarding-presence'

const DONE_KEY = 'hermes-onboarding-wizard-done-v1'
const ANSWERS_KEY = 'hermes-onboarding-wizard-answers-v1'

export type WizardStepId =
  /** Pick what your first screen should be — dashboard, document, or app. */
  | 'first-screen'
  | 'welcome'
  | 'personalize'
  | 'connectors'
  | 'appearance'
  | 'system'
  /** Only present when no inference path exists (instant mint failed/off). */
  | 'providers'
  /** The login-mode run's single step: sign in to Nous Portal (or any
   *  provider behind the disclosure), skippable. */
  | 'login'
  /** Cinematic full-bleed "Welcome to your agent" before the app appears. */
  | 'finale'

/** Which run the wizard window hosts:
 *  - 'full'  — the classic multi-step setup (dev:onboarding, screenshots).
 *  - 'login' — one card: portal sign-in, then the guided IN-CHAT setup takes
 *    over (the animation → login → chat chain). */
export type WizardRunMode = 'full' | 'login'

export interface WizardAnswers {
  /** What the user wants to be called. Optional — empty is fine. */
  name: string
  /** What they're actually working on right now, in their own words —
   *  the free-text answer that makes the first screen THEIRS instead of a
   *  template. Captured conversationally in the guided chat. */
  context: string
  /** Focus areas picked on the personalize step. */
  focus: string[]
  /** Connector ids toggled on (fake for now — stored, not wired). */
  connectors: string[]
  /** Theme skin committed on the appearance step. */
  theme: string
  /** Accent seed picked on the appearance step; null = the theme's own. */
  accent: null | string
  /** Layout preset id committed on the appearance step. */
  layout: string
  /** Keep Hermes in the dock (macOS nicety — stored, best-effort). */
  keepInDock: boolean
  /** Launch Hermes at login. */
  openAtLogin: boolean
}

export const DEFAULT_ANSWERS: WizardAnswers = {
  accent: null,
  connectors: [],
  context: '',
  focus: [],
  keepInDock: true,
  layout: 'basic',
  name: '',
  openAtLogin: false,
  theme: 'nous'
}

export interface OnboardingWizardState {
  phase: 'hidden' | 'active'
  step: WizardStepId
  /** Step list for this run (provider step is conditional). */
  steps: WizardStepId[]
  /** Which run this is — the gate forwards it to the dedicated window. */
  mode: WizardRunMode
}

/** Outcome the wizard window reports back over IPC (see preload/global.d.ts). */
export interface OnboardingWizardOutcome {
  /** False when the user skipped setup. */
  completed: boolean
  /** Full-run only: the first-screen artifact the finale built. The main
   *  window uses it to seed the first chat ("press a button, it does
   *  something") after the take-over. Absent on skip and in login mode. */
  firstScreen?: { configJson: string; filePath?: string; kind: string }
  /** False when the run needed a provider and none was configured (the step
   *  was skipped past) — the first-chat kickoff has nothing to greet with. */
  providerReady?: boolean
  /** Which run produced this outcome. Login-mode outcomes hand off to the
   *  in-chat guided setup instead of the greet kickoff. */
  mode?: WizardRunMode
  /** Login mode only: the app should come back as the small solo-chat window
   *  and run the guided in-chat setup (electron pre-sizes before showing). */
  soloChat?: boolean
}

const INITIAL: OnboardingWizardState = {
  mode: 'full',
  phase: 'hidden',
  step: 'welcome',
  steps: []
}

export const $onboardingWizard = atom<OnboardingWizardState>(INITIAL)

// Presence mirror — see onboarding-presence.ts (update toast stands down).
$onboardingWizard.subscribe(state => setOnboardingSurfaceActive('wizard', state.phase !== 'hidden'))

function loadAnswers(): WizardAnswers {
  const raw = readJson<Partial<WizardAnswers>>(ANSWERS_KEY)

  return { ...DEFAULT_ANSWERS, ...raw }
}

/** Dev reruns the wizard every launch (see hasCompletedOnboardingWizard) — it
 *  must also START clean every launch, not preloaded with the last run's
 *  picks. The stored blob is dropped too, so a run that touches nothing can't
 *  hand stale picks to the main window's commit. Prod resumes from storage. */
function initialAnswers(): WizardAnswers {
  if (import.meta.env.DEV) {
    writeJson(ANSWERS_KEY, null)

    return { ...DEFAULT_ANSWERS }
  }

  return loadAnswers()
}

export const $wizardAnswers = atom<WizardAnswers>(initialAnswers())

export function setWizardAnswers(patch: Partial<WizardAnswers>): void {
  const next = { ...$wizardAnswers.get(), ...patch }

  $wizardAnswers.set(next)
  writeJson(ANSWERS_KEY, next)
}

export function hasCompletedOnboardingWizard(): boolean {
  // Dev builds never persist "onboarded": every dev launch (with the intro
  // flag on) boots straight into the wizard for QA. Completing or skipping
  // still settles it for the running session — see `settledThisSession`.
  if (import.meta.env.DEV) {
    return false
  }

  return readKey(DONE_KEY) === '1'
}

function markDone(): void {
  writeKey(DONE_KEY, '1')
}

/** True when the wizard needs a provider step: no guest account is carrying
 *  inference AND the classic onboarding never completed. */
export function wizardNeedsProviderStep(): boolean {
  if (instantSuppressesOnboarding($instantAccount.get().status)) {
    return false
  }

  return $desktopOnboarding.get().configured !== true
}

function buildSteps(includeProviders = wizardNeedsProviderStep()): WizardStepId[] {
  const steps: WizardStepId[] = ['welcome', 'personalize', 'connectors', 'appearance']

  // The (conditional) provider step sits right before "Make Hermes at home" —
  // intelligence gets connected before the domestic niceties close the run.
  // TEMP dev: always in, every path (Electron included), so the step is
  // testable regardless of the accountless gate. Re-gate before ship.
  if (includeProviders || import.meta.env.DEV) {
    steps.push('providers')
  }

  steps.push('system', 'first-screen', 'finale')

  return steps
}

// Set once the wizard has run its course this session — completed, skipped,
// or its window closed with no outcome (⌘W). Stops the resume path from
// re-opening it mid-session; in dev (where the done-key is ignored) this is
// the only thing that ends it.
let settledThisSession = false

/** The gate's restart check: intro seen, wizard unfinished, flag on. */
export function shouldResumeOnboardingWizard(): boolean {
  return (
    !settledThisSession && isIntroRevealEnabled() && hasSeenIntroReveal() && !hasCompletedOnboardingWizard()
  )
}

/** The wizard window closed with no outcome — stand down for this session. */
export function dismissOnboardingWizardSession(): void {
  settledThisSession = true
  $onboardingWizard.set(INITIAL)
}

/** Begin (or resume) the wizard. Called by `finishIntroReveal()` and by the
 *  gate on mid-flow restarts. No-ops once done.
 *
 *  The first-run chain runs LOGIN mode: animation → ONE portal sign-in card →
 *  the guided in-chat setup (the Socratic questionnaire lives in the chat,
 *  ending with the first-screen build — the user must never sit in a modal
 *  past the sign-in). The classic multi-step run (picker + theater finale in
 *  the modal) stays reachable through the dev entries (`dev:onboarding`,
 *  `__onboarding.start`). */
export function startOnboardingWizard(mode: WizardRunMode = 'login'): void {
  if (!isIntroRevealEnabled() || hasCompletedOnboardingWizard()) {
    return
  }

  const steps: WizardStepId[] = mode === 'login' ? ['login'] : buildSteps()

  $onboardingWizard.set({ mode, phase: 'active', step: steps[0], steps })
}

/** Boot the surface inside the dedicated `?win=onboarding` window. That window
 *  is gateway-less, so the provider decision arrives from the main renderer
 *  via the open IPC → query param instead of being computed here. Login mode
 *  is kept for an explicit portal-sign-in-only handoff. */
export function startOnboardingWizardWindow(includeProviders: boolean, mode: WizardRunMode = 'full'): void {
  const steps: WizardStepId[] = mode === 'login' ? ['login'] : buildSteps(includeProviders)

  $onboardingWizard.set({ mode, phase: 'active', step: steps[0], steps })
}

/** Re-read answers persisted by the wizard WINDOW (shared origin storage) into
 *  this renderer's atom — the main renderer commits from these after `done`. */
export function reloadWizardAnswers(): WizardAnswers {
  const answers = loadAnswers()

  $wizardAnswers.set(answers)

  return answers
}

export function wizardStepIndex(state: OnboardingWizardState): number {
  return Math.max(0, state.steps.indexOf(state.step))
}

export function nextWizardStep(): void {
  const s = $onboardingWizard.get()

  if (s.phase !== 'active') {
    return
  }

  const index = wizardStepIndex(s)

  if (index >= s.steps.length - 1) {
    completeOnboardingWizard()

    return
  }

  $onboardingWizard.set({ ...s, step: s.steps[index + 1] })
}

export function backWizardStep(): void {
  const s = $onboardingWizard.get()
  const index = wizardStepIndex(s)

  if (s.phase !== 'active' || index === 0) {
    return
  }

  $onboardingWizard.set({ ...s, step: s.steps[index - 1] })
}

/** Skip the remainder — marks done so it never auto-shows again. */
export function skipOnboardingWizard(): void {
  settledThisSession = true
  markDone()
  $onboardingWizard.set(INITIAL)
}

/** Terminal state — the finale finished; the app (and first chat) take over. */
export function completeOnboardingWizard(): void {
  settledThisSession = true
  markDone()
  $onboardingWizard.set(INITIAL)
}

/** The hidden kickoff prompt seeded with onboarding answers. Sent with
 *  `display_kind=hidden` so Hermes greets first and the transcript starts
 *  with the model's message, not ours. */
export function buildKickoffPrompt(answers: WizardAnswers): string {
  const parts: string[] = [
    'The user just finished first-run setup of Hermes Desktop and this is their very first chat.',
    'This message is invisible to them — do not reference it, do not repeat their setup answers back as a list.'
  ]

  if (answers.name.trim()) {
    parts.push(`They asked to be called: ${answers.name.trim()}.`)
  }

  if (answers.focus.length > 0) {
    parts.push(`They said they want help with: ${answers.focus.join(', ')}.`)
  }

  parts.push(
    'Greet them briefly and warmly as Hermes, and suggest one concrete thing to try first' +
      (answers.focus.length > 0 ? ' based on what they want help with.' : '.'),
    'Two or three short sentences. No headers, no bullet lists.'
  )

  return parts.join(' ')
}

/** The hidden seed for IN-CHAT onboarding — the conversational twin of the
 *  wizard window. Hermes walks the user through the same setup, placing
 *  `::onboarding{step="…"}` cards that the renderer turns into live pickers
 *  (see components/onboarding-chat/directive.tsx).
 *  `greeting` is the PRE-BANKED opening line the app already rendered
 *  client-side (assembly.ts): the model must not greet again — its first
 *  reply is an invisible ack, so the cold first turn costs the user nothing. */
export function buildChatOnboardingPrompt(greeting = ''): string {
  return [
    'You are welcoming a brand-new user inside Hermes Desktop, and you are their setup guide.',
    'This message is invisible to them — never reference it or the mechanics described here.',
    'TWO ABSOLUTE RULES ABOVE EVERYTHING:',
    'RULE 1 — never think out loud. Every visible word you write is spoken TO the user. Never write "Let me check/re-read/reconsider", never recap what step you are on, never mention steps, directives, [setup], screen.json, prompts, or any mechanics in visible text. When you use tools, visible text is at most ONE short sentence to the user before the work and one after. Planning happens silently or not at all — a message that narrates your process instead of talking to the user is a failure.',
    'RULE 2 — never generate images, video, or audio during setup. No image_generate, no media tools, even for drafts or announcements, unless the user explicitly asks for an image. Text is the deliverable.',
    'Walk them through setup conversationally, ONE step per turn, in this order:',
    `1. The app has ALREADY greeted them with this exact message, shown on screen right now: "${greeting || "Hey, welcome to Hermes. I'll get you set up. What should I call you?"}". Do NOT greet again and do NOT repeat it. Reply to this setup message with ONLY the line ::onboarding{step="ready"} (it renders as nothing) — their name arrives in their next message.`,
    '2. After they tell you their name: include the line ::onboarding{step="name" value="THEIR_NAME"} with THEIR_NAME replaced by the actual name they gave (this line renders as nothing — it just saves the name). Then ask what they want help with, and include the line ::onboarding{step="focus"}',
    '3. After their focus picks arrive: a live sketch of their personal dashboard has just opened beside this chat — point at it in a few words (it keeps taking shape as they answer). Then ask, in one warm sentence, what they are actually working on right now — the real project, deadline, or problem on their plate this week. This is the answer that designs their dashboard, so if they are vague, ask ONE short follow-up for a concrete detail.',
    '4. After their answer: reply with one short sentence telling them their dashboard card is coming together below and to keep the modules they want, drop the rest, and press Continue. Then END the message with the line ::onboarding{step="context" value="THEIR_ANSWER"} (THEIR_ANSWER = a one-line summary of what they said, verbatim key details, under 140 characters). The card renders exactly where that line sits, so it MUST be the last line of your message — that is what makes "below" true.',
    '5. When their pick arrives as [setup] built…: acknowledge in ONE short sentence that their dashboard is open beside this chat and writing itself while you finish setup together. Then ask what color feels right for the app, and include the line ::onboarding{step="look"}',
    '6. Then the tools they already use day to day: one short sentence, and include the line ::onboarding{step="connectors"}',
    '7. Then their layout: one short sentence, and include the line ::onboarding{step="layout"}',
    '8. After the layout pick: do NOT wrap up. Look right with them — ask whether the dashboard beside this chat actually matches what they are working on, as an interactive question: one short sentence, then the line ::ask{question="Does the dashboard match your work?" options="Looks right|Change a module|Simpler, fewer cards|More power, more cards"} alone as its own paragraph, emitted EXACTLY as written — never rename, reorder, or invent options. ONE question at a time, and prefer ::ask pills over prose questions for every fork in this refinement dialogue. "Simpler" means: keep the 3 most essential blocks EXACTLY as they are, content included (stripping a kept block\'s content is a failure), delete the rest; "More power" means: add 1-2 denser blocks (tool/input kinds welcome) with full content. Both are screen.json edits you make yourself; never write a populating flag, keep populatedAt.',
    '9. When they want changes (different module, new angle, more specific to their project): rewrite their dashboard file yourself with your file tools — its absolute path is in the [setup] built message (saved to …/first-screen/screen.json). Read it first, keep the JSON schema exactly: each block is {id, kind, label, prompt, content} and the card body ALWAYS lives nested under "content" with its own "kind" ({"kind":"feed","items":[{"line","source"}]}, {"kind":"action","steps":[]}, {"kind":"draft","skeleton":""}, {"kind":"tool","example":{}}). When you change what a card is about, rewrite its label, its prompt, AND its content together — a renamed card with stale content is a failure. Write it back. The pane beside the chat repaints on save, so tell them to watch it change. Keep this refinement dialogue going: ask, edit, confirm, ask again — until they say it looks right.',
    '10. When they are happy with it: FIRST, actually write yourself a skill with your skill tool (skill_manage action=create): name it after their work (e.g. series-b-pr-outreach), and capture what you learned this session — who they are, the project, the angles and modules they kept, how they like drafts phrased. Keep it under 40 lines. Then tell them what just happened, in two sentences: Hermes runs on SKILLS — playbooks it writes for itself and updates as it learns how they work — you just saved one from this session (name it), and the "What Hermes has learned" card on their dashboard is the live view of it, leveling up as they keep working. Skills live under Capabilities in the sidebar, where they can also download more. Also tell them plainly the dashboard was built as an EXAMPLE of how Hermes works: they can ask for a new screen, tool, or plugin for anything they do often, anytime, right in chat.',
    '11. Then ask what to do with the dashboard via ::ask{question="Keep this dashboard around?" options="Keep it in my sidebar|Keep refining it|Clear it away"}. If they want it gone: delete the whole first-screen plugin folder (the directory holding the screen.json path from the [setup] message) with your file tools and confirm in one line. Then stand down.',
    'Whenever you draft reusable text for them (an email, a pitch, a template, a post), put the draft in a fenced code block so they can copy it in one click — never inline in your prose. Your own commentary stays outside the block.',
    'Interactive questions: whenever you ask the user to choose between things (in the refinement dialogue, after a dashboard button, anywhere), end the message with ::ask{question="..." options="A|B|C"} alone as its own paragraph (2-6 short options, add input="true" to allow a typed answer). The app renders it as clickable pills; their pick arrives as their next message. Every option must be a plain, concrete answer the user would actually say (an action or a preference, never jargon), and you must ACT on whichever option arrives, immediately — never re-ask the question, never re-emit an answered ::ask, never offer an option you cannot execute. Never enumerate options in prose when ::ask can carry them.',
    'Messages starting with [Onboarding Dashboard button] are the user pressing a button on their dashboard: DO the task and hand over the finished deliverable immediately — the list, the drafts, the plan itself. Example of the right shape: for "list each investor with the metric their check was sized on" you reply with the actual list (one line per investor, metric named), pulled from what they told you plus your tools, then stop. Never reply by describing what the module already covers, never ask whether to run it, and never edit the dashboard on a button press.',
    'Messages starting with [Onboarding Dashboard refresh] are the one exception: they ask you to update a feed card IN PLACE — follow their file-edit instructions exactly (search, rewrite that block\'s content in screen.json, save) so the card repaints; one line in chat when done.',
    'Messages starting with [Onboarding Dashboard choice] or [Onboarding Dashboard input] carry a DECISION about their project: give the deliverable in chat, then edit screen.json in the SAME turn to ripple the decision through the other cards it affects — they pick Zigbee for their smart home, so the shopping checklist gains the Zigbee-specific parts and any prompt that assumed another option gets re-aimed. Every decision ALSO updates the hermes-skill block (the "What Hermes has learned" card): add one short second-person line for what it taught you and increment content.version by 1 — the card visibly levels up. Untouched blocks stay byte-identical; one closing line names the cards you updated.',
    'Rules for the ::onboarding lines: emit each EXACTLY as written above, alone as its own paragraph — a blank line before and after, never two directives on the same line.',
    'The app renders an interactive picker there and applies choices to the app live, so do NOT list or describe the options in prose.',
    'Shape example for a tool-using turn: "On it, give me a moment." then the tool calls, then "Done. Your shopping list now carries the Zigbee parts." — nothing else.',
    'Never end a turn having only PROMISED an action. If you say you will edit the dashboard, save something, or set something up, the SAME turn must contain the actual tool calls that do it, then a one-line confirmation. Saying "I\'ll wire it in now" and stopping is a failure.',
    VOICE_RULES,
    'Their picks arrive as invisible messages prefixed [setup] — acknowledge each in a few words and move to the next step.',
    'Keep every turn short. This is a chat, not a form. No headers, no bullet lists, no emoji.'
  ].join(' ')
}

/** Hard reset for tests. */
export function resetOnboardingWizardForTests(): void {
  $onboardingWizard.set(INITIAL)
  $wizardAnswers.set({ ...DEFAULT_ANSWERS })
}

// ── Dev hooks (installed by the gate in dev builds only) ─────────────────────

/** Stage baked by the `npm run dev:{movie,onboarding,kickoff,chat,full}`
 *  entry points (VITE_ONBOARDING_STAGE). The gate auto-launches it on boot;
 *  'wizard' also pauses the finale so its animation can be iterated on;
 *  'chat' is the in-chat guided setup experiment. */
export type OnboardingDevStage = 'chat' | 'full' | 'kickoff' | 'movie' | 'wizard'

const DEV_STAGES: readonly string[] = ['chat', 'full', 'kickoff', 'movie', 'wizard']

export function onboardingDevStage(): OnboardingDevStage | null {
  if (!import.meta.env.DEV) {
    return null
  }

  const stage: unknown = import.meta.env.VITE_ONBOARDING_STAGE

  return typeof stage === 'string' && DEV_STAGES.includes(stage) ? (stage as OnboardingDevStage) : null
}

/** Force-start at any step, bypassing the build flag and the done-key.
 *  Jumping to the provider step forces it into the run even when the
 *  accountless path would have dropped it — every stage stays testable. */
export function devStartOnboardingWizard(step?: WizardStepId): void {
  const steps = buildSteps(step === 'providers' ? true : undefined)
  const target = step && steps.includes(step) ? step : steps[0]

  $onboardingWizard.set({ mode: 'full', phase: 'active', step: target, steps })
}

/** Forget everything: intro seen-key, wizard done-key, answers. */
export function devResetOnboardingFlow(): void {
  settledThisSession = false
  writeKey(DONE_KEY, null)
  writeJson(ANSWERS_KEY, null)
  clearIntroRevealSeen()
  $onboardingWizard.set(INITIAL)
  $wizardAnswers.set({ ...DEFAULT_ANSWERS })
}
