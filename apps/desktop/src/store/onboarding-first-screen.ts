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
  // No name yet → speak in second person, never a fake name. "there's
  // command center" shipped once; never again.
  const userName = name || 'you'
  const possessive = name ? `${name}'s` : 'Your'

  const blocks: FirstScreenBlock[] =
    kind === 'dashboard'
      ? [
          {
            id: 'start',
            kind: 'action',
            label: `Start today's ${primary.toLowerCase()}`,
            prompt: `Find my single best next task for today in ${primary.toLowerCase()}${focus.length > 1 ? ` or ${secondary.toLowerCase()}` : ''}: one sentence on why it's the one, then the first three concrete steps. No preamble.`,
            stepLine: `Wiring your ${primary.toLowerCase()} starter`
          },
          {
            id: 'draft',
            kind: 'draft',
            label: 'Draft in your voice',
            prompt: `Draft what I describe, in my voice: plain, direct, short sentences. Show me the draft, ask at most one clarifying question, then revise.`,
            stepLine: 'Teaching it your voice'
          },
          {
            id: 'brief',
            kind: 'feed',
            label: 'Morning brief',
            prompt: `Assemble my morning brief: three items on ${primary.toLowerCase()}${focus.length > 1 ? `, two on ${secondary.toLowerCase()}` : ''}, one line each with a source, then one sentence on what I should look at first. Offer to save it as a recurring morning job.`,
            stepLine: 'Setting your morning brief'
          }
        ]
      : kind === 'document'
        ? [
            {
              id: 'brief',
              kind: 'feed',
              label: 'Your first issue',
              prompt: `Write the first issue of my personal brief. Lead with ${primary.toLowerCase()}: the three most useful things from the last day, one line each with a source. ${focus.length > 1 ? `Then a short ${secondary.toLowerCase()} section with two items. ` : ''}Close with one concrete suggestion for today.`,
              stepLine: 'Composing your first issue'
            },
            {
              id: 'recurring',
              kind: 'action',
              label: 'Make it daily',
              prompt: `Set up a paused recurring job that regenerates my brief every morning, same shape as the first issue. Confirm it's paused and tell me exactly how to turn it on.`,
              stepLine: 'Setting the daily cadence'
            },
            {
              id: 'notebook',
              kind: 'draft',
              label: 'A page that remembers',
              prompt: `Keep a running page for me. When I paste anything, a quote, a link, a thought, file it under ${primary.toLowerCase()} or ${secondary.toLowerCase()} and acknowledge in one line. When I ask what I have on a topic, summarize what's filed.`,
              stepLine: 'Opening your notebook'
            }
          ]
        : [
            {
              id: 'tool',
              kind: 'tool',
              label: `${primary} helper`,
              prompt: `Act as my ${primary.toLowerCase()} helper, a tool rather than a conversation: I paste raw material, you return exactly one shaped result${focus.length > 1 ? ` about ${primary.toLowerCase()} or ${secondary.toLowerCase()}` : ''}, nothing else. If my input is ambiguous, pick the most likely reading and show it. Three sections maximum.`,
              stepLine: `Building your ${primary.toLowerCase()} helper`
            },
            {
              id: 'refine',
              kind: 'action',
              label: 'Refine the last result',
              prompt: `Take your last result and my one-line correction, and return a revised result in the same shape. If my correction changes the rules, say what changed in one sentence.`,
              stepLine: 'Wiring the refine loop'
            },
            {
              id: 'share',
              kind: 'draft',
              label: 'Save as a template',
              prompt: `Turn the current inputs into a reusable template: name it, describe the input it expects in one line, and store it so the next run starts from it. Confirm the name.`,
              stepLine: 'Making it repeatable'
            }
          ]

  const focusSummary =
    focus.length === 0
      ? 'your day'
      : focus.length === 1
        ? primary.toLowerCase()
        : `${primary.toLowerCase()} and ${secondary.toLowerCase()}`

  return {
    blocks,
    kind,
    rationale: `Built around ${focusSummary}`,
    title:
      kind === 'dashboard'
        ? `${possessive} command center`
        : kind === 'document'
          ? `${possessive} daily brief`
          : `${possessive} ${primary.toLowerCase()} tool`,
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

  beats.push({
    cue: 'header',
    t: 0,
    text: `Making ${config.userName === 'you' ? 'your' : `${config.userName}'s`} ${config.kind}`
  })

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

// ── Materialization ─────────────────────────────────────────────────────────

/** The plugin folder id the artifact lands in, under the LOCAL desktop-plugins
 *  root. Fixed so a repeat run overwrites the same folder, not a litter of
 *  suffixed copies. */
export const FIRST_SCREEN_PLUGIN_DIR = 'first-screen'

/** The plugin.js source for the first-screen plugin — the artifact's
 *  renderer. One template string so materializeFirstScreen can write it next
 *  to screen.json, and the loader hot-reloads it on save. The config is
 *  embedded at build time; the plugin reads screen.json through the plugin
 *  filesystem door added in the same change, so a user edit to screen.json
 *  repaints the pane without an app restart. */
export const FIRST_SCREEN_PLUGIN_JS = `/** first-screen — the screen onboarding built, kept alive as a pane.
 *
 *  screen.json in this folder IS the product: edit it and this pane repaints
 *  on save. Press Run and the block's prompt goes through your chat's normal
 *  path. Plain DOM (no JSX) so the runtime loader can import the file as-is.
 */

import React, { useEffect, useState } from 'react'

import { host } from '@hermes/plugin-sdk'

export default {
  id: 'first-screen',
  name: 'First Screen',
  description: 'The screen Hermes built at first setup, as a live pane.',
  register(ctx) {
    function FirstScreenPane() {
      const [config, setConfig] = useState(() => ctx.storage.get('config', null))

      useEffect(() => {
        let alive = true

        const load = () =>
          ctx.os
            .readPluginFileText('screen.json')
            .then(({ text }) => {
              if (alive) setConfig(JSON.parse(text))
            })
            .catch(() => {})

        void load()

        const stop = ctx.os.watchPluginFile('screen.json', load)

        return () => {
          alive = false
          stop()
        }
      }, [])

      // Run = the block's prompt goes through the ACTIVE composer, visibly —
      // the user sees their click become a real turn. Falls back to a toast
      // when no chat surface is on screen to claim it.
      const run = prompt => {
        const sent = typeof host.submitPrompt === 'function' && host.submitPrompt(prompt)

        if (!sent) {
          host.notify({ kind: 'info', message: 'Open a chat to run this — the button sends its prompt there.' })
        }
      }

      const h = React.createElement
      const blocks = config?.blocks ?? []

      // A populated block renders its content under the header (feed items,
      // draft skeleton, steps, example); an unpopulated one stays a compact
      // row. Same file, both states — population is a rewrite of screen.json.
      const body = block => {
        const c = block.content

        if (!c) return null
        if (c.kind === 'feed' && Array.isArray(c.items) && c.items.length)
          return h(
            'div',
            { className: 'fs-body' },
            c.items.map((item, i) =>
              h(
                'div',
                { className: 'fs-item', key: i },
                h('span', null, item.line),
                item.source ? h('span', { className: 'fs-src' }, item.source) : null
              )
            )
          )
        if (c.kind === 'draft' && c.skeleton) return h('div', { className: 'fs-body fs-skel' }, c.skeleton)
        if (c.kind === 'action' && Array.isArray(c.steps) && c.steps.length)
          return h(
            'ol',
            { className: 'fs-body fs-steps' },
            c.steps.map((step, i) => h('li', { key: i }, step))
          )
        if (c.kind === 'tool' && c.example)
          return h(
            'div',
            { className: 'fs-body' },
            h('div', { className: 'fs-item' }, h('span', { className: 'fs-src' }, 'in'), h('span', null, c.example.input)),
            h('div', { className: 'fs-item' }, h('span', { className: 'fs-src' }, 'out'), h('span', null, c.example.output))
          )

        return null
      }

      return h(
        'div',
        { 'data-tour': 'first-screen', style: { display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', padding: 12 } },
        h('div', { style: { fontSize: 14, fontWeight: 600 } }, config?.title ?? 'your first screen'),
        config?.rationale ? h('div', { style: { fontSize: 11, marginTop: 2, opacity: 0.7 } }, config.rationale) : null,
        h(
          'style',
          null,
          '.fs-card{background:transparent;border:1px solid var(--border);border-radius:8px;color:var(--foreground);display:flex;flex-direction:column;width:100%}' +
            '.fs-row{align-items:center;background:transparent;border:0;color:var(--foreground);cursor:pointer;display:flex;font-size:12px;justify-content:space-between;gap:10px;padding:9px 12px;text-align:left;transition:background 120ms ease;width:100%}' +
            '.fs-row:hover{background:color-mix(in srgb, var(--accent) 24%, transparent)}' +
            '.fs-row:active{background:color-mix(in srgb, var(--accent) 38%, transparent)}' +
            '.fs-pill{background:var(--primary);border-radius:999px;color:var(--primary-foreground);font-size:10px;font-weight:500;opacity:.85;padding:2px 9px;transition:opacity 120ms ease}' +
            '.fs-row:hover .fs-pill{opacity:1}' +
            '.fs-body{border-top:1px solid var(--border);display:flex;flex-direction:column;font-size:11px;gap:6px;padding:8px 12px 10px}' +
            '.fs-item{display:flex;gap:8px;justify-content:space-between;line-height:1.45}' +
            '.fs-src{color:var(--muted-foreground);flex:none;font-size:10px}' +
            '.fs-skel{color:var(--muted-foreground);white-space:pre-wrap}' +
            '.fs-steps{margin:0;padding-left:16px}.fs-steps li{line-height:1.5}'
        ),
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 } },
          blocks.map(block =>
            h(
              'div',
              { className: 'fs-card', key: block.id },
              h(
                'button',
                { className: 'fs-row', onClick: () => run(block.prompt), type: 'button' },
                h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, block.label),
                h('span', { className: 'fs-pill' }, 'Run')
              ),
              body(block)
            )
          )
        ),
        h(
          'div',
          { style: { color: 'var(--muted-foreground)', fontSize: 10, marginTop: 'auto', paddingTop: 12 } },
          'Yours to change: edit screen.json in ~/.hermes/desktop-plugins/first-screen/ and this pane repaints.'
        )
      )
    }

    ctx.register({
      id: 'pane',
      area: 'panes',
      title: 'your first screen',
      data: { collapsible: true, dock: { pane: 'workspace', pos: 'right' }, minWidth: '320px', placement: 'right', width: '380px' },
      render: () => React.createElement(FirstScreenPane)
    })

    // Sidebar row: "your first screen" alongside the built-ins. Clicking
    // reveals the pane (no route to navigate to — the pane is the product).
    // isNew marks the row fresh-out-of-onboarding until the user sees it.
    ctx.register({
      id: 'nav',
      area: 'sidebar.nav',
      isNew: true,
      data: {
        codicon: 'sparkle',
        label: 'your first screen',
        onClick: () => {
          if (typeof host.revealPane === 'function') {
            host.revealPane('first-screen:pane')
          }
        }
      }
    })
  }
}
`

/** Serialize a config into the plugin's screen.json — the file the user edits
 *  later. The prompts carry the profile, and the `generatedFrom` echo is what
 *  makes the file read as theirs when they open it outside the app. */
export function firstScreenFileContent(config: FirstScreenConfig): string {
  return `${JSON.stringify(
    {
      blocks: config.blocks.map(({ id, kind, label, prompt }) => ({ id, kind, label, prompt })),
      generatedAt: new Date().toISOString(),
      generatedFrom: { focus: config.rationale, name: config.userName },
      kind: config.kind,
      title: config.title
    },
    null,
    2
  )}\n`
}

export type MaterializeFirstScreenResult = { ok: true; path: string } | { ok: false; error: string }

/** Persist the artifact into `<desktop-plugins>/first-screen/screen.json`.
 *  No-op (ok) when there is no Electron bridge — browser runs just don't get
 *  the file. Called by the wizard window as it hands off, so the reveal's
 *  promise about the file path is already true when the user opens it. */
export async function materializeFirstScreen(config: FirstScreenConfig): Promise<MaterializeFirstScreenResult> {
  const desktop = window.hermesDesktop

  if (!desktop?.desktopPluginsRoot) {
    return { ok: false, error: 'no electron bridge' }
  }

  try {
    if (desktop.mkdirDesktopPlugin) {
      const made = await desktop.mkdirDesktopPlugin(FIRST_SCREEN_PLUGIN_DIR)

      if (!made.ok) {
        return { ok: false, error: made.error ?? 'mkdir failed' }
      }
    }

    const root = await desktop.desktopPluginsRoot()
    const dir = `${root}/${FIRST_SCREEN_PLUGIN_DIR}`
    const filePath = `${dir}/screen.json`

    if (!desktop.writeTextFile) {
      return { ok: false, error: 'no writeTextFile' }
    }

    // The pane itself: plugin.js (the renderer) + screen.json (the artifact)
    // land in the same folder, so the disk-door loader picks the plugin up on
    // its next scan tick — and any later save to either file hot-reloads it.
    await desktop.writeTextFile(`${dir}/plugin.js`, FIRST_SCREEN_PLUGIN_JS)
    await desktop.writeTextFile(filePath, firstScreenFileContent(config))

    return { ok: true, path: filePath }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
