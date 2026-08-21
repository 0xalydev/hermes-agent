import { CARD_RADIUS, dragRegion, EASE, FONT_SERIF } from '@/components/wizard-shell'
import { cn } from '@/lib/utils'

import { HERMES_BLUE } from './brand'

const FINALE_CSS = `
@keyframes wizard-finale-card-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes wizard-finale-card-out { from { opacity: 1 } to { opacity: 0 } }
@keyframes wizard-finale-in { from { opacity: 0; letter-spacing: 0.06em } to { opacity: 1 } }
`

/** Cinematic close: a two-line movie title, white on electric blue (both
 *  modes), then the app. Card-shaped so the transparent window keeps its
 *  silhouette. `leaving` dissolves the whole card over the desktop before
 *  the window closes and the app fades back in. */
export function Finale({ leaving = false }: { leaving?: boolean }) {
  return (
    <div
      className={cn('flex size-full flex-col items-center justify-center overflow-hidden', CARD_RADIUS)}
      style={{
        animation: leaving
          ? `wizard-finale-card-out 500ms ${EASE} both`
          : `wizard-finale-card-in 900ms ${EASE} both`,
        background: HERMES_BLUE,
        ...dragRegion(true)
      }}
    >
      <style>{FINALE_CSS}</style>
      <div className="text-center font-medium uppercase text-white" style={{ fontFamily: FONT_SERIF }}>
        <div
          className="text-[32px] leading-none tracking-[0.14em]"
          style={{ animation: `wizard-finale-in 1200ms ${EASE} both` }}
        >
          Welcome to
        </div>
        <div
          className="text-[66px] leading-[1.15] tracking-[0.02em]"
          style={{ animation: `wizard-finale-in 1200ms 250ms ${EASE} both` }}
        >
          Hermes Agent
        </div>
      </div>
    </div>
  )
}
