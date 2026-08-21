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

import { readJson, writeJson, readKey, writeKey } from '@/lib/storage'

import { $instantAccount, instantSuppressesOnboarding } from './instant-account'
import { clearIntroRevealSeen, hasSeenIntroReveal, isIntroRevealEnabled } from './intro-reveal'
import { $desktopOnboarding } from './onboarding'

const DONE_KEY = 'hermes-onboarding-wizard-done-v1'
const ANSWERS_KEY = 'hermes-onboarding-wizard-answers-v1'

export type WizardStepId =
  | 'welcome'
  | 'personalize'
  | 'connectors'
  | 'appearance'
  | 'system'
  /** Only present when no inference path exists (instant mint failed/off). */
  | 'providers'
  /** Cinematic full-bleed "Welcome to your agent" before the app appears. */
  | 'finale'

export interface WizardAnswers {
  /** What the user wants to be called. Optional — empty is fine. */
  name: string
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
  focus: [],
  keepInDock: true,
  layout: 'focus',
  name: '',
  openAtLogin: false,
  theme: 'nous'
}

export interface OnboardingWizardState {
  phase: 'hidden' | 'active'
  step: WizardStepId
  /** Step list for this run (provider step is conditional). */
  steps: WizardStepId[]
}

/** Outcome the wizard window reports back over IPC (see preload/global.d.ts). */
export interface OnboardingWizardOutcome {
  /** False when the user skipped setup. */
  completed: boolean
  /** False when the run needed a provider and none was configured (the step
   *  was skipped past) — the first-chat kickoff has nothing to greet with. */
  providerReady?: boolean
}

const INITIAL: OnboardingWizardState = {
  phase: 'hidden',
  step: 'welcome',
  steps: []
}

export const $onboardingWizard = atom<OnboardingWizardState>(INITIAL)

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

  steps.push('system', 'finale')

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
 *  gate on mid-flow restarts. No-ops once done. */
export function startOnboardingWizard(): void {
  if (!isIntroRevealEnabled() || hasCompletedOnboardingWizard()) {
    return
  }

  const steps = buildSteps()

  $onboardingWizard.set({ phase: 'active', step: steps[0], steps })
}

/** Boot the surface inside the dedicated `?win=onboarding` window. That window
 *  is gateway-less, so the provider decision arrives from the main renderer
 *  via the open IPC → query param instead of being computed here. */
export function startOnboardingWizardWindow(includeProviders: boolean): void {
  const steps = buildSteps(includeProviders)

  $onboardingWizard.set({ phase: 'active', step: steps[0], steps })
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

/** Hard reset for tests. */
export function resetOnboardingWizardForTests(): void {
  $onboardingWizard.set(INITIAL)
  $wizardAnswers.set({ ...DEFAULT_ANSWERS })
}

// ── Dev hooks (installed by the gate in dev builds only) ─────────────────────

/** Stage baked by the `npm run dev:{movie,onboarding,kickoff,full}` entry
 *  points (VITE_ONBOARDING_STAGE). The gate auto-launches it on boot;
 *  'wizard' also pauses the finale so its animation can be iterated on. */
export type OnboardingDevStage = 'full' | 'kickoff' | 'movie' | 'wizard'

export function onboardingDevStage(): OnboardingDevStage | null {
  if (!import.meta.env.DEV) {
    return null
  }

  const stage: unknown = import.meta.env.VITE_ONBOARDING_STAGE

  return stage === 'full' || stage === 'kickoff' || stage === 'movie' || stage === 'wizard' ? stage : null
}

/** Force-start at any step, bypassing the build flag and the done-key.
 *  Jumping to the provider step forces it into the run even when the
 *  accountless path would have dropped it — every stage stays testable. */
export function devStartOnboardingWizard(step?: WizardStepId): void {
  const steps = buildSteps(step === 'providers' ? true : undefined)
  const target = step && steps.includes(step) ? step : steps[0]

  $onboardingWizard.set({ phase: 'active', step: target, steps })
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
