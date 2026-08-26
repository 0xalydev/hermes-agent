import type { ReactNode } from 'react'

/**
 * TRANSCRIPT DIRECTIVES — the transcript as a contribution area.
 *
 * A plugin registers a named directive; the model addresses it by emitting a
 * paragraph of the form `::name{key="value"}` and that leaf renders as the
 * plugin's component, inline in the assistant message. This is the deliberate
 * counterpart to artifact promotion: artifacts are heuristic (substantial
 * fences get promoted whether or not the model asked), directives are
 * addressed (nothing renders unless a plugin claimed the name).
 *
 * The parse is deliberately narrow — a directive must be the entire
 * paragraph, so it can never hijack mid-prose text, and an unclaimed or
 * malformed directive falls back to the plain paragraph it always was.
 * Attributes are untrusted model output: plugins validate their own fields.
 */

export const TRANSCRIPT_DIRECTIVE_AREA = 'transcript.directives'

/** Props handed to a directive contribution's `render`. */
export interface TranscriptDirectiveProps {
  /** Parsed, untrusted attributes (e.g. `{ file: 'demo.html' }`). */
  attrs: Readonly<Record<string, string>>
  /** Original directive source text (diagnostics / fallback rendering). */
  source: string
  /** True while the surrounding message is still streaming. */
  streaming: boolean
}

/** Payload of a `transcript.directives` contribution's `data`. */
export interface TranscriptDirectiveContribution {
  /** The name the model addresses: `::<name>{...}`. Lowercase, `[a-z0-9-]`,
   *  unique across plugins — first registration wins on collision. */
  name: string
  /** Renders the directive leaf. Mounted inside the contribution error
   *  boundary, so a throw degrades to an inline error, not a dead message. */
  render: (props: TranscriptDirectiveProps) => ReactNode
}

export interface ParsedTranscriptDirective {
  name: string
  attrs: Record<string, string>
  source: string
}

// The whole paragraph, nothing else on the line: `::name` or `::name{...}`.
// Length caps bound the attr scan on adversarial input.
const DIRECTIVE_RE = /^::([a-z][a-z0-9-]{0,63})(?:\{([^{}]{0,1024})\})?$/

// `key="value"` pairs; single quotes accepted for model sloppiness.
const ATTR_RE = /([a-z][\w-]{0,63})=(?:"([^"]*)"|'([^']*)')/gi

function parseAttrs(body: string | undefined): Record<string, string> {
  const attrs: Record<string, string> = {}

  for (const pair of (body ?? '').matchAll(ATTR_RE)) {
    attrs[pair[1].toLowerCase()] = pair[2] ?? pair[3] ?? ''
  }

  return attrs
}

/**
 * Parse a paragraph as a transcript directive. Returns null unless the ENTIRE
 * trimmed text is one directive — prose containing `::` stays prose.
 * Pure and synchronous — safe to call during render.
 */
export function parseTranscriptDirective(text: string): ParsedTranscriptDirective | null {
  const trimmed = text.trim()

  // Cheap reject before the regex: directives are short single lines.
  if (!trimmed.startsWith('::') || trimmed.length > 1200 || trimmed.includes('\n')) {
    return null
  }

  const match = DIRECTIVE_RE.exec(trimmed)

  if (!match) {
    return null
  }

  return { name: match[1], attrs: parseAttrs(match[2]), source: trimmed }
}

// A directive ANYWHERE in the paragraph (used by the list parser, which then
// verifies the matches tile the whole string — same no-prose guarantee).
const DIRECTIVE_ANY_RE = /::([a-z][a-z0-9-]{0,63})(?:\{([^{}]{0,1024})\})?/g

/**
 * Parse a paragraph that is ENTIRELY directives — one or more, separated by
 * whitespace (spaces or newlines). Models sometimes emit two directives on
 * one line ("::onboarding{step=name} ::onboarding{step=focus}"); the strict
 * single parse refused those and the raw markup leaked into the transcript.
 * Returns null if anything in the paragraph is not a directive, so prose is
 * never hijacked — same contract as the single parse, generalized.
 */
export function parseTranscriptDirectiveList(text: string): ParsedTranscriptDirective[] | null {
  const trimmed = text.trim()

  if (!trimmed.startsWith('::') || trimmed.length > 4800) {
    return null
  }

  const single = parseTranscriptDirective(trimmed)

  if (single) {
    return [single]
  }

  const out: ParsedTranscriptDirective[] = []
  let cursor = 0

  DIRECTIVE_ANY_RE.lastIndex = 0

  for (const match of trimmed.matchAll(DIRECTIVE_ANY_RE)) {
    const start = match.index ?? 0

    // Anything but whitespace between directives → prose, not a directive
    // paragraph. Bail entirely.
    if (trimmed.slice(cursor, start).trim() !== '') {
      return null
    }

    out.push({ name: match[1], attrs: parseAttrs(match[2]), source: match[0] })
    cursor = start + match[0].length
  }

  // Trailing prose after the last directive → not a directive paragraph.
  if (out.length < 2 || trimmed.slice(cursor).trim() !== '') {
    return null
  }

  return out
}

export type TranscriptParagraphSegment =
  | { kind: 'prose'; text: string }
  | { kind: 'directive'; directive: ParsedTranscriptDirective }

// Same shape, but anywhere in a paragraph — anchored to a word boundary so
// `std::vector` can never be read as a directive.
const DIRECTIVE_EMBEDDED_RE = /(?<=^|\s)::([a-z][a-z0-9-]{0,63})(?:\{([^{}]{0,1024})\})?/g

/**
 * Split a paragraph into its prose runs and the directives embedded in them.
 * Returns null when there is no directive in it at all.
 *
 * The strict parses above exist so prose can never be hijacked, and they are
 * still what decides whether a paragraph IS a directive. This is the recovery
 * path for the other half of the problem: a model that writes the directive at
 * the end of the sentence instead of alone under it. The runbook asks for its
 * own paragraph and the fast models we run onboarding on comply most of the
 * time — but a miss used to print `::onboarding{step="look"}` at the user in
 * raw text AND swallow the card, which on the colour step means the flow
 * simply stops. A card rendered next to its sentence is the mild failure; the
 * markup showing is not.
 *
 * Prose is never guessed at: a directive nobody registered stays exactly the
 * text it was (the caller folds it back), so this widens what renders without
 * widening what can be taken away from the reader.
 */
export function segmentTranscriptDirectives(text: string): TranscriptParagraphSegment[] | null {
  if (!text.includes('::') || text.length > 4800) {
    return null
  }

  const out: TranscriptParagraphSegment[] = []
  let cursor = 0

  DIRECTIVE_EMBEDDED_RE.lastIndex = 0

  for (const match of text.matchAll(DIRECTIVE_EMBEDDED_RE)) {
    const start = match.index ?? 0

    if (start > cursor) {
      out.push({ kind: 'prose', text: text.slice(cursor, start) })
    }

    out.push({
      kind: 'directive',
      directive: { name: match[1], attrs: parseAttrs(match[2]), source: match[0] }
    })
    cursor = start + match[0].length
  }

  if (out.length === 0) {
    return null
  }

  if (cursor < text.length) {
    out.push({ kind: 'prose', text: text.slice(cursor) })
  }

  return out
}
