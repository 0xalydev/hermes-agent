/**
 * The guided questionnaire's frame: a small fixed badge in the bottom-right
 * naming what this is ("Setting up Hermes") with an escape hatch. Skip
 * assembles the default layout, marks onboarding done, and drops the user in
 * the full app — the guided chat stays in the transcript. Visible from guide
 * kickoff until the layout pick assembles the app ($chatOnboardingSolo).
 */

import { useStore } from '@nanostores/react'

import { $chatOnboardingSolo, skipChatOnboarding } from '@/components/onboarding-chat/assembly'

export function OnboardingSkip() {
  const solo = useStore($chatOnboardingSolo)

  if (!solo) {
    return null
  }

  return (
    <div className="fixed right-5 bottom-24 z-40 flex items-center gap-2.5 rounded-full border border-border bg-card/80 py-1.5 pr-1.5 pl-3.5 shadow-sm backdrop-blur-sm">
      <span className="text-[11px] text-muted-foreground">Setting up Hermes</span>
      <button
        className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium text-secondary-foreground transition-colors hover:bg-primary hover:text-primary-foreground"
        onClick={skipChatOnboarding}
        type="button"
      >
        Skip setup →
      </button>
    </div>
  )
}
