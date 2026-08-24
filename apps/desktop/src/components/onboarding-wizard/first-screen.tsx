/**
 * The build theater and the finished first screen. The theater replays the
 * theater-beat table from the store on one rAF clock: each beat's row
 * cascades into the log, the block snaps into the mini preview beside it, and
 * prompt beats TYPE their line character by character — the personalization
 * (the user's name/focus baked into the prompt text) is the show. The reveal
 * then hands the whole card to the finished artifact for a full-frame beat
 * before the app takes over.
 *
 * The cards never wait on anything: the config is already compiled before the
 * theater mounts (pure, synchronous), so a hung clock would only strand the
 * animation — never the artifact.
 */

import { useStore } from '@nanostores/react'
import { type CSSProperties } from 'react'

import { requestComposerSubmit } from '@/app/chat/composer/focus'
import { FONT_MONO } from '@/components/wizard-shell'
import { cn } from '@/lib/utils'
import type { FirstScreenConfig, TheaterBeat } from '@/store/onboarding-first-screen'
import { $firstScreenKind } from '@/store/onboarding-first-screen'

/** Progress of one clock tick, handed down to rows/blocks for easing. */
export interface TheaterProgress {
  /** ms since the sequence started. */
  t: number
}

/** Typewriter: how many characters of a prompt line are visible at `t`. */
const TYPE_START_OFFSET = 350
const TYPE_MS_PER_CHAR = 14

export function typedLength(text: string, beatT: number, t: number): number {
  const local = t - beatT - TYPE_START_OFFSET

  if (local <= 0) {
    return 0
  }

  return Math.min(text.length, Math.floor(local / TYPE_MS_PER_CHAR))
}

/** One log row — status line, or the typed prompt payload for a block. */
function TheaterRow({ beat, t }: { beat: TheaterBeat; t: number }) {
  if (t < beat.t) {
    return null
  }

  if (beat.cue === 'prompt' && beat.prompt) {
    const len = typedLength(beat.prompt, beat.t, t)

    return (
      <div
        className="overflow-hidden font-mono text-[11px] leading-relaxed text-white/60"
        style={{ fontFamily: FONT_MONO }}
      >
        <span className="mr-1.5 text-white/35">›</span>
        {beat.prompt.slice(0, len)}
        {len < beat.prompt.length && <span className="animate-pulse">▌</span>}
      </div>
    )
  }

  const label =
    beat.cue === 'header' ? null : beat.cue === 'validate' ? '✓' : beat.cue === 'assemble' ? '●' : null

  return (
    <div
      className={cn(
        'flex items-baseline gap-2',
        beat.cue === 'header' ? 'font-medium text-[15px] text-white' : 'text-[13px] text-white/85'
      )}
    >
      {label && <span className={beat.cue === 'assemble' ? 'text-[9px] leading-none' : 'text-[11px]'}>{label}</span>}
      <span>{beat.text}</span>
    </div>
  )
}

/** The finished thing — full-frame at the reveal, miniaturized inside the
 *  theater, AND interactive on the chat card that hands it over. This is the
 *  `FirstScreen` grammar: same sections, three skins. `interactive` is set by
 *  the in-chat card only — the Run buttons then really run (hidden prompt
 *  submit), which is the payoff of building it in-chat. */
export function FirstScreenSurface({
  config,
  interactive = false,
  mini = false
}: {
  config: FirstScreenConfig
  interactive?: boolean
  mini?: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden rounded-lg bg-white text-neutral-900',
        mini ? 'size-full p-3' : 'size-full p-8'
      )}
    >
      <div className={cn('font-medium tracking-tight', mini ? 'text-[13px]' : 'text-[26px]')}>{config.title}</div>
      <div className={cn('text-neutral-500', mini ? 'mt-0.5 text-[10px]' : 'mt-1 text-[13px]')}>
        {config.rationale}
      </div>

      <div className={cn('flex flex-col', mini ? 'mt-2.5 gap-1.5' : 'mt-6 gap-3')}>
        {config.kind === 'dashboard' &&
          config.blocks.map(block =>
            interactive && !mini ? (
              <button
                className="flex items-center justify-between rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 text-left text-[14px] transition-colors hover:border-neutral-900 hover:bg-white"
                key={block.id}
                onClick={() => requestComposerSubmit(block.prompt)}
                type="button"
              >
                <span className="truncate">{block.label}</span>
                <span className="rounded-full bg-neutral-900 px-2.5 py-1 text-[11px] font-medium text-white">Run</span>
              </button>
            ) : (
              <div
                className={cn(
                  'flex items-center justify-between rounded-md border border-neutral-200 bg-neutral-50',
                  mini ? 'px-2 py-1.5 text-[10px]' : 'px-4 py-3 text-[14px]'
                )}
                key={block.id}
              >
                <span className="truncate">{block.label}</span>
                <span
                  className={cn(
                    'rounded-full bg-neutral-900 font-medium text-white',
                    mini ? 'px-1.5 py-0.5 text-[8px]' : 'px-2.5 py-1 text-[11px]'
                  )}
                >
                  Run
                </span>
              </div>
            )
          )}

        {config.kind === 'document' && (
          <div className={cn('flex flex-col', mini ? 'gap-1.5' : 'gap-3')}>
            {config.blocks.map(block => (
              <div className={mini ? 'text-[10px]' : 'text-[14px]'} key={block.id}>
                <div className="font-semibold">{block.label}</div>
                {!mini && <div className="mt-1 line-clamp-2 text-[12px] text-neutral-500">{block.prompt}</div>}
              </div>
            ))}
          </div>
        )}

        {config.kind === 'app' && (
          <>
            <div
              className={cn(
                'rounded-md border border-dashed border-neutral-300 bg-neutral-50',
                mini ? 'p-1.5 text-[9px]' : 'p-4 text-[12px]'
              )}
            >
              Drop something here — {config.blocks[0]?.label.toLowerCase()}
            </div>
            <div
              className={cn(
                'self-start rounded-md bg-neutral-900 font-medium text-white',
                mini ? 'px-2 py-0.5 text-[9px]' : 'px-4 py-2 text-[13px]'
              )}
            >
              {config.blocks[0]?.label ?? 'Run'}
            </div>
          </>
        )}
      </div>

      {!mini && (
        <div className="mt-auto pt-6 text-[11px] text-neutral-400">
          This is <span className="font-mono">~/.hermes/desktop-plugins/first-screen/screen.json</span> — change
          anything.
        </div>
      )}
    </div>
  )
}

/** The theater: log on the left, the artifact assembling on the right. One
 *  clock (provided by the finale) drives everything. */
export function FirstScreenTheater({
  beats,
  config,
  progressStyle,
  t
}: {
  beats: TheaterBeat[]
  config: FirstScreenConfig
  /** Entrance stagger for the whole stage (card-in). */
  progressStyle?: CSSProperties
  t: number
}) {
  const assembledCount = beats.filter(beat => beat.cue === 'assemble' && t >= beat.t).length
  const assembledBlocks = config.blocks.slice(0, assembledCount)

  return (
    <div className="flex size-full gap-6 p-8" style={progressStyle}>
      {/* Build log */}
      <div className="flex w-[46%] flex-col gap-2.5 pt-2">
        {beats.map((beat, i) => (
          <TheaterRow beat={beat} key={i} t={t} />
        ))}
      </div>

      {/* Assembling artifact */}
      <div className="min-w-0 flex-1">
        <div className="flex size-full flex-col overflow-hidden rounded-lg bg-white text-neutral-900 shadow-[0_24px_64px_rgba(0,0,0,0.25)]">
          <div className="border-b border-neutral-100 p-3">
            <div className="text-[13px] font-medium">{assembledCount > 0 ? config.title : ' '}</div>
          </div>
          <div className="flex flex-1 flex-col gap-1.5 p-3">
            {assembledBlocks.map(block => (
              <div
                className="animate-[first-screen-block-in_500ms_cubic-bezier(0.22,1,0.36,1)_both] rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-[10px]"
                key={block.id}
              >
                {block.label}
              </div>
            ))}
            {assembledCount === 0 && (
              <div className="grid flex-1 place-items-center text-[10px] text-neutral-300">assembling…</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Picker preview: a static sketch of what the user gets, rendered from the
 *  same config the theater finalizes so the card never promises a different
 *  product. Mounts into the step cards. */
export function FirstScreenPreview({ config }: { config: FirstScreenConfig }) {
  const kind = useStore($firstScreenKind)

  return (
    <div className={cn('overflow-hidden rounded-[6px] border bg-white', kind === config.kind && 'border-primary')}>
      <FirstScreenSurface config={config} mini />
    </div>
  )
}
