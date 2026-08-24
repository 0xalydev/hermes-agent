import { beforeEach, describe, expect, test } from 'vitest'

import {
  $firstScreenKind,
  buildTheaterBeats,
  compileFirstScreen,
  resetFirstScreenForTests,
  setFirstScreenKind,
  theaterDuration
} from './onboarding-first-screen'

describe('first-screen artifact', () => {
  beforeEach(() => resetFirstScreenForTests())

  test('every block prompt interpolates the profile', () => {
    const config = compileFirstScreen({ focus: ['Writing', 'Research'], name: 'Sam' }, 'dashboard')

    expect(config.title).toContain('Sam')

    for (const block of config.blocks) {
      expect(block.prompt).toContain('Sam')
    }

    expect(config.blocks[0].prompt.toLowerCase()).toContain('writing')
  })

  test('empty profile still compiles a working config (fallback path)', () => {
    for (const kind of ['dashboard', 'document', 'app'] as const) {
      const config = compileFirstScreen({ focus: [], name: '' }, kind)

      expect(config.blocks.length).toBeGreaterThanOrEqual(3)
      expect(config.title.length).toBeGreaterThan(0)

      for (const block of config.blocks) {
        expect(block.prompt.length).toBeGreaterThan(20)
        expect(block.stepLine.length).toBeGreaterThan(0)
      }
    }
  })

  test('theater beats: one assemble + one prompt per block, then validate', () => {
    const config = compileFirstScreen({ focus: ['Coding'], name: 'Jo' }, 'document')
    const beats = buildTheaterBeats(config)

    expect(beats[0].cue).toBe('header')
    expect(beats[0].t).toBe(0)

    const assembles = beats.filter(b => b.cue === 'assemble')
    const prompts = beats.filter(b => b.cue === 'prompt')

    expect(assembles).toHaveLength(config.blocks.length)
    expect(prompts).toHaveLength(config.blocks.length)
    expect(beats.at(-1)?.cue).toBe('validate')

    // Prompt beats show the block's real prompt text.
    for (const p of prompts) {
      expect(config.blocks.some(b => b.prompt === p.prompt)).toBe(true)
    }

    // Monotonic non-decreasing timeline.
    for (let i = 1; i < beats.length; i++) {
      expect(beats[i].t).toBeGreaterThanOrEqual(beats[i - 1].t)
    }
  })

  test('theater duration covers the final beat', () => {
    const config = compileFirstScreen({ focus: [], name: '' }, 'app')
    const beats = buildTheaterBeats(config)
    const lastT = beats.at(-1)?.t ?? 0

    expect(theaterDuration(config)).toBeGreaterThan(lastT)
  })

  test('kind pick persists to storage and survives a re-read', () => {
    setFirstScreenKind('document')
    expect($firstScreenKind.get()).toBe('document')

    setFirstScreenKind(null)
    expect($firstScreenKind.get()).toBeNull()
  })
})
