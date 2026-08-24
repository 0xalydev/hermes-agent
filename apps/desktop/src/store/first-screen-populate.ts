/**
 * First-screen population — the generative pass that turns the deterministic
 * artifact into a PRE-BUILT one: every block ships with real content shaped
 * for its prompt (feed items with sources, a voice skeleton, concrete steps,
 * an input→output example) instead of opening as bare Run buttons.
 *
 * Contract with the rest of onboarding:
 *  - `compileFirstScreen` stays deterministic and offline — it is the
 *    fallback and the theater script. Population is a LAYER on top.
 *  - Population runs in the MAIN renderer over the existing gateway RPC
 *    (hidden agent session → one JSON turn → session.close). No new backend
 *    surface; the agent may use its real tools (web search) for feed items,
 *    so the content is genuine, not confabulated-fresh.
 *  - The result is merged into screen.json next to the prompts. The pane's
 *    file watcher repaints it the moment the write lands — the user sees
 *    their screen fill in a few seconds after it opens. Any failure leaves
 *    the deterministic artifact exactly as it was: blocks without content
 *    render as today's compact rows.
 *  - Idempotent per materialization: callers guard, and a re-run just
 *    rewrites the same file.
 */

import { activeGateway } from '@/store/gateway'

import { FIRST_SCREEN_PLUGIN_DIR, type FirstScreenBlock, type FirstScreenConfig } from './onboarding-first-screen'

// ── Content shapes (mirrored by the plugin renderer in plugin.js) ───────────

export interface FeedContentItem {
  line: string
  source: string
}

export type FirstScreenBlockContent =
  | { kind: 'action'; steps: string[] }
  | { kind: 'draft'; skeleton: string }
  | { kind: 'feed'; items: FeedContentItem[] }
  | { kind: 'tool'; example: { input: string; output: string } }

export type FirstScreenContentMap = Record<string, FirstScreenBlockContent>

// Length clamps — generated copy drifts long and ornate; the pane is narrow.
const MAX_LINE = 110
const MAX_SOURCE = 40
const MAX_SKELETON = 320
const MAX_STEP = 90
const MAX_EXAMPLE = 160

const clamp = (value: string, max: number) => {
  const text = value.trim()

  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

// ── JSON contract ────────────────────────────────────────────────────────────

/** One prompt for the whole screen: every block populated in a single turn.
 *  The agent is told which blocks want live lookups (feed) and which are
 *  written from the profile alone, and must answer with ONLY a JSON object. */
export function buildPopulatePrompt(config: FirstScreenConfig): string {
  const blocks = config.blocks.map(({ id, kind, label, prompt }) => ({ id, kind, label, prompt }))

  return [
    `Fill in the starter screen you just built for ${config.userName === 'you' ? 'the user' : config.userName} (${config.rationale.toLowerCase()}).`,
    'Each block below carries the prompt it will run later; produce the content a user would expect to ALREADY see on a well-made screen before pressing anything.',
    'For "feed" blocks: use web search to find 3 genuinely current items matching the block\'s prompt; each item is {"line": one plain sentence <=100 chars, "source": publication or site name only}. Real items only — if search fails, return fewer or none rather than inventing.',
    'For "draft" blocks: {"skeleton": a fill-in-the-blank template <=300 chars in a plain, direct voice with [bracketed] slots} matching the block\'s prompt.',
    'For "action" blocks: {"steps": [3 concrete steps, each <=80 chars]} the user could take right now, specific to the block\'s prompt.',
    'For "tool" blocks: {"example": {"input": <=150 chars, "output": <=150 chars}} showing one honest before→after for the tool the prompt describes.',
    'No exclamation marks. Never praise the user. Plain declaratives.',
    `Blocks: ${JSON.stringify(blocks)}`,
    'Reply with ONLY a JSON object, no prose, no code fences: {"blocks": {"<id>": <content per its kind>, ...}}.'
  ].join('\n')
}

/** Strict-ish parse of the model's reply: fences tolerated, shape validated
 *  per block kind, lengths clamped. Returns only the blocks that validated —
 *  a half-good answer populates half the screen rather than nothing. */
export function parsePopulateReply(text: string, blocks: FirstScreenBlock[]): FirstScreenContentMap {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')

  if (start < 0 || end <= start) {
    return {}
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return {}
  }

  const raw =
    parsed && typeof parsed === 'object' && 'blocks' in parsed && parsed.blocks && typeof parsed.blocks === 'object'
      ? (parsed.blocks as Record<string, unknown>)
      : null

  if (!raw) {
    return {}
  }

  const result: FirstScreenContentMap = {}

  for (const block of blocks) {
    const value = raw[block.id]

    if (!value || typeof value !== 'object') {
      continue
    }

    const v = value as Record<string, unknown>

    if (block.kind === 'feed' && Array.isArray(v['items'])) {
      const items = (v['items'] as unknown[])
        .filter(
          (item): item is { line: string; source: string } =>
            !!item &&
            typeof item === 'object' &&
            typeof (item as Record<string, unknown>)['line'] === 'string' &&
            typeof (item as Record<string, unknown>)['source'] === 'string' &&
            ((item as Record<string, unknown>)['line'] as string).trim().length > 0
        )
        .slice(0, 4)
        .map(item => ({ line: clamp(item.line, MAX_LINE), source: clamp(item.source, MAX_SOURCE) }))

      if (items.length > 0) {
        result[block.id] = { items, kind: 'feed' }
      }
    } else if (block.kind === 'draft' && typeof v['skeleton'] === 'string' && v['skeleton'].trim()) {
      result[block.id] = { kind: 'draft', skeleton: clamp(v['skeleton'], MAX_SKELETON) }
    } else if (block.kind === 'action' && Array.isArray(v['steps'])) {
      const steps = (v['steps'] as unknown[])
        .filter((step): step is string => typeof step === 'string' && step.trim().length > 0)
        .slice(0, 4)
        .map(step => clamp(step, MAX_STEP))

      if (steps.length > 0) {
        result[block.id] = { kind: 'action', steps }
      }
    } else if (block.kind === 'tool' && v['example'] && typeof v['example'] === 'object') {
      const example = v['example'] as Record<string, unknown>

      if (typeof example['input'] === 'string' && typeof example['output'] === 'string' && example['input'].trim()) {
        result[block.id] = {
          example: { input: clamp(example['input'], MAX_EXAMPLE), output: clamp(example['output'], MAX_EXAMPLE) },
          kind: 'tool'
        }
      }
    }
  }

  return result
}

// ── screen.json rewrite ──────────────────────────────────────────────────────

/** screen.json with content merged in — same shape materialize writes, plus a
 *  `content` field on populated blocks and a `populatedAt` stamp. */
export function populatedFileContent(config: FirstScreenConfig, content: FirstScreenContentMap): string {
  return `${JSON.stringify(
    {
      blocks: config.blocks.map(({ id, kind, label, prompt }) => ({
        id,
        kind,
        label,
        prompt,
        ...(content[id] ? { content: content[id] } : {})
      })),
      generatedAt: new Date().toISOString(),
      generatedFrom: { focus: config.rationale, name: config.userName },
      kind: config.kind,
      populatedAt: new Date().toISOString(),
      title: config.title
    },
    null,
    2
  )}\n`
}

// ── The population run ───────────────────────────────────────────────────────

const COMPLETE_TIMEOUT_MS = 150_000
const CREATE_TIMEOUT_MS = 20_000

/** Fire-and-forget: generate content for every block and rewrite screen.json.
 *  Resolves true when the file was rewritten with at least one populated
 *  block. Never throws — every failure path resolves false and leaves the
 *  deterministic artifact untouched. */
export async function populateFirstScreenArtifact(config: FirstScreenConfig): Promise<boolean> {
  const desktop = window.hermesDesktop

  if (!desktop?.desktopPluginsRoot || !desktop.writeTextFile) {
    return false
  }

  const gateway = activeGateway()

  if (!gateway) {
    return false
  }

  let sessionId = ''

  try {
    // Same fast lane as the guided chat: the turn is structured JSON work
    // (plus a search for feed blocks); flagship latency buys nothing here.
    // Model refusal falls back to the profile default via a bare create.
    const created = await gateway
      .request<{ session_id?: string }>(
        'session.create',
        { cols: 96, model: 'z-ai/glm-5.2', provider: 'nous', source: 'desktop' },
        CREATE_TIMEOUT_MS
      )
      .catch(() =>
        gateway.request<{ session_id?: string }>('session.create', { cols: 96, source: 'desktop' }, CREATE_TIMEOUT_MS)
      )

    sessionId = created?.session_id ?? ''

    if (!sessionId) {
      return false
    }

    // The hidden session shows in history — title it honestly.
    void gateway
      .request('session.title', { session_id: sessionId, title: 'First screen content' })
      .catch(() => undefined)

    const reply = await new Promise<string>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        off()
        reject(new Error('populate timeout'))
      }, COMPLETE_TIMEOUT_MS)

      const off = gateway.onEvent(event => {
        if (event.type !== 'message.complete' || event.session_id !== sessionId) {
          return
        }

        window.clearTimeout(timer)
        off()

        const payload = (event.payload ?? {}) as { status?: string; text?: string }

        if (payload.status === 'error') {
          reject(new Error('populate turn failed'))
        } else {
          resolve(payload.text ?? '')
        }
      })

      void gateway
        .request('prompt.submit', { session_id: sessionId, text: buildPopulatePrompt(config) })
        .catch(error => {
          window.clearTimeout(timer)
          off()
          reject(error instanceof Error ? error : new Error(String(error)))
        })
    })

    const content = parsePopulateReply(reply, config.blocks)

    if (Object.keys(content).length === 0) {
      return false
    }

    const root = await desktop.desktopPluginsRoot()

    await desktop.writeTextFile(`${root}/${FIRST_SCREEN_PLUGIN_DIR}/screen.json`, populatedFileContent(config, content))

    return true
  } catch {
    return false
  } finally {
    if (sessionId) {
      void gateway.request('session.close', { session_id: sessionId }).catch(() => undefined)
    }
  }
}
