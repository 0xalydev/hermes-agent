import { beforeEach, describe, expect, it } from 'vitest'

import { $machine } from './machine'
import { buildChatOnboardingPrompt } from './onboarding-wizard'

/** Every `::onboarding{step="…"}` the runbook tells Setup to place. */
function cardsIn(runbook: string): string[] {
  return [...runbook.matchAll(/::onboarding\{step="([a-z-]+)"/g)].map(match => match[1])
}

describe('the onboarding runbook', () => {
  beforeEach(() => {
    $machine.set(null)
  })

  // The pacing rule can only hold if it names the cards the script actually
  // uses. A card added to a step but not to RULE 3 is a question the model has
  // no reason to stop after — which is how two of them ended up on screen at
  // once, each waiting on an answer the other was covering up.
  it('names every question card it places in the one-question rule', () => {
    const runbook = buildChatOnboardingPrompt()
    const rule = runbook.slice(runbook.indexOf('RULE 3'), runbook.indexOf('Your first message'))

    // Data-only directives are exempt by design: they render as nothing, so
    // they ride along with the question in their turn.
    const questions = new Set(cardsIn(runbook).filter(step => !['name', 'progress', 'working'].includes(step)))

    for (const step of questions) {
      expect(rule, `step="${step}" is placed but not named in RULE 3`).toContain(`step="${step}"`)
    }

    expect(questions.size).toBeGreaterThan(1)
  })

  it('tells Setup to stop after asking, not to keep going', () => {
    const runbook = buildChatOnboardingPrompt()

    expect(runbook).toContain('ONE question per turn')
    expect(runbook).toContain('Two questions in one message is a failure')
  })

  // Every directive shares its paragraph with nothing, because a directive the
  // model tacks onto the end of a sentence used to print as raw markup.
  it('asks for each directive on a line of its own', () => {
    const runbook = buildChatOnboardingPrompt()

    expect(runbook).not.toContain('include the line')
    expect(runbook).toContain('alone as its own paragraph')
  })
})
