/**
 * OnboardingWizardGate — orchestrates the Dia-style setup wizard.
 *
 * In Electron the wizard lives in its OWN OS window (`?win=onboarding`) and
 * the main app window stays hidden until it finishes — setup must never read
 * as an overlay on the app. This gate only coordinates: it asks main to open
 * the window when the store goes active, and commits the outcome when the
 * window reports back. In a plain browser (dev/screenshot loop) there is no
 * bridge, so the surface renders inline as a fallback.
 *
 * Entry paths:
 * - Normal: the intro cinematic's `finishIntroReveal()` starts the wizard.
 * - Resume: app restarted mid-wizard (intro seen, wizard not done) — this gate
 *   restarts it once the gateway is up.
 *
 * On completion the gate commits the answers that outlive the wizard (theme
 * sync + layout preset), then hands off to the first-chat kickoff (hidden
 * seeded turn; Hermes greets first). If the run still needs a provider (mint
 * failed and the user skipped the provider step), the kickoff is skipped —
 * there is nothing to greet with.
 */

import { useStore } from '@nanostores/react'
import { lazy, Suspense, useCallback, useEffect, useRef } from 'react'

import { startChatOnboardingSolo } from '@/components/onboarding-chat/assembly'
import type { LayoutNode } from '@/components/pane-shell/tree/model'
import { applyLayoutPreset } from '@/components/pane-shell/tree/presets'
import { registry } from '@/contrib/registry'
import { $introReveal, startIntroReveal } from '@/store/intro-reveal'
import {
  $guideKickoffPending,
  $onboardingWizard,
  completeOnboardingWizard,
  devResetOnboardingFlow,
  devStartOnboardingWizard,
  dismissOnboardingWizardSession,
  hasCompletedOnboardingWizard,
  onboardingDevStage,
  type OnboardingWizardOutcome,
  reloadWizardAnswers,
  seedGuideKickoffFromStorage,
  shouldResumeOnboardingWizard,
  shouldStartGuideKickoff,
  startOnboardingWizard,
  type WizardAnswers,
  wizardNeedsProviderStep,
  type WizardStepId
} from '@/store/onboarding-wizard'
import { useTheme } from '@/themes'
import { setAccentOverride } from '@/themes/accent-override'

const WizardSurface = lazy(async () => ({ default: (await import('./surface')).WizardSurface }))

const wizardBridge = () => window.hermesDesktop?.onboardingWizard

// One auto-launch per process: the `npm run dev:{movie,onboarding,kickoff,full}`
// entry points bake a stage the gate drops into as soon as the gateway is up.
let devStageLaunched = false
// One guide kickoff per process: the no-window guide run settles the store and
// the gate's effect hands off exactly once.
let guideKickoffHandled = false

export interface OnboardingWizardGateProps {
  enabled: boolean
  /** Start the first chat (hidden seeded turn). Called after commit.
   *  'greet' (default) seeds the wizard's answers; 'guide' runs the whole
   *  setup in-chat via ::onboarding cards instead of the wizard window. */
  onKickoff: (kind?: 'greet' | 'guide') => void
}

export function OnboardingWizardGate({ enabled, onKickoff }: OnboardingWizardGateProps) {
  const wizard = useStore($onboardingWizard)
  const intro = useStore($introReveal)
  const { setTheme } = useTheme()
  // One open request per active run — effects re-fire on unrelated renders.
  const openRequested = useRef(false)

  // dev:chat strips to solo IMMEDIATELY on mount — before the gateway opens —
  // so the persisted layout's sidebar never flashes in the small window while
  // the connection comes up. The kickoff effect below re-calls this; it's
  // idempotent.
  useEffect(() => {
    if (onboardingDevStage() === 'chat') {
      startChatOnboardingSolo()
    }
  }, [])

  // Mid-flow restart: intro already seen, wizard unfinished — pick it back up.
  // Unless a dev entry point baked a stage: the stage owns the boot (e.g.
  // `dev:kickoff` must not have this racing it with a wizard window).
  useEffect(() => {
    if (onboardingDevStage()) {
      return
    }

    if (enabled && intro.phase === 'hidden' && wizard.phase === 'hidden' && shouldResumeOnboardingWizard()) {
      startOnboardingWizard()
    }
  }, [enabled, intro.phase, wizard.phase])

  // Guide mode opens NO window — the guide run raises $guideKickoffPending
  // (reactive beacon) and this effect hands off to the guided chat. A beacon,
  // not a poll: the done-key lands in finishIntroReveal's dynamic-import
  // callback AFTER intro.phase settles to 'hidden', so by the time the keys
  // exist every other dependency here has gone quiet and a poll-on-render
  // misses the handoff (splash → vanilla shell, no guided chat). Seeding from
  // storage covers the mid-handoff relaunch (quit between splash and chat).
  const guidePending = useStore($guideKickoffPending)

  useEffect(() => {
    seedGuideKickoffFromStorage()
  }, [])

  useEffect(() => {
    if (!enabled || !guidePending || intro.phase !== 'hidden' || wizard.phase !== 'hidden') {
      return
    }

    if (shouldStartGuideKickoff() && !guideKickoffHandled) {
      guideKickoffHandled = true
      handleOutcome({ completed: true, mode: 'guide' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleOutcome is stable for this handoff
  }, [enabled, guidePending, intro.phase, wizard.phase])

  // Everything the wizard decided that must outlive it, applied in THIS
  // renderer: the window ran its own module instances, so sync theme state
  // from the shared storage, then commit the layout preset.
  const commitAnswers = useCallback(
    (answers: WizardAnswers) => {
      setTheme(answers.theme)
      setAccentOverride(answers.accent)

      const preset = registry.getArea('layouts').find(contribution => contribution.id === answers.layout)

      if (preset?.data) {
        applyLayoutPreset(preset.id, preset.data as LayoutNode)
      }
    },
    [setTheme]
  )

  const handleOutcome = useCallback(
    (outcome: OnboardingWizardOutcome) => {
      completeOnboardingWizard()

      // Guide mode: no picks to commit — the guided chat IS the setup. The
      // wizard window never opened, so the app window is still hidden from
      // the intro: ask main to pre-size it to the solo chat and reveal it.
      // The persistent kicked-latch is NOT stamped here — kickoffFirstChat
      // burns it only once the seeded session really exists, so a crash or
      // reload anywhere in between retries the handoff instead of stranding
      // a vanilla shell.
      if (outcome.mode === 'guide') {
        window.hermesDesktop?.chatOnboarding?.soloBoot?.()
        onKickoff('guide')

        return
      }

      // Login mode: no picks to commit — the guided chat IS the setup. Run it
      // whenever inference exists (sign-in completed OR skipped-but-already
      // -configured); without inference there is nothing to guide with.
      if (outcome.mode === 'login') {
        if (outcome.providerReady !== false) {
          onKickoff('guide')
        }

        return
      }

      if (!outcome.completed) {
        return
      }

      commitAnswers(reloadWizardAnswers())

      // No kickoff without inference: the run needed a provider and the user
      // skipped past the step — there is nothing to greet with. (The classic
      // overlay's runtime check will pick them up on their first send.)
      if (outcome.providerReady !== false) {
        onKickoff()
      }
    },
    [commitAnswers, onKickoff]
  )

  // Electron: the wizard runs in its own window; this renderer waits, hidden,
  // for the outcome (or a bare close — ⌘W — which stands down for the session
  // and resumes next launch).
  useEffect(() => {
    const bridge = wizardBridge()

    if (!bridge) {
      return
    }

    const offDone = bridge.onDone(handleOutcome)

    const offClosed = bridge.onClosed(() => {
      if ($onboardingWizard.get().phase === 'active' && !hasCompletedOnboardingWizard()) {
        dismissOnboardingWizardSession()
      }
    })

    return () => {
      offDone()
      offClosed()
    }
  }, [handleOutcome])

  useEffect(() => {
    if (wizard.phase !== 'active') {
      openRequested.current = false

      return
    }

    const bridge = wizardBridge()

    if (bridge && !openRequested.current) {
      openRequested.current = true
      void bridge.open({ mode: wizard.mode, needsProvider: wizardNeedsProviderStep() }).catch(() => undefined)
    }
  }, [wizard.mode, wizard.phase])

  // Dev entry points — `npm run dev:movie` / `dev:onboarding` / `dev:kickoff` /
  // `dev:chat` / `dev:full` bake a stage and land straight in it on boot:
  //   movie    the cinematic alone (replay: hands the screen back after)
  //   wizard   the onboarding steps, with the finale PAUSED for iteration
  //   kickoff  straight to the app, Hermes prompting first
  //   chat     straight to the app, the WHOLE setup guided in-chat
  //   full     the real first-run chain: video → wizard → kickoff
  useEffect(() => {
    const stage = onboardingDevStage()

    if (!stage || !enabled || devStageLaunched) {
      return
    }

    devStageLaunched = true

    if (stage === 'movie') {
      startIntroReveal(true)
    } else if (stage === 'wizard') {
      devStartOnboardingWizard()
    } else if (stage === 'kickoff') {
      onKickoff()
    } else if (stage === 'chat') {
      onKickoff('guide')
    } else {
      devResetOnboardingFlow()
      startIntroReveal(false)
    }
  }, [enabled, onKickoff])

  // Dev stage-jumping — every onboarding stage reachable without the video:
  //   __onboarding.start('appearance')  jump straight to a step
  //   __onboarding.finale()             the cinematic close
  //   __onboarding.kickoff()            the hidden-seeded first chat
  //   __onboarding.chat()               the in-chat guided setup
  //   __onboarding.movie()              the FULL chain: video → wizard → kickoff
  //   __onboarding.reset()              forget seen/done/answers (full replay)
  useEffect(() => {
    if (!import.meta.env.DEV) {
      return
    }

    const hooks = {
      chat: () => onKickoff('guide'),
      finale: () => devStartOnboardingWizard('finale'),
      kickoff: () => onKickoff(),
      // Replay the real first-run chain on a configured machine: reset the
      // seen/done keys, then start the cinematic as a NON-replay so
      // finishIntroReveal() hands off to the wizard (replay deliberately
      // skips that handoff). Requires VITE_INTRO_REVEAL=1 in the Vite env.
      movie: () => {
        devResetOnboardingFlow()
        startIntroReveal(false)
      },
      reset: () => devResetOnboardingFlow(),
      start: (step?: WizardStepId) => devStartOnboardingWizard(step)
    }

    ;(window as Window & { __onboarding?: typeof hooks }).__onboarding = hooks

    return () => {
      delete (window as Window & { __onboarding?: typeof hooks }).__onboarding
    }
  }, [onKickoff])

  // Browser fallback (no bridge): center a card-sized box on a dim ground so
  // the dev screenshot loop and plain-Vite iteration still work. In Electron
  // the surface only ever renders in its dedicated window.
  if (wizard.phase !== 'active' || wizardBridge()) {
    return null
  }

  return (
    <Suspense fallback={null}>
      <div className="fixed inset-0 z-(--z-onboarding-wizard) grid place-items-center bg-black/40">
        <div className="h-[500px] w-[720px] [filter:drop-shadow(0_32px_64px_rgba(0,0,0,0.45))]">
          <WizardSurface
            onComplete={() => handleOutcome({ completed: true, providerReady: !wizardNeedsProviderStep() })}
          />
        </div>
      </div>
    </Suspense>
  )
}
