/**
 * What Hermes knows about the computer it was just installed on.
 *
 * One question only: is this machine new? A brand-new computer makes "set this
 * thing up for me" the likeliest first task rather than one option among
 * several — drivers, updates, a package manager, the tools they just told us
 * they use — and it is a task Hermes can do end to end with no account
 * anywhere, which is exactly what the first build has to be.
 *
 * Loaded once, before the guided chat's runbook is composed.
 */

import { atom } from 'nanostores'

import type { DesktopMachineProfile } from '@/global'

/** A computer this young is almost certainly still being set up. Wide enough
 *  to cover the week someone spends getting around to it, short enough that a
 *  machine in daily use never trips it. */
const NEW_MACHINE_DAYS = 21

export const $machine = atom<DesktopMachineProfile | null>(null)

export async function loadMachineProfile(): Promise<void> {
  if ($machine.get()) {
    return
  }

  const profile = await window.hermesDesktop?.getMachineProfile?.().catch(() => null)

  if (profile) {
    $machine.set(profile)
  }
}

/** Unknown counts as not-new: the option is always offered, it just doesn't
 *  lead unless we can see a reason for it to. */
export function machineLooksNew(): boolean {
  const age = $machine.get()?.ageDays

  return age != null && age <= NEW_MACHINE_DAYS
}

/** An NVIDIA DGX Spark. A box nobody owns for its own sake — it is bought to
 *  be set up — so it takes the front of the flow whatever its account says
 *  about age. */
export function machineIsSpark(): boolean {
  return /\bdgx\b|\bspark\b/i.test($machine.get()?.model ?? '')
}

/** True when setting the machine up should be the only thing on offer, with
 *  everything else folded away behind one more tap. */
export function machineSetupLeads(): boolean {
  return machineIsSpark() || machineLooksNew()
}

/** What the user calls the thing in front of them. */
export function machineKind(): string {
  if (machineIsSpark()) {
    return 'Spark'
  }

  switch ($machine.get()?.platform) {
    case 'darwin':
      return 'Mac'

    case 'win32':
      return 'PC'

    default:
      return 'computer'
  }
}

/** One line for the machine-setup brief, so the agent that picks the job up
 *  starts knowing what it is looking at instead of asking. */
export function machineDescription(): string {
  const profile = $machine.get()

  if (!profile) {
    return ''
  }

  return [profile.model, `${profile.platform} ${profile.release}`, profile.arch].filter(Boolean).join(', ')
}

export function resetMachineProfileForTests(): void {
  $machine.set(null)
}
