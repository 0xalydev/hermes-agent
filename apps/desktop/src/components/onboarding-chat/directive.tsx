/**
 * In-chat onboarding cards — the `::onboarding{step="…"}` transcript
 * directive. The conversational twin of the wizard window: Hermes walks the
 * user through setup in the transcript, and each step's paragraph renders as
 * an interactive picker (same option catalog, same persistence).
 *
 * Everything applies LIVE on click — accent retints the app, the layout
 * preset rearranges the panes behind the chat — that's the trick. "Continue"
 * reports the pick as a hidden composer submit (no user bubble) so the model
 * carries on to the next step.
 *
 * The model never enumerates options in prose; it only places the card. The
 * renderer owns the catalog (options.tsx), so chat and wizard can't drift.
 */

import { useStore } from '@nanostores/react'
import { useState } from 'react'

import { requestComposerSubmit } from '@/app/chat/composer/focus'
import { $chatLayoutPicked, $chatOnboardingSolo, assembleChatOnboarding } from '@/components/onboarding-chat/assembly'
import {
  AccentSwatch,
  accentsFor,
  CONNECTORS,
  FOCUS_OPTIONS,
  LAYOUTS,
  LayoutPreviewCard,
  NOUS_ACCENT
} from '@/components/onboarding-wizard/options'
import type { LayoutNode } from '@/components/pane-shell/tree/model'
import { applyLayoutPreset } from '@/components/pane-shell/tree/presets'
import { Button } from '@/components/ui/button'
import { ConnectorLogo } from '@/components/ui/connector-logo'
import { Chip } from '@/components/wizard-shell'
import { registry } from '@/contrib/registry'
import { $wizardAnswers, setWizardAnswers } from '@/store/onboarding-wizard'
import { useTheme } from '@/themes'
import { setAccentOverride } from '@/themes/accent-override'

type ChatStep = 'connectors' | 'focus' | 'layout' | 'look'

function isChatStep(value: string | undefined): value is ChatStep {
  return value === 'focus' || value === 'connectors' || value === 'look' || value === 'layout'
}

/** Report a pick and let the model move on — hidden, so no user bubble. */
function report(summary: string): boolean {
  return requestComposerSubmit(`[setup] ${summary}`, { displayKind: 'hidden' })
}

/** No chrome — the picker sits directly in the transcript like any other
 *  message content. The interaction IS the affordance; a border would make it
 *  read as a form. */
function CardFrame({
  children,
  disabled = false,
  done,
  onContinue
}: {
  children: React.ReactNode
  disabled?: boolean
  done: boolean
  onContinue: () => void
}) {
  return (
    <div className="my-3 grid max-w-md gap-4" data-onboarding-card>
      {children}
      <div className="flex justify-start">
        <Button disabled={done || disabled} onClick={onContinue} size="sm">
          {done ? 'Done' : 'Continue'}
        </Button>
      </div>
    </div>
  )
}

function FocusCard() {
  const answers = useStore($wizardAnswers)
  const [done, setDone] = useState(false)

  return (
    <CardFrame
      done={done}
      onContinue={() => {
        if (report(`they want help with: ${answers.focus.length > 0 ? answers.focus.join(', ') : 'no picks — keep it open'}`)) {
          setDone(true)
        }
      }}
    >
      <div className="flex flex-wrap gap-2">
        {FOCUS_OPTIONS.map(option => (
          <Chip
            key={option}
            label={option}
            on={answers.focus.includes(option)}
            onToggle={() =>
              setWizardAnswers({
                focus: answers.focus.includes(option)
                  ? answers.focus.filter(item => item !== option)
                  : [...answers.focus, option]
              })
            }
            variant="pill"
          />
        ))}
      </div>
    </CardFrame>
  )
}

function ConnectorsCard() {
  const answers = useStore($wizardAnswers)
  const [done, setDone] = useState(false)

  const toggle = (id: string) =>
    setWizardAnswers({
      connectors: answers.connectors.includes(id)
        ? answers.connectors.filter(item => item !== id)
        : [...answers.connectors, id]
    })

  return (
    <CardFrame
      done={done}
      onContinue={() => {
        const picked = CONNECTORS.filter(connector => answers.connectors.includes(connector.id))

        if (report(`connect later: ${picked.length > 0 ? picked.map(c => c.name).join(', ') : 'none for now'}`)) {
          setDone(true)
        }
      }}
    >
      <div className="grid grid-cols-3 gap-2">
        {CONNECTORS.map(connector => (
          <Chip
            icon={
              <ConnectorLogo
                className="size-7 rounded-full text-sm"
                connector={{ homepage: connector.homepage, name: connector.id, title: connector.name }}
              />
            }
            key={connector.id}
            label={connector.name}
            on={answers.connectors.includes(connector.id)}
            onToggle={() => toggle(connector.id)}
          />
        ))}
      </div>
    </CardFrame>
  )
}

function LookCard() {
  const answers = useStore($wizardAnswers)
  const { renderedMode } = useTheme()
  const [done, setDone] = useState(false)
  const accents = accentsFor(renderedMode === 'dark')
  const accent = answers.accent ?? NOUS_ACCENT
  const picked = accents.find(swatch => swatch.hex === accent.toLowerCase())

  const pickAccent = (hex: string) => {
    const seed = hex === NOUS_ACCENT ? null : hex

    setWizardAnswers({ accent: seed })
    setAccentOverride(seed)
  }

  return (
    <CardFrame
      done={done}
      onContinue={() => {
        if (report(`accent color: ${picked?.name ?? accent}`)) {
          setDone(true)
        }
      }}
    >
      <div className="flex flex-wrap gap-2.5">
        {accents.map(swatch => (
          <AccentSwatch
            active={accent.toLowerCase() === swatch.hex}
            hex={swatch.hex}
            key={swatch.name}
            name={swatch.name}
            onPick={() => pickAccent(swatch.hex)}
          />
        ))}
      </div>
    </CardFrame>
  )
}

function LayoutCard() {
  const answers = useStore($wizardAnswers)
  const [done, setDone] = useState(false)

  // The stored answer defaults to 'basic', but the CHOICE is the point of this
  // step — nothing renders selected (and Continue stays off) until they click.
  // Store-backed: the pick's own layout apply remounts this card (the pane
  // tree is replaced), so local state would drop the highlight instantly.
  const picked = useStore($chatLayoutPicked)

  const pickLayout = (id: string) => {
    $chatLayoutPicked.set(true)
    setWizardAnswers({ layout: id })

    // Live, behind the chat — the panes rearrange as the option is clicked.
    const preset = registry.getArea('layouts').find(contribution => contribution.id === id)

    if (!preset?.data) {
      return
    }

    if ($chatOnboardingSolo.get()) {
      // First pick from solo: grow the window outward and lego the panes in,
      // keeping the chat (and the cursor over this card) pixel-fixed.
      assembleChatOnboarding(preset.id, preset.data as LayoutNode)
    } else {
      applyLayoutPreset(preset.id, preset.data as LayoutNode)
    }
  }

  return (
    <CardFrame
      disabled={!picked}
      done={done}
      onContinue={() => {
        const choice = LAYOUTS.find(layout => layout.id === answers.layout)

        if (report(`layout: ${choice?.name ?? answers.layout}`)) {
          setDone(true)
        }
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        {LAYOUTS.map(layout => (
          <LayoutPreviewCard
            active={picked && answers.layout === layout.id}
            key={layout.id}
            name={layout.name}
            onSelect={() => pickLayout(layout.id)}
            tree={layout.tree}
          />
        ))}
      </div>
    </CardFrame>
  )
}

const CARDS: Record<ChatStep, () => React.JSX.Element> = {
  connectors: ConnectorsCard,
  focus: FocusCard,
  layout: LayoutCard,
  look: LookCard
}

export function OnboardingChatDirective({ attrs, streaming }: { attrs: Record<string, string>; streaming: boolean }) {
  const step = attrs.step

  if (!isChatStep(step)) {
    return null
  }

  // Don't flash an interactive card mid-stream — the paragraph may still be
  // growing. It mounts once the turn settles.
  if (streaming) {
    return null
  }

  const Card = CARDS[step]

  return <Card />
}
