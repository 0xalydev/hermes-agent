import { beforeEach, describe, expect, it } from 'vitest'

import type { DesktopMachineProfile } from '@/global'

import { $machine, machineIsSpark, machineKind, machineLooksNew, machineSetupLeads } from './machine'
import { forkFallbackOptions, forkOptions, machineForkOption } from './onboarding-wizard'

const profile = (patch: Partial<DesktopMachineProfile>): DesktopMachineProfile => ({
  ageDays: 900,
  arch: 'x64',
  model: '',
  platform: 'darwin',
  release: '24.6.0',
  ...patch
})

describe('machine profile', () => {
  beforeEach(() => {
    $machine.set(null)
  })

  it('reads a Spark off the hardware model, whatever the account age says', () => {
    $machine.set(profile({ ageDays: 900, arch: 'arm64', model: 'NVIDIA DGX Spark', platform: 'linux' }))

    expect(machineIsSpark()).toBe(true)
    expect(machineKind()).toBe('Spark')
    expect(machineSetupLeads()).toBe(true)
  })

  it('leads on a machine set up days ago, and stands down on a lived-in one', () => {
    $machine.set(profile({ ageDays: 3 }))
    expect(machineSetupLeads()).toBe(true)

    $machine.set(profile({ ageDays: 400 }))
    expect(machineLooksNew()).toBe(false)
    expect(machineSetupLeads()).toBe(false)
  })

  it('treats an unknown age as not-new rather than guessing', () => {
    $machine.set(profile({ ageDays: null }))

    expect(machineSetupLeads()).toBe(false)
  })

  it('names the machine the way the user would', () => {
    $machine.set(profile({ platform: 'darwin' }))
    expect(machineForkOption()).toBe('Help me set up this Mac')

    $machine.set(profile({ platform: 'win32' }))
    expect(machineForkOption()).toBe('Help me set up this PC')

    $machine.set(null)
    expect(machineForkOption()).toBe('Help me set up this computer')
  })
})

describe('the fork', () => {
  beforeEach(() => {
    $machine.set(null)
  })

  it('offers the new machine one job and folds the rest behind one tap', () => {
    $machine.set(profile({ ageDays: 2 }))

    expect(forkOptions()).toEqual(['Help me set up this Mac', 'Something else'])
    expect(forkFallbackOptions()).toHaveLength(4)
  })

  it('lists everything up front on a machine that is already someone’s', () => {
    $machine.set(profile({ ageDays: 400 }))

    const options = forkOptions()

    expect(options).toHaveLength(5)
    expect(options[0]).toBe('I have something in mind')
    expect(options).toContain('Help me set up this Mac')
    expect(forkFallbackOptions()).toEqual([])
  })

  it('never drops an option between the two tiers', () => {
    $machine.set(profile({ ageDays: 2 }))
    const twoTier = [...forkOptions().filter(option => option !== 'Something else'), ...forkFallbackOptions()]

    $machine.set(profile({ ageDays: 400 }))

    expect([...twoTier].sort()).toEqual([...forkOptions()].sort())
  })
})
