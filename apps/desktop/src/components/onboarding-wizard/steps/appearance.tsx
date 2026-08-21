import { useStore } from '@nanostores/react'

import { Field } from '@/components/ui/field'
import { Blurb, selectableClass, StepControls } from '@/components/wizard-shell'
import { cn } from '@/lib/utils'
import { $wizardAnswers, setWizardAnswers } from '@/store/onboarding-wizard'
import { useTheme } from '@/themes'
import { setAccentOverride } from '@/themes/accent-override'

// Big accent swatches, Dia-style. Each seeds `retintTheme` through the accent
// override, so a click repaints the wizard's own buttons/progress live. Nous
// blue is the default = no override. Mono seeds the current mode's pole —
// black in light, white in dark — for a full monochrome look.
const NOUS_ACCENT = '#0053fd'

const accentsFor = (dark: boolean): Array<{ hex: string; name: string }> => [
  { hex: dark ? '#ffffff' : '#000000', name: 'Mono' },
  { hex: '#2ea043', name: 'GitHub green' },
  { hex: '#00d5ff', name: 'Cyber cyan' },
  { hex: NOUS_ACCENT, name: 'Nous blue' },
  { hex: '#8a2be2', name: 'Ultraviolet' },
  { hex: '#e0218a', name: 'Barbie pink' },
  { hex: '#ff073a', name: 'Electric red' }
]

// Mini layout trees — the wizard's two starting layouts, mirroring the real
// preset trees in app/contrib/controller.tsx (FOCUS_TREE / TERMINAL_TREE),
// drawn in the layout editor's thumbnail language, upscaled.
type MiniNode = number | { dir: 'column' | 'row'; children: MiniNode[]; weights: number[] }

const LAYOUTS: Array<{ id: string; name: string; tree: MiniNode }> = [
  { id: 'focus', name: 'Basic', tree: { children: [1, 1], dir: 'row', weights: [1, 4.6] } },
  {
    id: 'terminal-deck',
    name: 'Elite',
    tree: {
      children: [{ children: [1, 1, 1], dir: 'row', weights: [1, 3.2, 1.2] }, 1],
      dir: 'column',
      weights: [3, 1]
    }
  }
]

function MiniTree({ node }: { node: MiniNode }) {
  if (typeof node === 'number') {
    return (
      <div className="min-h-0 min-w-0 flex-1 rounded-[3px] bg-foreground/15" />
    )
  }

  return (
    <div className={cn('flex min-h-0 min-w-0 flex-1 gap-1', node.dir === 'row' ? 'flex-row' : 'flex-col')}>
      {node.children.map((child, i) => (
        <div className="flex min-h-0 min-w-0" key={i} style={{ flex: `${node.weights[i]} ${node.weights[i]} 0px` }}>
          <MiniTree node={child} />
        </div>
      ))}
    </div>
  )
}

function LayoutPreviewCard({
  active,
  name,
  onSelect,
  tree
}: {
  active: boolean
  name: string
  onSelect: () => void
  tree: MiniNode
}) {
  return (
    <button aria-pressed={active} className="group flex flex-col items-center gap-2" onClick={onSelect} type="button">
      <span
        className={cn('flex aspect-[10/7] w-full flex-col gap-1.5 rounded-[8px] p-2', selectableClass(active))}
      >
        <span aria-hidden className="flex gap-1">
          <span className="size-1.5 rounded-full bg-[#ff5f57]" />
          <span className="size-1.5 rounded-full bg-[#febc2e]" />
          <span className="size-1.5 rounded-full bg-[#28c840]" />
        </span>
        <span className="flex min-h-0 flex-1">
          <MiniTree node={tree} />
        </span>
      </span>
      <span className={cn('text-xs', active ? 'text-foreground' : 'text-muted-foreground')}>{name}</span>
    </button>
  )
}

export function AppearanceStep() {
  const answers = useStore($wizardAnswers)
  const { renderedMode } = useTheme()
  const accents = accentsFor(renderedMode === 'dark')
  const accent = answers.accent ?? NOUS_ACCENT

  const pickAccent = (hex: string) => {
    const seed = hex === NOUS_ACCENT ? null : hex

    setWizardAnswers({ accent: seed })
    setAccentOverride(seed)
  }

  return (
    <div>
      <Blurb>Pick the color and layout that feel right for you — change both anytime.</Blurb>

      <StepControls className="grid gap-6">
        <div className="flex flex-wrap justify-between">
          {accents.map(swatch => {
            const active = accent.toLowerCase() === swatch.hex

            return (
              <button
                aria-label={swatch.name}
                aria-pressed={active}
                className={cn(
                  // The hairline keeps the mono swatch visible on its own pole.
                  'size-9 rounded-full border border-foreground/15 transition-transform duration-150',
                  !active && 'hover:scale-105'
                )}
                key={swatch.name}
                onClick={() => pickAccent(swatch.hex)}
                style={{
                  background: swatch.hex,
                  boxShadow: active ? `0 0 0 2px var(--dt-background), 0 0 0 4px ${swatch.hex}` : undefined
                }}
                title={swatch.name}
                type="button"
              />
            )
          })}
        </div>

        <Field label="Choose your vibe">
          <div className="grid max-w-[400px] grid-cols-2 gap-3 pt-0.5">
            {LAYOUTS.map(layout => (
              <LayoutPreviewCard
                active={answers.layout === layout.id}
                key={layout.id}
                name={layout.name}
                onSelect={() => setWizardAnswers({ layout: layout.id })}
                tree={layout.tree}
              />
            ))}
          </div>
        </Field>
      </StepControls>
    </div>
  )
}
