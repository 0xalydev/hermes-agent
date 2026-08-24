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
import { FirstScreenPreview, FirstScreenSurface } from '@/components/onboarding-wizard/first-screen'
import {
  accentsFor,
  AccentSwatch,
  CONNECTORS,
  FOCUS_OPTIONS,
  LayoutPreviewCard,
  LAYOUTS,
  NOUS_ACCENT
} from '@/components/onboarding-wizard/options'
import type { LayoutNode } from '@/components/pane-shell/tree/model'
import { applyLayoutPreset } from '@/components/pane-shell/tree/presets'
import { Button } from '@/components/ui/button'
import { ConnectorLogo } from '@/components/ui/connector-logo'
import { Chip } from '@/components/wizard-shell'
import { registry } from '@/contrib/registry'
import { cn } from '@/lib/utils'
import {
  $firstScreenKind,
  compileFirstScreen,
  type FirstScreenKind,
  materializeFirstScreen,
  setFirstScreenKind
} from '@/store/onboarding-first-screen'
import { $wizardAnswers, setWizardAnswers } from '@/store/onboarding-wizard'
import { useTheme } from '@/themes'
import { setAccentOverride } from '@/themes/accent-override'

type ChatStep = 'connectors' | 'first-screen' | 'focus' | 'layout' | 'look' | 'name'

function isChatStep(value: string | undefined): value is ChatStep {
  return (
    value === 'focus' ||
    value === 'connectors' ||
    value === 'look' ||
    value === 'layout' ||
    value === 'first-screen' ||
    value === 'name'
  )
}

/** Report a pick and let the model move on — hidden, so no user bubble. */
function report(summary: string): boolean {
  return requestComposerSubmit(`[setup] ${summary}`, { displayKind: 'hidden' })
}

type CardProps = {
  /** True while the surrounding turn is still streaming — same card, no clicks. */
  locked?: boolean
}

/** No chrome — the picker sits directly in the transcript like any other
 *  message content. The interaction IS the affordance; a border would make it
 *  read as a form. */
function CardFrame({
  children,
  disabled = false,
  done,
  locked = false,
  onContinue
}: {
  children: React.ReactNode
  disabled?: boolean
  done: boolean
  locked?: boolean
  onContinue: () => void
}) {
  return (
    <div className="my-3 grid max-w-md gap-4" data-onboarding-card inert={locked || undefined}>
      {children}
      <div className="flex justify-start">
        <Button disabled={done || disabled || locked} onClick={onContinue} size="sm">
          {done ? 'Done' : 'Continue'}
        </Button>
      </div>
    </div>
  )
}

function FocusCard({ locked = false }: CardProps) {
  const answers = useStore($wizardAnswers)
  const [done, setDone] = useState(false)

  return (
    <CardFrame
      done={done}
      locked={locked}
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

function ConnectorsCard({ locked = false }: CardProps) {
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
      locked={locked}
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

function LookCard({ locked = false }: CardProps) {
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
      locked={locked}
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

function LayoutCard({ locked = false }: CardProps) {
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
      locked={locked}
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

const FIRST_SCREEN_OPTIONS: Array<{ blurb: string; kind: FirstScreenKind; title: string }> = [
  { blurb: 'Buttons that start things: a brief, a draft, a feed.', kind: 'dashboard', title: 'Dashboard' },
  { blurb: 'A page that arrives written for you, on a cadence you set.', kind: 'document', title: 'Document' },
  { blurb: 'One small machine: drop something in, get one shaped thing out.', kind: 'app', title: 'App' }
]

function FirstScreenCard({ locked = false }: CardProps) {
  const answers = useStore($wizardAnswers)
  const picked = useStore($firstScreenKind)
  const [building, setBuilding] = useState(false)
  const [built, setBuilt] = useState<null | ReturnType<typeof compileFirstScreen>>(null)
  const profile = { focus: answers.focus, name: answers.name }

  // Continue = build. The config compiles synchronously, then materializes
  // (screen.json lands on disk) before the model is told — so when the chat
  // says "it's built", the (now interactive) card IS the finished thing.
  const build = () => {
    if (!picked || building) {
      return
    }

    setBuilding(true)
    const config = compileFirstScreen(profile, picked)

    void materializeFirstScreen(config).then(result => {
      const tile = FIRST_SCREEN_OPTIONS.find(o => o.kind === picked)

      if (!report(`built their first screen: ${tile?.title.toLowerCase() ?? config.kind} "${config.title}"${result.ok ? `, saved to ${result.path}` : ''} — tell them it's ready and one tap on a block runs it`)) {
        setBuilding(false)

        return
      }

      // The build just dropped a NEW pane contribution (the plugin folder the
      // disk watcher will register on its next tick). Reveal it now — this is
      // the moment the guide answers "where did it go" with a real highlight,
      // instead of the user hunting the rail for a pane that appeared quietly.
      import('@/components/pane-shell/tree/store').then(({ revealTreePane }) =>
        revealTreePane('first-screen:pane')
      )

      setBuilt(config)
    })
  }

  if (built) {
    // The finished artifact stays in the transcript, live — pressing any of
    // its blocks hidden-submits the block's prompt, so the conversation
    // itself demonstrates "press a button, it does something". The rail
    // callout names what the same thing looks like as a pane, since the
    // build also wrote a plugin.
    return (
      <div className="my-3 grid max-w-md gap-2" data-onboarding-card>
        <div className="overflow-hidden rounded-[6px] border bg-white">
          <FirstScreenSurface config={built} interactive />
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
          <span aria-hidden>→</span>
          <span>
            This also lives as the <strong className="font-medium">your first screen</strong> pane — one click
            on the rail keeps it open anywhere.
          </span>
        </div>
      </div>
    )
  }

  return (
    <CardFrame
      disabled={!picked}
      done={built !== null}
      locked={locked || building}
      onContinue={build}
    >
      <div className="flex flex-col gap-2">
        {FIRST_SCREEN_OPTIONS.map(option => {
          const config = compileFirstScreen(profile, option.kind)

          return (
            <button
              className={cn(
                'grid grid-cols-[120px_1fr] items-center gap-3 rounded-[8px] border p-2 text-left transition-colors',
                picked === option.kind ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-accent/40'
              )}
              key={option.kind}
              onClick={() => setFirstScreenKind(option.kind)}
              type="button"
            >
              <FirstScreenPreview config={config} />
              <span>
                <span className="block text-[13px] font-medium">{option.title}</span>
                <span className="block text-xs text-muted-foreground">{option.blurb}</span>
              </span>
            </button>
          )
        })}
      </div>
    </CardFrame>
  )
}

const CARDS: Record<ChatStep, (props: CardProps) => React.JSX.Element> = {
  connectors: ConnectorsCard,
  'first-screen': FirstScreenCard,
  focus: FocusCard,
  layout: LayoutCard,
  look: LookCard,
  // 'name' renders nothing — it's the model handing the renderer the name it
  // was told, so the artifact compiler personalizes for real (see the
  // OnboardingChatDirective wrapper: the value lands before this lookup).
  name: () => <></>
}

export function OnboardingChatDirective({ attrs, streaming }: { attrs: Record<string, string>; streaming: boolean }) {
  const step = attrs.step

  if (!isChatStep(step)) {
    return null
  }

  // The name directive is data, not UI: store it (idempotent) and render
  // nothing. The model interpolates the user's actual answer into `value`.
  if (step === 'name') {
    const value = (attrs.value ?? '').trim()

    if (value && $wizardAnswers.get().name !== value) {
      setWizardAnswers({ name: value })
    }

    return null
  }

  // Mount as soon as the directive is parsed — returning null until settle
  // grows the transcript by a card when the turn finishes. Keep it inert
  // mid-stream so the growing paragraph can't be clicked through.
  const Card = CARDS[step]

  return <Card locked={streaming} />
}
