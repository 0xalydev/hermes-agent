import { describe, expect, it } from 'vitest'

import {
  parseTranscriptDirective,
  parseTranscriptDirectiveList,
  segmentTranscriptDirectives
} from './transcript-directives'

describe('parseTranscriptDirective', () => {
  it('parses a bare directive with no attributes', () => {
    expect(parseTranscriptDirective('::tasks')).toEqual({ name: 'tasks', attrs: {}, source: '::tasks' })
  })

  it('parses double-quoted attributes', () => {
    expect(parseTranscriptDirective('::preview{file="demo.html"}')).toEqual({
      name: 'preview',
      attrs: { file: 'demo.html' },
      source: '::preview{file="demo.html"}'
    })
  })

  it('parses multiple attributes and accepts single quotes', () => {
    expect(parseTranscriptDirective(`::vis{file="a b.html" height='480'}`)?.attrs).toEqual({
      file: 'a b.html',
      height: '480'
    })
  })

  it('lowercases attribute keys but preserves values', () => {
    expect(parseTranscriptDirective('::vis{File="A.html"}')?.attrs).toEqual({ file: 'A.html' })
  })

  it('tolerates surrounding whitespace', () => {
    expect(parseTranscriptDirective('  ::tasks{id="1"}  ')?.name).toBe('tasks')
  })

  it('rejects prose containing a directive mid-text', () => {
    expect(parseTranscriptDirective('see ::preview{file="x.html"} above')).toBeNull()
  })

  it('rejects multi-line paragraphs', () => {
    expect(parseTranscriptDirective('::preview{file="x.html"}\nmore')).toBeNull()
  })

  it('rejects C++ scope-resolution lookalikes', () => {
    expect(parseTranscriptDirective('::std')).toEqual({ name: 'std', attrs: {}, source: '::std' })
    expect(parseTranscriptDirective('std::vector<int>')).toBeNull()
    expect(parseTranscriptDirective('::Vector')).toBeNull()
  })

  it('rejects unquoted attribute values', () => {
    expect(parseTranscriptDirective('::preview{file=demo.html}')?.attrs).toEqual({})
  })

  describe('parseTranscriptDirectiveList', () => {
    it('parses a single directive as a one-element list', () => {
      expect(parseTranscriptDirectiveList('::tasks{id="1"}')).toEqual([
        { name: 'tasks', attrs: { id: '1' }, source: '::tasks{id="1"}' }
      ])
    })

    it('parses two directives merged onto one line (the model-slop case)', () => {
      const parsed = parseTranscriptDirectiveList('::onboarding{step="name" value="karan"} ::onboarding{step="focus"}')

      expect(parsed).toHaveLength(2)
      expect(parsed?.[0].attrs).toEqual({ step: 'name', value: 'karan' })
      expect(parsed?.[1].attrs).toEqual({ step: 'focus' })
    })

    it('parses directives split across lines in one paragraph', () => {
      const parsed = parseTranscriptDirectiveList('::onboarding{step="look"}\n::onboarding{step="layout"}')

      expect(parsed?.map(p => p.attrs.step)).toEqual(['look', 'layout'])
    })

    it('rejects directives interleaved with prose', () => {
      expect(parseTranscriptDirectiveList('::onboarding{step="focus"} pick one ::onboarding{step="look"}')).toBeNull()
      expect(parseTranscriptDirectiveList('see ::onboarding{step="focus"}')).toBeNull()
      expect(parseTranscriptDirectiveList('::onboarding{step="focus"} trailing words')).toBeNull()
    })
  })

  describe('segmentTranscriptDirectives', () => {
    it('recovers a directive the model tacked onto the end of a sentence', () => {
      const segments = segmentTranscriptDirectives('Pick a color you like. ::onboarding{step="look"}')

      expect(segments?.map(s => (s.kind === 'prose' ? s.text.trim() : s.directive.attrs.step))).toEqual([
        'Pick a color you like.',
        'look'
      ])
    })

    it('keeps the order of prose and directives, wherever they fall', () => {
      const segments = segmentTranscriptDirectives('::onboarding{step="name" value="bk"} Good to meet you.')

      expect(segments?.map(s => s.kind)).toEqual(['directive', 'prose'])
    })

    it('leaves paragraphs with no directive alone', () => {
      expect(segmentTranscriptDirectives('just some text')).toBeNull()
      expect(segmentTranscriptDirectives('a ratio of 3::1')).toBeNull()
    })

    it('never reads a scope-resolution operator as a directive', () => {
      expect(segmentTranscriptDirectives('call std::vector::push_back here')).toBeNull()
    })
  })

  it('bounds pathological input instead of scanning it', () => {
    expect(parseTranscriptDirective(`::x{${'a="b" '.repeat(400)}}`)).toBeNull()
  })
})
