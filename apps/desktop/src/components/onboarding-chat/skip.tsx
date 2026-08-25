/**
 * The guided setup's escape hatch: one quiet text link in the bottom-right.
 * Skip assembles the default layout, marks onboarding done, and drops the
 * user in the full app — the guided chat stays in the transcript. Visible
 * from guide kickoff until the layout pick assembles ($chatOnboardingSolo).
 */

import { useStore } from '@nanostores/react'

import { $chatOnboardingSolo, skipChatOnboarding } from '@/components/onboarding-chat/assembly'

export function OnboardingSkip() {
  const solo = useStore($chatOnboardingSolo)

  if (!solo) {
    return null
  }

  return (
    <button
      className="fixed right-5 bottom-24 z-40 text-[11px] text-(--ui-text-quaternary) transition-colors hover:text-(--ui-text-secondary)"
      onClick={skipChatOnboarding}
      type="button"
    >
      Skip setup
    </button>
  )
}
