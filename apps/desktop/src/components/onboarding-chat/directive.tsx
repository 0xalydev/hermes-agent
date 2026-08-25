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
import { useEffect, useState } from 'react'

import { requestComposerSubmit } from '@/app/chat/composer/focus'
import { $chatLayoutPicked, $chatOnboardingSolo, assembleChatOnboarding } from '@/components/onboarding-chat/assembly'
import {
  $setupHandoff,
  hasCompletedSetupHandoff,
  requestSetupHandoff,
  taskBotTitle
} from '@/components/onboarding-chat/setup-bot'
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
import { $wizardAnswers, setWizardAnswers } from '@/store/onboarding-wizard'
import { useTheme } from '@/themes'
import { setAccentOverride } from '@/themes/accent-override'

type ChatStep = 'connectors' | 'first' | 'focus' | 'handoff' | 'layout' | 'look' | 'progress'

function isChatStep(value: string | undefined): value is ChatStep {
  return (
    value === 'focus' ||
    value === 'connectors' ||
    value === 'look' ||
    value === 'layout' ||
    value === 'first' ||
    value === 'handoff' ||
    value === 'progress'
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

/**
 * The "first build" card — the close of the get-to-know-you beat. The model
 * asks a thoughtful question about what the user wants to BUILD first, then
 * places this card with the options IT generated from the whole conversation:
 * `::onboarding{step="first" options="A Discord bot|A habit tracker|…"}`.
 *
 * The options are untrusted model output riding the directive attrs — the
 * card validates (count, length), renders them as tappable chips, and a tap
 * sends the pick back as the user's next turn (visible — it IS their answer),
 * so the model continues from a real reply, not a hidden [setup] note.
 */
function FirstBuildCard({ attrs, locked = false }: CardProps & { attrs: Record<string, string> }) {
  const [picked, setPicked] = useState<null | string>(null)

  // Parse + validate the model's options: 2–4 of them, each short enough to
  // sit on a chip. Garbage in → no card (the directive degrades to prose).
  const options = (attrs.options ?? '')
    .split('|')
    .map(option => option.trim())
    .filter(option => option.length > 0 && option.length <= 60)
    .slice(0, 4)

  if (options.length < 2) {
    return null
  }

  const pick = (option: string) => {
    if (picked || locked) {
      return
    }

    // The pick is the user's reply — a REAL visible turn, so the model's next
    // message answers it like anything they typed.
    if (requestComposerSubmit(option)) {
      setPicked(option)
    }
  }

  return (
    <div className="my-3 grid max-w-md gap-4" data-onboarding-card inert={locked || undefined}>
      <div className="flex flex-wrap gap-2">
        {options.map(option => (
          <Chip
            key={option}
            label={option}
            on={picked === option}
            onToggle={() => pick(option)}
            variant="pill"
          />
        ))}
      </div>
    </div>
  )
}

/**
 * The handoff card — bot mode's replacement for "the task starts in this
 * chat". Setup emits `::onboarding{step="handoff" task="…" brief="…"}` once
 * the task is decided; when the turn settles this card raises the handoff
 * beacon and the wiring effect does the real work (mint the task bot, seed
 * its chat, move the user there). The card itself just narrates: spinning
 * up → built. Both latches (atom + storage) make re-parses, re-mounts, and
 * relaunches into old transcripts inert.
 */
function HandoffCard({ attrs, locked = false }: CardProps & { attrs: Record<string, string> }) {
  const task = (attrs.task ?? '').trim().slice(0, 60)
  const brief = (attrs.brief ?? '').trim().slice(0, 240)
  const state = useStore($setupHandoff)

  useEffect(() => {
    if (!locked && task && brief) {
      requestSetupHandoff(task, brief)
    }
  }, [brief, locked, task])

  if (!task || !brief) {
    return null
  }

  const settled = state?.phase === 'done' || (state === null && hasCompletedSetupHandoff())
  const failed = state?.phase === 'error'
  const title = state?.botTitle ?? taskBotTitle(task)

  return (
    <div className="my-3 flex max-w-md items-center gap-2 text-sm" data-onboarding-card>
      <span
        aria-hidden
        className={cn(
          'inline-block size-1.5 shrink-0 rounded-full',
          settled || failed ? 'bg-(--ui-text-quaternary)' : 'animate-pulse bg-(--ui-accent)'
        )}
      />
      <span className="text-(--ui-text-secondary)">
        {failed
          ? 'Couldn\u2019t spin up a separate agent — building here instead'
          : settled
            ? `${title} is on it — find it in your agents`
            : `Spinning up ${title}\u2026`}
      </span>
    </div>
  )
}

/**
 * The progress card — the build's live status, inline in the transcript. The
 * model re-emits `::onboarding{step="progress" title="…"}` as it works; each
 * emission appends a step row to a session-wide list (module-scope, keyed by
 * nothing — the onboarding thread is the only consumer), the newest row
 * pulsing while the turn streams. Read-only: the user watches the build
 * breathe; permissions prompts ride the session concurrently.
 *
 * No fake percentages — the model can't know N-of-M mid-build, so the card
 * is an honest growing step list, not a bar that lies.
 */
const progressSteps: string[] = []

function ProgressCard({ attrs, locked = false }: CardProps & { attrs: Record<string, string> }) {
  const title = (attrs.title ?? '').trim() || 'Working on it'

  // Append on first sight of a new title (re-emits of the same step are the
  // model re-rendering mid-stream, not a new step).
  const [index] = useState(() => {
    if (progressSteps[progressSteps.length - 1] !== title) {
      progressSteps.push(title)
    }

    return progressSteps.length - 1
  })

  return (
    <div className="my-3 grid max-w-md gap-1.5" data-onboarding-card>
      {progressSteps.slice(0, index + 1).map((step, i) => {
        const current = i === index

        return (
          <div className="flex items-center gap-2 text-sm" key={`${i}-${step}`}>
            <span
              aria-hidden
              className={cn(
                'inline-block size-1.5 shrink-0 rounded-full',
                current ? 'bg-(--ui-accent)' : 'bg-(--ui-text-quaternary)',
                current && !locked && 'animate-pulse'
              )}
            />
            <span className={current ? 'text-(--ui-text-secondary)' : 'text-(--ui-text-quaternary)'}>
              {current && !locked ? `${step}…` : step}
            </span>
          </div>
        )
      })}
    </div>
  )
}

const CARDS: Record<Exclude<ChatStep, 'first' | 'handoff' | 'progress'>, (props: CardProps) => React.JSX.Element> = {
  connectors: ConnectorsCard,
  focus: FocusCard,
  layout: LayoutCard,
  look: LookCard
}

/** Cards that need the directive's raw attrs (the model-written payload). */
function CardForStep({ attrs, locked, step }: CardProps & { attrs: Record<string, string>; step: ChatStep }) {
  if (step === 'first') {
    return <FirstBuildCard attrs={attrs} locked={locked} />
  }

  if (step === 'handoff') {
    return <HandoffCard attrs={attrs} locked={locked} />
  }

  if (step === 'progress') {
    return <ProgressCard attrs={attrs} locked={locked} />
  }

  const Card = CARDS[step]

  return <Card locked={locked} />
}

export function OnboardingChatDirective({ attrs, streaming }: { attrs: Record<string, string>; streaming: boolean }) {
  const step = attrs.step

  if (!isChatStep(step)) {
    return null
  }

  // Mount as soon as the directive is parsed — returning null until settle
  // grows the transcript by a card when the turn finishes. Keep it inert
  // mid-stream so the growing paragraph can't be clicked through.
  return <CardForStep attrs={attrs} locked={streaming} step={step} />
}
