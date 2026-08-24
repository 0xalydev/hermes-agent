import type { FC, ReactNode } from 'react'
import { useMemo } from 'react'

import { type Contribution, useContributions } from '@/contrib'
import { ContribBoundary } from '@/contrib/react/boundary'
import {
  type ParsedTranscriptDirective,
  parseTranscriptDirectiveList,
  TRANSCRIPT_DIRECTIVE_AREA,
  type TranscriptDirectiveContribution
} from '@/lib/transcript-directives'

/**
 * The transcript's directive slot. Given a paragraph's raw text, renders the
 * registered plugin component(s) when the whole paragraph is claimed
 * `::name{...}` directives; returns null otherwise so the caller keeps its
 * plain `<p>` — an unclaimed directive is just prose.
 *
 * A paragraph may carry SEVERAL directives (models merge lines under
 * formatting pressure); each claimed one renders in order, and the no-prose
 * guarantee holds for the paragraph as a whole (see
 * parseTranscriptDirectiveList).
 *
 * Resolution is registry-backed (`transcript.directives`), so hot-loading a
 * plugin upgrades already-rendered paragraphs in place, exactly like every
 * other contribution area.
 */

/** Extract the paragraph's text when it is text-only — directives never carry
 *  inline markup, so any non-string child disqualifies the paragraph. */
export function paragraphPlainText(children: ReactNode): string | null {
  if (typeof children === 'string') {
    return children
  }

  if (Array.isArray(children) && children.length > 0 && children.every(child => typeof child === 'string')) {
    return children.join('')
  }

  return null
}

/** The contribution claiming `name`, if any. First registration wins. */
function claimFor(contributions: readonly Contribution[], name: string) {
  return contributions.find(c => (c.data as TranscriptDirectiveContribution | undefined)?.name === name)
}

const DirectiveEntry: FC<{
  contribution: Contribution
  parsed: ParsedTranscriptDirective
  streaming: boolean
}> = ({ contribution, parsed, streaming }) => {
  const render = (contribution.data as TranscriptDirectiveContribution).render

  // Stable component IDENTITY per (render, parsed) — a fresh type per parent
  // render would remount the widget (card-sized jump). Streaming arrives as a
  // real prop on that stable type, so the settle flip re-renders the same
  // mount instead of being memo-skipped (ref-only reads were exactly that).
  const Leaf = useMemo(
    () =>
      function DirectiveLeafHost({ streaming: live }: { streaming: boolean }) {
        return <>{render({ attrs: parsed.attrs, source: parsed.source, streaming: live })}</>
      },
    [render, parsed]
  )

  return (
    <ContribBoundary id={contribution.id} variant="chip">
      <Leaf streaming={streaming} />
    </ContribBoundary>
  )
}

export const TranscriptDirectiveLeaf: FC<{ text: string; streaming?: boolean }> = ({ text, streaming }) => {
  const contributions = useContributions(TRANSCRIPT_DIRECTIVE_AREA)
  const parsedList = useMemo(() => parseTranscriptDirectiveList(text), [text])

  const entries = useMemo(() => {
    if (!parsedList) {
      return []
    }

    return parsedList.flatMap(parsed => {
      const match = claimFor(contributions, parsed.name)

      return match ? [{ key: `${match.id}:${parsed.source}`, match, parsed }] : []
    })
  }, [contributions, parsedList])

  if (entries.length === 0) {
    return null
  }

  return (
    <>
      {entries.map(entry => (
        <DirectiveEntry contribution={entry.match} key={entry.key} parsed={entry.parsed} streaming={streaming ?? false} />
      ))}
    </>
  )
}

/** True when the paragraph text will resolve to at least one registered
 *  directive — callers that must decide `<p>` vs slot before rendering use
 *  this with the same registry snapshot the leaf reads. */
export function useIsClaimedDirective(text: string | null): boolean {
  const contributions = useContributions(TRANSCRIPT_DIRECTIVE_AREA)
  const parsedList = text === null ? null : parseTranscriptDirectiveList(text)

  return parsedList !== null && parsedList.some(parsed => claimFor(contributions, parsed.name) !== undefined)
}
