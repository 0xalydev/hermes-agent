/**
 * First-screen plugin source — the DESIGNED artifact renderer.
 *
 * This string is written to `<desktop-plugins>/first-screen/plugin.js` at
 * onboarding handoff. It renders screen.json as a real interface, not a list
 * of prompt buttons:
 *
 *  - dashboard → a command-center: masthead, indexed live-feed items,
 *    a first-move checklist, a voice panel — every element clickable.
 *  - document  → a typeset daily-brief issue: dateline, lede, sectioned
 *    stories, delivery panel.
 *  - app       → a working tool: input area, transform action, IN/OUT
 *    example pair.
 *
 * Interaction contract (the self-modifying-app demo):
 *  - Clicking any content element sends a *scoped* prompt into the active
 *    chat (host.submitPrompt) — headline → "tell me more", step → "walk me
 *    through this".
 *  - The masthead's "regenerate" instructs the agent to REWRITE screen.json
 *    in place (the file's absolute path rides inside the JSON), and the
 *    watcher repaints — the pane the user is looking at rebuilds itself.
 *
 * Rendering rules: plain ESM, no JSX (runtime loader restriction), CSS in an
 * injected <style> tag, app theme vars only, no continuously-repainting
 * animations (transitions on state changes only).
 */

export const FIRST_SCREEN_PLUGIN_JS = `/** first-screen — the interface Hermes built at first setup.
 *
 *  screen.json in this folder IS this pane: edit it (or ask Hermes to) and
 *  it repaints on save. Plain DOM (no JSX) so the runtime loader can import
 *  the file as-is.
 */

import React, { useEffect, useState } from 'react'

import { host } from '@hermes/plugin-sdk'

const h = React.createElement

const CSS = [
  '.fsx{--mono:ui-monospace,SFMono-Regular,Menlo,monospace;display:flex;flex-direction:column;height:100%;overflow-y:auto;padding:0 16px 14px;color:var(--foreground);font-size:12.5px;line-height:1.5}',
  '.fsx *{box-sizing:border-box}',
  '.fsx-kicker{color:var(--muted-foreground);font-family:var(--mono);font-size:9.5px;letter-spacing:.14em;margin-top:14px;text-transform:uppercase}',
  '.fsx-title{font-size:21px;font-weight:650;letter-spacing:-.02em;line-height:1.15;margin-top:3px}',
  '.fsx-dateline{align-items:baseline;border-bottom:1px solid var(--border);color:var(--muted-foreground);display:flex;font-family:var(--mono);font-size:10px;gap:10px;justify-content:space-between;margin-top:10px;padding-bottom:8px}',
  '.fsx-regen{background:none;border:0;color:var(--muted-foreground);cursor:pointer;font-family:var(--mono);font-size:10px;letter-spacing:.06em;padding:0;transition:color 120ms ease}',
  '.fsx-regen:hover{color:var(--accent)}',
  '.fsx-sec{background:color-mix(in srgb, var(--card) 72%, transparent);border:1px solid var(--border);border-radius:10px;margin-top:10px;overflow:hidden}',
  '.fsx-sechead{align-items:center;background:color-mix(in srgb, var(--card) 55%, transparent);border-bottom:1px solid color-mix(in srgb, var(--border) 70%, transparent);display:flex;gap:8px;padding:8px 12px}',
  '.fsx-dot{border-radius:999px;flex:none;height:6px;width:6px;background:var(--accent)}',
  '.fsx-seclabel{color:var(--foreground);flex:1;font-size:12px;font-weight:600;letter-spacing:-.01em;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.fsx-kindtag{border:1px solid color-mix(in srgb, var(--muted-foreground) 30%, transparent);border-radius:4px;color:var(--muted-foreground);flex:none;font-family:var(--mono);font-size:8.5px;letter-spacing:.1em;padding:1px 5px;text-transform:uppercase}',
  '.fsx-secrun{align-items:center;background:var(--primary);border:0;border-radius:999px;color:var(--primary-foreground);cursor:pointer;display:inline-flex;flex:none;font-size:10px;font-weight:600;gap:3px;letter-spacing:.02em;padding:3px 10px;transition:transform 120ms ease,box-shadow 120ms ease}',
  '.fsx-secrun:hover{box-shadow:0 2px 6px rgba(0,0,0,.3);transform:translateY(-1px)}',
  '.fsx-secbody{padding:4px 12px 10px}',
  '.fsx-item{border-bottom:1px solid color-mix(in srgb, var(--border) 45%, transparent);cursor:pointer;display:flex;gap:10px;padding:9px 0;transition:background 120ms ease}',
  '.fsx-item:last-child{border-bottom:0}',
  '.fsx-item:hover{background:color-mix(in srgb, var(--accent) 10%, transparent)}',
  '.fsx-srcchip{background:color-mix(in srgb, var(--muted-foreground) 12%, transparent);border-radius:4px;color:var(--muted-foreground);flex:none;font-family:var(--mono);font-size:9px;padding:1px 6px}',
  '.fsx-idx{color:var(--accent);flex:none;font-family:var(--mono);font-size:10px;padding-top:2px}',
  '.fsx-itembody{display:flex;flex-direction:column;gap:3px;min-width:0}',
  '.fsx-line{font-weight:500}',
  '.fsx-meta{color:var(--muted-foreground);font-family:var(--mono);font-size:10px}',
  '.fsx-meta b{color:var(--muted-foreground);font-weight:500}',
  '.fsx-open{color:var(--accent);font-family:var(--mono);font-size:10px;opacity:0;transition:opacity 120ms ease}',
  '.fsx-item:hover .fsx-open{opacity:1}',
  '.fsx-lede{border-left:2px solid var(--accent);font-size:13.5px;font-style:italic;line-height:1.55;margin:10px 0 2px;padding:2px 0 2px 12px}',
  '.fsx-steps{display:flex;flex-direction:column;margin-top:2px}',
  '.fsx-step{align-items:baseline;border-bottom:1px solid color-mix(in srgb, var(--border) 55%, transparent);cursor:pointer;display:flex;gap:10px;padding:8px 0;transition:background 120ms ease}',
  '.fsx-step:last-child{border-bottom:0}',
  '.fsx-step:hover{background:color-mix(in srgb, var(--accent) 10%, transparent)}',
  '.fsx-mark{border:1px solid var(--muted-foreground);flex:none;height:9px;position:relative;top:1px;width:9px}',
  '.fsx-page{background:color-mix(in srgb, var(--card) 60%, transparent);border:1px solid var(--border);font-family:var(--mono);font-size:11px;line-height:1.7;margin-top:8px;padding:12px 14px;white-space:pre-wrap}',
  '.fsx-slot{color:var(--accent)}',
  '.fsx-io{display:flex;flex-direction:column;gap:8px;margin-top:8px}',
  '.fsx-iolabel{color:var(--muted-foreground);font-family:var(--mono);font-size:9.5px;letter-spacing:.14em}',
  '.fsx-iobox{background:color-mix(in srgb, var(--card) 60%, transparent);border:1px solid var(--border);font-family:var(--mono);font-size:11px;line-height:1.6;padding:10px 12px;white-space:pre-wrap}',
  '.fsx-input{background:color-mix(in srgb, var(--card) 60%, transparent);border:1px solid var(--border);color:var(--foreground);font-family:var(--mono);font-size:11.5px;line-height:1.6;min-height:64px;padding:10px 12px;resize:vertical;width:100%}',
  '.fsx-input:focus{border-color:var(--accent);outline:none}',
  '.fsx-go{background:var(--primary);border:0;color:var(--primary-foreground);cursor:pointer;font-family:var(--mono);font-size:10.5px;letter-spacing:.08em;margin-top:8px;padding:7px 14px;text-transform:uppercase;transition:opacity 120ms ease}',
  '.fsx-go:hover{opacity:.85}',
  '.fsx-pending{color:var(--muted-foreground);font-style:italic;padding:10px 0}',
  '@keyframes fsx-shimmer{0%{background-position:-200px 0}100%{background-position:200px 0}}',
  '.fsx-fill{display:flex;flex-direction:column;gap:7px;padding:10px 0}',
  '.fsx-fillbar{animation:fsx-shimmer 1.4s linear infinite;background:linear-gradient(90deg, color-mix(in srgb, var(--muted-foreground) 12%, transparent) 25%, color-mix(in srgb, var(--muted-foreground) 26%, transparent) 50%, color-mix(in srgb, var(--muted-foreground) 12%, transparent) 75%);background-size:200px 100%;border-radius:4px;height:9px}',
  '.fsx-fillnote{align-items:center;color:var(--muted-foreground);display:flex;font-family:var(--mono);font-size:9.5px;gap:6px;letter-spacing:.06em;text-transform:uppercase}',
  '@keyframes fsx-spin{to{transform:rotate(360deg)}}',
  '.fsx-spinner{animation:fsx-spin .9s linear infinite;border:1.5px solid color-mix(in srgb, var(--muted-foreground) 30%, transparent);border-radius:999px;border-top-color:var(--accent);flex:none;height:10px;width:10px}',
  '.fsx-secrun[disabled]{cursor:default;opacity:.35;pointer-events:none}',
  '.fsx-sketchrow{align-items:center;border:1px dashed color-mix(in srgb, var(--muted-foreground) 40%, transparent);display:flex;gap:10px;margin-top:8px;min-height:44px;padding:10px 12px;transition:border-color 400ms ease}',
  '.fsx-sketchlabel{color:var(--muted-foreground);font-family:var(--mono);font-size:11px;letter-spacing:.04em}',
  '.fsx-sketchbars{display:flex;flex:1;flex-direction:column;gap:4px}',
  '.fsx-sketchbar{background:color-mix(in srgb, var(--muted-foreground) 18%, transparent);height:6px}',
  '.fsx-stagecap{color:var(--accent);font-family:var(--mono);font-size:10px;letter-spacing:.1em;margin-top:14px;text-transform:uppercase}',
  '.fsx-proprow{border-bottom:1px solid color-mix(in srgb, var(--border) 55%, transparent);display:flex;flex-direction:column;gap:3px;padding:9px 0}',
  '.fsx-proprow:last-child{border-bottom:0}',
  '.fsx-propkind{color:var(--accent);font-family:var(--mono);font-size:9.5px;letter-spacing:.12em;text-transform:uppercase}',
  '.fsx-proplabel{font-size:13px;font-weight:550}',
  '.fsx-rule{border:0;border-top:1px solid var(--border);margin:0}',
  '.fsx-foot{color:var(--muted-foreground);font-family:var(--mono);font-size:9.5px;line-height:1.6;margin-top:auto;padding-top:18px}'
].join('')

/* Send a prompt through the active chat; toast when no surface owns it. */
function send(prompt) {
  const ok = typeof host.submitPrompt === 'function' && host.submitPrompt(prompt)
  if (!ok) host.notify({ kind: 'info', message: 'Open a chat first. The buttons here send prompts into it.' })
}

function fmtDate() {
  try {
    return new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  } catch (e) {
    return ''
  }
}

/* One clickable content row: index, line, source/tag meta, hover affordance. */
function FeedItem(props) {
  const it = props.item
  return h(
    'div',
    { className: 'fsx-item', onClick: () => send('Tell me more about this, briefly: "' + it.line + '"' + (it.source ? ' (' + it.source + ')' : '')) },
    h('span', { className: 'fsx-idx' }, String(props.n).padStart(2, '0')),
    h(
      'div',
      { className: 'fsx-itembody' },
      h('span', { className: 'fsx-line' }, it.line),
      h(
        'span',
        { className: 'fsx-meta' },
        it.source ? h('span', { className: 'fsx-srcchip' }, it.source) : null,
        it.tag ? h('span', { className: 'fsx-srcchip' }, it.tag) : null,
        h('span', { className: 'fsx-open' }, '\\u2192 open in chat')
      )
    )
  )
}

function Steps(props) {
  return h(
    'div',
    { className: 'fsx-steps' },
    (props.steps || []).map((s, i) =>
      h(
        'div',
        { className: 'fsx-step', key: i, onClick: () => send('Walk me through this step now: ' + s) },
        h('span', { className: 'fsx-mark' }),
        h('span', null, s)
      )
    )
  )
}

/* Draft skeleton with [slots] highlighted. */
function Page(props) {
  const parts = String(props.text || '').split(/(\\[[^\\]]+\\])/g)
  return h(
    'div',
    { className: 'fsx-page' },
    parts.map((p, i) => (p.startsWith('[') ? h('span', { className: 'fsx-slot', key: i }, p) : p))
  )
}

function ToolPanel(props) {
  const [value, setValue] = useState('')
  const c = props.content || {}
  const ex = c.example
  return h(
    'div',
    null,
    h('textarea', {
      className: 'fsx-input',
      onChange: e => setValue(e.target.value),
      placeholder: ex && ex.input ? 'e.g. ' + ex.input : 'Paste raw material here…',
      value
    }),
    h('button', { className: 'fsx-go', onClick: () => send(props.prompt + '\\n\\nInput:\\n' + (value || (ex && ex.input) || '')), type: 'button' }, 'Transform'),
    ex
      ? h(
          'div',
          { className: 'fsx-io' },
          h('div', null, h('div', { className: 'fsx-iolabel' }, 'IN'), h('div', { className: 'fsx-iobox' }, ex.input)),
          h('div', null, h('div', { className: 'fsx-iolabel' }, 'OUT'), h('div', { className: 'fsx-iobox' }, ex.output))
        )
      : null
  )
}

function Section(props) {
  return h(
    'div',
    { className: 'fsx-sec' },
    h(
      'div',
      { className: 'fsx-sechead' },
      h('span', { className: 'fsx-dot' }),
      h('span', { className: 'fsx-seclabel' }, props.label),
      props.kind ? h('span', { className: 'fsx-kindtag' }, props.kind) : null,
      h('button', { className: 'fsx-secrun', disabled: props.busy || undefined, onClick: props.onRun, type: 'button' }, props.busy ? 'Writing\\u2026' : (props.runLabel || 'Run'), props.busy ? null : ' \\u25B8')
    ),
    h('div', { className: 'fsx-secbody' }, props.children)
  )
}

function blockBody(block, freshPending) {
  const c = block.content
  if (!c) {
    if (freshPending) {
      // Live shimmer: unmistakably in progress, never a static sentence.
      return h(
        'div',
        { className: 'fsx-fill' },
        h('div', { className: 'fsx-fillnote' }, h('span', { className: 'fsx-spinner' }), 'writing'),
        h('div', { className: 'fsx-fillbar', style: { width: '86%' } }),
        h('div', { className: 'fsx-fillbar', style: { width: '64%' } }),
        h('div', { className: 'fsx-fillbar', style: { width: '73%' } })
      )
    }
    return h('div', { className: 'fsx-pending' }, 'Press Run and Hermes fills this in.')
  }
  if (c.kind === 'feed' && Array.isArray(c.items) && c.items.length) {
    const lede = c.lede
    return h(
      'div',
      null,
      lede ? h('div', { className: 'fsx-lede' }, lede) : null,
      c.items.map((it, i) => h(FeedItem, { item: it, key: i, n: i + 1 }))
    )
  }
  if (c.kind === 'action' && Array.isArray(c.steps) && c.steps.length) return h(Steps, { steps: c.steps })
  if (c.kind === 'draft' && c.skeleton) return h(Page, { text: c.skeleton })
  if (c.kind === 'tool' && c.example) return null // tool renders its own panel
  return null
}

export default {
  id: 'first-screen',
  name: 'First Screen',
  description: 'The interface Hermes built at first setup — a live, editable pane.',
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

      const blocks = (config && config.blocks) || []
      const stage = (config && config.stage) || 'final'
      const populated = Boolean(config && config.populatedAt)
      // In-progress: the builder stamps populating:true at build and clears it
      // when content lands (or the fill fails). Age heuristic stays as the
      // fallback for files written by older builds.
      const freshPending =
        !populated &&
        Boolean(
          (config && config.populating) ||
            (config && config.generatedAt && Date.now() - Date.parse(config.generatedAt) < 180000)
        )
      const filePath = (config && config.path) || '~/.hermes/desktop-plugins/first-screen/screen.json'

      const regen = () =>
        send(
          'Rebuild my first screen\\u2019s content in place: read ' +
            filePath +
            ' , re-run each block\\u2019s prompt fresh (search the web for feed blocks), and rewrite ONLY the content fields in that file \\u2014 keep the schema and prompts exactly as they are, update populatedAt. Reply in chat with one line when done.'
        )

      const kind = (config && config.kind) || 'dashboard'
      const kicker =
        kind === 'document' ? 'The daily brief \\u00b7 issue 01' : kind === 'app' ? 'Custom tool \\u00b7 built to order' : 'Command center'

      // ── Living-screen early stages ────────────────────────────────────────
      // sketch: wireframe rows under a "taking shape" caption — the pane is
      // ALIVE during the conversation, visibly unfinished on purpose.
      // proposals: the generated module list, titles real, content pending —
      // the moment the screen becomes THEIRS, mid-conversation.
      if (stage === 'sketch' || stage === 'proposals') {
        return h(
          'div',
          { className: 'fsx', 'data-tour': 'first-screen' },
          h('style', null, CSS),
          h('div', { className: 'fsx-kicker' }, 'Hermes is building this for ' + ((config && config.userName) || 'you')),
          h('div', { className: 'fsx-title' }, (config && config.title) || 'Your screen'),
          h(
            'div',
            { className: 'fsx-dateline' },
            h('span', null, (stage === 'sketch' ? 'Sketch' : 'Draft modules') + ' \\u00b7 ' + fmtDate()),
            h('span', { className: 'fsx-sketchlabel' }, 'live')
          ),
          h('div', { className: 'fsx-stagecap' }, stage === 'sketch' ? 'Taking shape as you talk' : 'Drafted from your answers'),
          stage === 'sketch'
            ? blocks.map((block, i) =>
                h(
                  'div',
                  { className: 'fsx-sketchrow', key: block.id || i },
                  h('span', { className: 'fsx-sketchlabel' }, block.label || '\\u2026'),
                  h(
                    'div',
                    { className: 'fsx-sketchbars' },
                    h('div', { className: 'fsx-sketchbar', style: { width: '72%' } }),
                    h('div', { className: 'fsx-sketchbar', style: { width: '46%' } })
                  )
                )
              )
            : blocks.map((block, i) =>
                h(
                  'div',
                  { className: 'fsx-proprow', key: block.id || i },
                  h('span', { className: 'fsx-propkind' }, block.kind || 'module'),
                  h('span', { className: 'fsx-proplabel' }, block.label)
                )
              ),
          h(
            'div',
            { className: 'fsx-foot' },
            stage === 'sketch'
              ? 'Keeps taking shape as you answer in the chat.'
              : 'Pick which ones to keep in the chat.'
          )
        )
      }

      return h(
        'div',
        { className: 'fsx', 'data-tour': 'first-screen' },
        h('style', null, CSS),
        h('div', { className: 'fsx-kicker' }, 'Hermes built this for ' + ((config && config.userName) || 'you')),
        h('div', { className: 'fsx-title' }, (config && config.title) || 'your first screen'),
        h(
          'div',
          { className: 'fsx-dateline' },
          h('span', null, kicker + ' \\u00b7 ' + fmtDate()),
          h('button', { className: 'fsx-regen', onClick: regen, title: 'Ask Hermes to rewrite this screen\\u2019s content in place', type: 'button' }, 'regenerate \\u21bb')
        ),
        blocks.map(block =>
          h(
            Section,
            {
              busy: freshPending && !block.content,
              key: block.id,
              kind: block.kind,
              label: block.label,
              onRun: () => send(block.prompt),
              runLabel: block.kind === 'feed' ? 'Refresh' : 'Run'
            },
            block.kind === 'tool' ? h(ToolPanel, { content: block.content, prompt: block.prompt }) : blockBody(block, freshPending)
          )
        ),
        h(
          'div',
          { className: 'fsx-foot' },
          'This screen is a file: ' + filePath + '. Edit it, or ask Hermes to, and the pane repaints.'
        )
      )
    }

    ctx.register({
      id: 'pane',
      area: 'panes',
      title: 'your first screen',
      data: { collapsible: true, dock: { pane: 'workspace', pos: 'right' }, minWidth: '340px', placement: 'right', width: '430px' },
      render: () => React.createElement(FirstScreenPane)
    })

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
