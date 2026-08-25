// @vitest-environment jsdom
// The first build's surface fork: Setup proposes (`surface="…"`), the user
// decides on the card, and everything downstream — what gets minted, where the
// chat shows up, what the task side is told it is — follows that one value.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { OnboardingChatDirective } from './directive'
import {
  $setupHandoff,
  buildHandoffCompleteNote,
  buildTaskBotRunbook,
  parseHandoffSurface,
  resetSetupHandoffForTests
} from './setup-bot'

const ANSWERS = { connectors: [], name: 'BK' } as unknown as Parameters<typeof buildTaskBotRunbook>[1]

const handoffAttrs = (surface?: string) => ({
  brief: 'Build me a plant watering tracker',
  step: 'handoff',
  task: 'Plant tracker',
  ...(surface === undefined ? {} : { surface })
})

describe('handoff surface', () => {
  afterEach(() => {
    cleanup()
    resetSetupHandoffForTests()
  })

  it('takes only the two known surfaces, ignoring anything else the model writes', () => {
    expect(parseHandoffSurface('bot')).toBe('bot')
    expect(parseHandoffSurface(' SESSION ')).toBe('session')
    expect(parseHandoffSurface('agent')).toBeNull()
    expect(parseHandoffSurface(undefined)).toBeNull()
  })

  it('offers both choices with Setup’s proposal leading', () => {
    render(<OnboardingChatDirective attrs={handoffAttrs('session')} streaming={false} />)

    const labels = screen.getAllByRole('button').map(button => button.textContent)

    expect(labels).toEqual(['Open it as a session', 'Give it its own agent'])

    cleanup()
    render(<OnboardingChatDirective attrs={handoffAttrs('bot')} streaming={false} />)

    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual([
      'Give it its own agent',
      'Open it as a session'
    ])
  })

  it('still asks — leading with a bot — when the model omits the attribute', () => {
    render(<OnboardingChatDirective attrs={handoffAttrs()} streaming={false} />)

    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual([
      'Give it its own agent',
      'Open it as a session'
    ])
  })

  it('raises the beacon with the surface the user picked, not the one proposed', () => {
    render(<OnboardingChatDirective attrs={handoffAttrs('bot')} streaming={false} />)

    expect($setupHandoff.get()).toBeNull()

    screen.getByRole('button', { name: 'Open it as a session' }).click()

    expect($setupHandoff.get()).toMatchObject({ phase: 'pending', surface: 'session', task: 'Plant tracker' })
  })

  it('never asks in a replayed transcript — a streaming turn is not a decision', () => {
    render(<OnboardingChatDirective attrs={handoffAttrs('bot')} streaming />)

    expect(screen.queryByRole('button', { name: 'Open it as a session' })).toBeNull()
    expect($setupHandoff.get()).toBeNull()
  })

  it('tells the task side which of the two it actually is', () => {
    expect(buildTaskBotRunbook('Plant tracker', ANSWERS, 'bot')).toContain('brand-new agent')
    expect(buildTaskBotRunbook('Plant tracker', ANSWERS, 'session')).toContain('opened this session')

    // Both keep the no-auth rule — the surface changes identity, not the brief.
    for (const surface of ['bot', 'session'] as const) {
      expect(buildTaskBotRunbook('Plant tracker', ANSWERS, surface)).toContain('NO external account')
    }
  })

  it('points Setup’s check-in note at wherever the build actually landed', () => {
    expect(buildHandoffCompleteNote('Plant tracker', 'Plant tracker', 'bot')).toContain("Plant tracker bot's chat")
    expect(buildHandoffCompleteNote('Plant tracker', 'Plant tracker', 'session')).toContain('a new session')

    // Either way Setup is told to schedule its own check-in.
    for (const surface of ['bot', 'session'] as const) {
      expect(buildHandoffCompleteNote('Plant tracker', 'Plant tracker', surface)).toContain('cron job')
    }
  })
})
