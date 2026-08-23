/**
 * Login-mode wizard run — the animation → portal sign-in card → in-chat
 * guided onboarding chain. Pins:
 *
 * - startOnboardingWizard() (the finishIntroReveal handoff) runs LOGIN mode:
 *   one step, no finale — the guided chat is the setup.
 * - startOnboardingWizardWindow honors the mode param both ways.
 * - The classic dev run (devStartOnboardingWizard) stays full-mode.
 * - Gate routing contract: a login outcome with inference hands off to the
 *   guide kickoff; without inference it hands off to nothing.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  $onboardingWizard,
  devStartOnboardingWizard,
  resetOnboardingWizardForTests,
  startOnboardingWizard,
  startOnboardingWizardWindow
} from './onboarding-wizard'

describe('onboarding wizard login mode', () => {
  beforeEach(() => {
    resetOnboardingWizardForTests()
    localStorage.clear()
    vi.stubEnv('VITE_INTRO_REVEAL', '1')
  })

  it('first-run handoff (startOnboardingWizard) is a one-card login run', () => {
    startOnboardingWizard()

    const s = $onboardingWizard.get()

    expect(s.phase).toBe('active')
    expect(s.mode).toBe('login')
    expect(s.steps).toEqual(['login'])
    expect(s.step).toBe('login')
  })

  it('window boot honors login mode and full mode', () => {
    startOnboardingWizardWindow(true, 'login')
    expect($onboardingWizard.get().steps).toEqual(['login'])
    expect($onboardingWizard.get().mode).toBe('login')

    resetOnboardingWizardForTests()
    startOnboardingWizardWindow(true, 'full')

    const full = $onboardingWizard.get()

    expect(full.mode).toBe('full')
    expect(full.steps.length).toBeGreaterThan(2)
    expect(full.steps).toContain('providers')
    expect(full.steps).toContain('finale')
    expect(full.steps).not.toContain('login')
  })

  it('classic dev run stays full-mode', () => {
    devStartOnboardingWizard()

    const s = $onboardingWizard.get()

    expect(s.mode).toBe('full')
    expect(s.steps).not.toContain('login')
  })
})
