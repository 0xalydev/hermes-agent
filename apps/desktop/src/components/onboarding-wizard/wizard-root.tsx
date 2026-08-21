import { QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'

import { ErrorBoundary } from '@/components/error-boundary'
import { RootTooltipProvider } from '@/components/ui/tooltip'
import { I18nProvider } from '@/i18n'
import { queryClient } from '@/lib/query-client'
import { $desktopOnboarding } from '@/store/onboarding'
import {
  completeOnboardingWizard,
  devStartOnboardingWizard,
  skipOnboardingWizard,
  startOnboardingWizardWindow,
  type OnboardingWizardOutcome,
  type WizardStepId
} from '@/store/onboarding-wizard'
import { DEFAULT_SKIN_NAME } from '@/themes'
import { ThemeProvider } from '@/themes/context'

import { WizardSurface } from './surface'

/**
 * Boot the dedicated onboarding-wizard window. Loaded by the same bundle as
 * the main app via `?win=onboarding`, so it shares CSS, the wizard store
 * (answers persist through the shared origin localStorage), and the theme
 * stack — while mounting only the wizard surface: no app shell, no router.
 *
 * The provider step runs the classic onboarding flows in THIS window (its own
 * store instances + a lazy gateway socket — see ./gateway), which is why the
 * query client, i18n, and tooltip providers mount here.
 *
 * The main app window is HIDDEN while this window is up (see
 * electron/main.ts). Every exit path reports an outcome over IPC so main can
 * close this window, bring the app back, and let the main renderer commit the
 * answers + start the first chat.
 *
 * The provider decision is computed by the main renderer and arrives as the
 * `providers=1` query param.
 */
export function mountOnboardingWizard(): void {
  document.title = 'Welcome to Hermes'

  // The window is transparent — the card IS the window, so every host layer
  // must be see-through (the index.html boot script paints an opaque themed
  // background for normal windows).
  const style = document.createElement('style')

  style.textContent = 'html,body,#root{background:transparent !important;}'
  document.head.appendChild(style)

  const root = document.getElementById('root')

  if (!root) {
    return
  }

  const needsProvider = new URLSearchParams(window.location.search).get('providers') === '1'

  startOnboardingWizardWindow(needsProvider)

  // Same dev stage-jumping hooks as the in-app gate, so the screenshot loop
  // and browser iteration drive THIS surface — the one users actually see.
  if (import.meta.env.DEV) {
    const hooks = {
      finale: () => devStartOnboardingWizard('finale'),
      start: (step?: WizardStepId) => devStartOnboardingWizard(step)
    }

    ;(window as Window & { __onboarding?: typeof hooks }).__onboarding = hooks
  }

  const report = (outcome: OnboardingWizardOutcome) => {
    window.hermesDesktop?.onboardingWizard?.done(outcome)
  }

  // Whether the run still lacks inference: only meaningful when this window
  // was told a provider is needed AND the in-wizard provider step didn't
  // finish a flow (which flips the classic store to configured).
  const providerReady = () => !needsProvider || $desktopOnboarding.get().configured === true

  createRoot(root).render(
    <ErrorBoundary label="onboarding-wizard">
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <ThemeProvider initialSkin={DEFAULT_SKIN_NAME}>
            <RootTooltipProvider>
              <WizardSurface
                onComplete={() => {
                  completeOnboardingWizard()
                  report({ completed: true, providerReady: providerReady() })
                }}
                onSkip={() => {
                  skipOnboardingWizard()
                  report({ completed: false })
                }}
              />
            </RootTooltipProvider>
          </ThemeProvider>
        </I18nProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )

  // Reveal the OS window only once the surface has painted: double rAF fires
  // after the first frame is committed, so the window's first composited
  // frame is the card entrance's opacity-0 start — never the blank pre-mount
  // shell that `ready-to-show` reveals (the "blip").
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      window.hermesDesktop?.onboardingWizard?.ready?.()
    })
  )
}
