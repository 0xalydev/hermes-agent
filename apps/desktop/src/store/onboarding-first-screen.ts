/**
 * First-screen artifact — the personalized thing onboarding hands the user at
 * the finale. The dialogue collects a profile (name + focus); this store turns
 * that profile plus the user's pick (dashboard / document / app) into a
 * self-contained config, and the finale theater reveals it block by block.
 *
 * The fiction contract: theater copy narrates real mechanical work (compile,
 * write, validate), and the per-block prompts ASSEMBLE DURING THE SEQUENCE are
 * shown verbatim — their text interpolates the user's answers, so the
 * personalization is visible, not claimed. Everything here is pure assembly:
 * no model call, no file write, no backend. The config is deterministic from
 * the profile, so a failed anything falls back to a generic-but-working deck.
 */

import { atom } from 'nanostores'

import { readJson, writeJson } from '@/lib/storage'

const KIND_KEY = 'hermes-onboarding-first-screen-kind-v1'

export type FirstScreenKind = 'app' | 'dashboard' | 'document'

export const FIRST_SCREEN_KINDS: readonly FirstScreenKind[] = ['dashboard', 'document', 'app']

/** A single tile/button/document step. `prompt` is the full instruction sent
 *  to the agent when the block is used; it already embeds the profile. */
export interface FirstScreenBlock {
  id: string
  /** Which template rendered this block (drives the preview mock's shape). */
  kind: 'action' | 'draft' | 'feed' | 'tool'
  label: string
  /** Theater copy — the "doing" line shown while this block assembles. */
  stepLine: string
  /** The full prompt behind this block — the real personalization payload. */
  prompt: string
}

export interface FirstScreenConfig {
  blocks: FirstScreenBlock[]
  kind: FirstScreenKind
  /** One-line why-it-fits summary, from the profile ("Mornings, writing…"). */
  rationale: string
  title: string
  userName: string
}

export interface FirstScreenProfile {
  focus: string[]
  name: string
}

// DEV iteration aid: initialAnswers() in onboarding-wizard.ts wipes stored
// answers every boot, which would reset the pick to the default on every HMR.
// The pick persists per-PROFILE here instead — same durability rule the rest
// of onboarding uses, isolated from the answers wipe.
function loadKind(): FirstScreenKind | null {
  const value = readJson<string>(KIND_KEY)

  return typeof value === 'string' && FIRST_SCREEN_KINDS.includes(value as FirstScreenKind)
    ? (value as FirstScreenKind)
    : null
}

export const $firstScreenKind = atom<FirstScreenKind | null>(loadKind())

export function setFirstScreenKind(kind: FirstScreenKind | null): void {
  $firstScreenKind.set(kind)
  writeJson(KIND_KEY, kind)
}

/** The sequence the user will see — used by the picker previews AND the
 *  theater, so what the card sketches is what's delivered. */
export function compileFirstScreen(profile: FirstScreenProfile, kind: FirstScreenKind): FirstScreenConfig {
  const focus = profile.focus.filter(Boolean)
  const name = profile.name.trim()
  const primary = focus[0] ?? 'your day'
  const secondary = focus[1] ?? focus[0] ?? 'your projects'
  const userName = name || 'there'

  const blocks: FirstScreenBlock[] =
    kind === 'dashboard'
      ? [
          {
            id: 'start',
            kind: 'action',
            label: `Start today's ${primary.toLowerCase()}`,
            prompt: `You are ${userName}'s daily starter. They care most about ${primary.toLowerCase()}${focus.length > 1 ? ` and ${secondary.toLowerCase()}` : ''}. Give them the single best next task for today, one sentence of why, and the first three concrete steps. No preamble.`,
            stepLine: `Wiring your ${primary.toLowerCase()} starter`
          },
          {
            id: 'draft',
            kind: 'draft',
            label: 'Draft in their voice',
            prompt: `You are ${userName}'s writing hand. Match their registered style — plain, direct, short sentences. Draft what they ask for; if they ask about ${primary.toLowerCase()} or ${secondary.toLowerCase()}, fold in what you know about their focus. Show the draft, ask one clarification at most, then revise.`,
            stepLine: 'Teaching it your voice'
          },
          {
            id: 'brief',
            kind: 'feed',
            label: 'Morning brief',
            prompt: `Once each morning, assemble ${userName}'s brief: three items on ${primary.toLowerCase()}${focus.length > 1 ? `, two on ${secondary.toLowerCase()}` : ''}, each one line with a source. Then one sentence answering "what should you look at first". Offer to save it as a recurring job.`,
            stepLine: 'Setting your morning brief'
          }
        ]
      : kind === 'document'
        ? [
            {
              id: 'brief',
              kind: 'feed',
              label: 'Your first issue',
              prompt: `Write the first issue of ${userName}'s personal brief. Lead with ${primary.toLowerCase()}: the three most useful things from the last day, one line each with a source. ${focus.length > 1 ? `Then a short ${secondary.toLowerCase()} section with two items. ` : ''}Close with one concrete suggestion for today. Address them by name once, at the top.`,
              stepLine: 'Composing your first issue'
            },
            {
              id: 'recurring',
              kind: 'action',
              label: 'Make it daily',
              prompt: `Set up a paused recurring job that regenerates ${userName}'s brief every morning, same shape as the first issue. Confirm it's paused and tell them exactly how to turn it on.`,
              stepLine: 'Setting the daily cadence'
            },
            {
              id: 'notebook',
              kind: 'draft',
              label: 'A page that remembers',
              prompt: `Keep a running page for ${userName}. When they paste anything — a quote, a link, a thought — file it under ${primary.toLowerCase()} or ${secondary.toLowerCase()} and acknowledge in one line. When they ask "what do I have on X", summarize what's been filed.`,
              stepLine: 'Opening your notebook'
            }
          ]
        : [
            {
              id: 'tool',
              kind: 'tool',
              label: `${primary} helper`,
              prompt: `You are a small tool, not a conversation. ${userName} pastes raw material; you return exactly one shaped result about ${primary.toLowerCase()}${focus.length > 1 ? ` or ${secondary.toLowerCase()}` : ''}, nothing else. If the input is ambiguous, pick the most likely reading and show it — do not ask questions. Three sections maximum.`,
              stepLine: `Building your ${primary.toLowerCase()} helper`
            },
            {
              id: 'refine',
              kind: 'action',
              label: 'Refine the last result',
              prompt: `Take the tool's last output and ${userName}'s one-line correction. Return a revised result in the same shape. If the correction changes the rules, say what changed in one sentence.`,
              stepLine: 'Wiring the refine loop'
            },
            {
              id: 'share',
              kind: 'draft',
              label: 'Save as a template',
              prompt: `Turn the current inputs into a reusable template for ${userName}: name it, describe the input it expects in one line, and store it so the next run starts from it. Confirm the name.`,
              stepLine: 'Making it repeatable'
            }
          ]

  const focusSummary =
    focus.length === 0 ? 'your day' : focus.length === 1 ? primary.toLowerCase() : `${primary.toLowerCase()} and ${secondary.toLowerCase()}`

  return {
    blocks,
    kind,
    rationale: `Built around ${focusSummary}`,
    title:
      kind === 'dashboard'
        ? `${userName}'s command center`
        : kind === 'document'
          ? `${userName}'s daily brief`
          : `${userName}'s ${primary.toLowerCase()} tool`,
    userName
  }
}

// ── Theater timeline ────────────────────────────────────────────────────────
// One declarative beat table the finale's clock reads. Copy stays normie —
// the "real work" it narrates is the config assembly above (compile + write +
// validate), which completes inside the first beat.

export interface TheaterBeat {
  /** Block assembled during this beat (its stepLine drives the row copy). */
  blockIndex?: number
  cue: 'assemble' | 'header' | 'prompt' | 'validate'
  /** Prompt lines are typed out — the personalization is the entertainment. */
  prompt?: string
  /** ms from sequence start. */
  t: number
  text?: string
}

export function buildTheaterBeats(config: FirstScreenConfig): TheaterBeat[] {
  const beats: TheaterBeat[] = []
  const beatMs = 1900

  beats.push({ cue: 'header', t: 0, text: `Making ${config.userName === 'there' ? 'yours' : `${config.userName}'s`} ${config.kind}` })

  config.blocks.forEach((block, i) => {
    const t = 900 + i * beatMs

    beats.push({ blockIndex: i, cue: 'assemble', t, text: block.stepLine })
    // Show the actual prompt being compiled — the user's own words land in it.
    beats.push({ blockIndex: i, cue: 'prompt', prompt: block.prompt, t: t + 500 })
  })

  const last = 900 + config.blocks.length * beatMs

  beats.push({ cue: 'validate', t: last, text: 'Checking everything works' })

  return beats
}

// ── Theater timing ───────────────────────────────────────────────────────────

const BEAT_MS = 1900

/** Total theater length — the surface schedules the reveal hold + handoff
 *  after this. */
export function theaterDuration(config: FirstScreenConfig): number {
  return 900 + config.blocks.length * BEAT_MS + 1400
}

export function resetFirstScreenForTests(): void {
  $firstScreenKind.set(null)
}
