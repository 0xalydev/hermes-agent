/**
 * Quiet single retry for the guided onboarding chat.
 *
 * First-run turns ride on a cold stack (fresh HERMES_HOME, first portal
 * token, cold gateway) — the odd transient 4xx/5xx mid-flow is a when, not
 * an if, and a raw red "HTTP 403" row in the middle of the magical setup is
 * the worst possible surface for it (seen live: portal 403'd one turn right
 * after the color pick; the same key served 200s seconds later).
 *
 * The machine-generated turns are the safe ones to retry: the hidden
 * `[setup] …` reports and the kickoff brief. They're idempotent (a pick
 * report re-sent is the same pick), and the turn that failed delivered
 * NOTHING (streaming died before first token), so resubmitting cannot
 * duplicate content. User-typed turns are never touched — people can and do
 * retype.
 *
 * Budget: ONE retry per remembered submit. A second failure surfaces
 * normally — persistent errors must never be swallowed into a silent loop.
 */

import { requestComposerSubmit } from '@/app/chat/composer/focus'

import { $chatOnboardingSolo, $chatOnboardingThreadIds } from './assembly'

const RETRY_DELAY_MS = 2500

let lastSubmit: { retried: boolean; text: string } | null = null

/** Remember a hidden onboarding submit (kickoff brief or `[setup]` report)
 *  so a transient turn failure can replay it once. */
export function rememberOnboardingSubmit(text: string): void {
  lastSubmit = { retried: false, text }
}

/** DEV/tests: forget the remembered submit. */
export function resetOnboardingRetryForTests(): void {
  lastSubmit = null
}

/**
 * A turn in `sessionId` just failed with NOTHING delivered. If it belongs to
 * the guided onboarding chat and the last submit still has retry budget,
 * schedule the quiet replay and return true — the caller then keeps the
 * error out of the transcript/toasts. Returns false when the error should
 * surface normally.
 */
export function scheduleOnboardingRetry(sessionId: string): boolean {
  const onboardingSession = $chatOnboardingSolo.get() || $chatOnboardingThreadIds.get().includes(sessionId)

  if (!onboardingSession || !lastSubmit || lastSubmit.retried) {
    return false
  }

  lastSubmit.retried = true
  const { text } = lastSubmit

  window.setTimeout(() => {
    requestComposerSubmit(text, { displayKind: 'hidden' })
  }, RETRY_DELAY_MS)

  return true
}
