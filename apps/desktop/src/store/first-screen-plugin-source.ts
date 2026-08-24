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
  /* ── Frame ── */
  '.fsx{--mono:ui-monospace,SFMono-Regular,Menlo,monospace;display:flex;flex-direction:column;height:100%;overflow-y:auto;padding:0 16px 16px;color:var(--dt-foreground);font-size:14px;line-height:1.55}',
  '.fsx > *{flex:none}',
  '.fsx *{box-sizing:border-box;min-width:0}',
  '.fsx-titlerow{align-items:center;display:flex;gap:10px;justify-content:space-between;margin-top:16px;padding-bottom:6px}',
  '.fsx-title{font-size:24px;font-weight:650;letter-spacing:-.02em;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  
  '.fsx-regen{align-items:center;background:transparent;border:1px solid var(--dt-border);border-radius:999px;color:var(--dt-muted-foreground);cursor:pointer;display:inline-flex;flex:none;font-family:var(--mono);font-size:11px;gap:4px;letter-spacing:.04em;padding:4px 12px;transition:color 120ms ease,border-color 120ms ease}',
  '.fsx-regen:hover{border-color:color-mix(in srgb, var(--dt-primary) 50%, var(--dt-border));color:var(--dt-foreground)}',

  /* ── Module card ── */
  '.fsx-sec{background:var(--dt-card);border:1px solid var(--dt-border);border-radius:12px;box-shadow:0 1px 2px rgba(0,0,0,.14);margin-top:10px;overflow:hidden}',
  '.fsx-sechead{align-items:center;display:flex;gap:9px;padding:12px 14px 9px}',
  '.fsx-dot{background:var(--dt-primary);border-radius:999px;flex:none;height:6px;width:6px}',
  '.fsx-seclabel{color:var(--dt-foreground);flex:1;font-size:15px;font-weight:600;letter-spacing:-.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.fsx-kindtag{background:color-mix(in srgb, var(--dt-muted-foreground) 10%, transparent);border-radius:4px;color:var(--dt-muted-foreground);flex:none;font-family:var(--mono);font-size:9.5px;letter-spacing:.1em;padding:2.5px 7px;text-transform:uppercase}',
  '.fsx-secrun{align-items:center;background:var(--dt-primary);border:0;border-radius:999px;box-shadow:0 1px 2px rgba(0,0,0,.22);color:var(--dt-primary-foreground);cursor:pointer;display:inline-flex;flex:none;font-size:12px;font-weight:600;gap:4px;letter-spacing:.02em;padding:5px 14px;transition:transform 120ms ease,box-shadow 120ms ease}',
  '.fsx-secrun:hover{box-shadow:0 2px 7px rgba(0,0,0,.3);transform:translateY(-1px)}',
  '.fsx-secrun[disabled]{cursor:default;opacity:.4;pointer-events:none}',
  '.fsx-secbody{padding:0 14px 13px}',

  /* ── Feed items: chip-indexed clickable rows ── */
  '.fsx-item{align-items:flex-start;border:1px solid transparent;border-radius:8px;cursor:pointer;display:flex;gap:9px;margin:0 -6px;padding:7px 6px;transition:background 120ms ease,border-color 120ms ease}',
  '.fsx-item:hover{background:color-mix(in srgb, var(--dt-primary) 7%, transparent);border-color:color-mix(in srgb, var(--dt-primary) 22%, transparent)}',
  '.fsx-idx{background:color-mix(in srgb, var(--dt-primary) 12%, transparent);border-radius:5px;color:var(--dt-primary);flex:none;font-family:var(--mono);font-size:10.5px;font-weight:600;line-height:1;margin-top:2px;padding:4px 6px}',
  '.fsx-itembody{display:flex;flex:1;flex-direction:column;gap:3px}',
  '.fsx-line{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:4;font-size:13.5px;font-weight:500;line-height:1.5;overflow:hidden}',
  '.fsx-meta{align-items:center;color:var(--dt-muted-foreground);display:flex;flex-wrap:wrap;font-family:var(--mono);font-size:11px;gap:6px}',
  '.fsx-srcchip{background:color-mix(in srgb, var(--dt-muted-foreground) 11%, transparent);border-radius:4px;color:var(--dt-muted-foreground);flex:none;font-family:var(--mono);font-size:10.5px;padding:2px 7px}',
  '.fsx-open{color:var(--dt-primary);font-family:var(--mono);font-size:11px;opacity:0;transition:opacity 120ms ease;white-space:nowrap}',
  '.fsx-item:hover .fsx-open{opacity:1}',
  '.fsx-lede{border-left:2px solid var(--dt-primary);color:var(--dt-muted-foreground);display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:4;font-size:13.5px;font-style:italic;line-height:1.55;margin:2px 0 9px;overflow:hidden;padding:1px 0 1px 11px}',

  /* ── Action steps: checklist rows ── */
  '.fsx-steps{display:flex;flex-direction:column;gap:2px;margin-top:2px}',
  '.fsx-step{align-items:flex-start;border:1px solid transparent;border-radius:8px;cursor:pointer;display:flex;gap:9px;margin:0 -6px;padding:7px 6px;transition:background 120ms ease,border-color 120ms ease}',
  '.fsx-step:hover{background:color-mix(in srgb, var(--dt-primary) 7%, transparent);border-color:color-mix(in srgb, var(--dt-primary) 22%, transparent)}',
  '.fsx-mark{border:1.5px solid color-mix(in srgb, var(--dt-muted-foreground) 55%, transparent);border-radius:4px;flex:none;height:13px;margin-top:4px;width:13px;transition:border-color 120ms ease}',
  '.fsx-step:hover .fsx-mark{border-color:var(--dt-primary)}',
  '.fsx-steptext{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;flex:1;font-size:13.5px;line-height:1.5;overflow:hidden}',
  '.fsx-stepgo{color:var(--dt-primary);font-family:var(--mono);font-size:11px;margin-top:2px;opacity:0;transition:opacity 120ms ease;white-space:nowrap}',
  '.fsx-step:hover .fsx-stepgo{opacity:1}',

  /* ── Draft skeleton page ── */
  '.fsx-page{background:color-mix(in srgb, var(--dt-background) 55%, var(--dt-card));border:1px solid var(--dt-border);border-radius:8px;font-family:var(--mono);font-size:12.5px;line-height:1.7;margin-top:4px;max-height:220px;overflow-y:auto;padding:11px 13px;white-space:pre-wrap}',
  '.fsx-slot{color:var(--dt-primary)}',

  /* ── Tool panel ── */
  '.fsx-io{display:flex;flex-direction:column;gap:8px;margin-top:8px}',
  '.fsx-iolabel{color:var(--dt-muted-foreground);font-family:var(--mono);font-size:10.5px;letter-spacing:.14em;margin-bottom:4px}',
  '.fsx-iobox{background:color-mix(in srgb, var(--dt-background) 55%, var(--dt-card));border:1px solid var(--dt-border);border-radius:8px;font-family:var(--mono);font-size:12px;line-height:1.6;max-height:150px;overflow-y:auto;padding:10px 12px;white-space:pre-wrap}',
  '.fsx-input{background:color-mix(in srgb, var(--dt-background) 55%, var(--dt-card));border:1px solid var(--dt-border);border-radius:8px;color:var(--dt-foreground);font-family:var(--mono);font-size:12.5px;line-height:1.6;min-height:64px;outline:none;padding:10px 12px;resize:vertical;transition:border-color 120ms ease;width:100%}',
  '.fsx-input:focus{border-color:color-mix(in srgb, var(--dt-primary) 60%, var(--dt-border))}',
  '.fsx-go{align-items:center;background:var(--dt-primary);border:0;border-radius:999px;box-shadow:0 1px 2px rgba(0,0,0,.22);color:var(--dt-primary-foreground);cursor:pointer;display:inline-flex;font-size:12px;font-weight:600;gap:4px;letter-spacing:.02em;margin-top:9px;padding:6px 16px;transition:transform 120ms ease,box-shadow 120ms ease}',
  '.fsx-go:hover{box-shadow:0 2px 7px rgba(0,0,0,.3);transform:translateY(-1px)}',

  /* ── Pending / writing states ── */
  '.fsx-pending{align-items:center;color:var(--dt-muted-foreground);display:flex;font-size:13px;font-style:italic;gap:7px;padding:8px 0 4px}',
  '@keyframes fsx-shimmer{0%{background-position:-200px 0}100%{background-position:200px 0}}',
  '.fsx-fill{display:flex;flex-direction:column;gap:7px;padding:8px 0 4px}',
  '.fsx-fillbar{animation:fsx-shimmer 1.2s linear infinite;background:linear-gradient(90deg, color-mix(in srgb, var(--dt-muted-foreground) 18%, transparent) 25%, color-mix(in srgb, var(--dt-primary) 40%, transparent) 50%, color-mix(in srgb, var(--dt-muted-foreground) 18%, transparent) 75%);background-size:200px 100%;border-radius:4px;height:9px}',
  '.fsx-fillnote{align-items:center;color:var(--dt-primary);display:flex;font-family:var(--mono);font-size:11px;gap:7px;letter-spacing:.08em;text-transform:uppercase}',
  '@keyframes fsx-spin{to{transform:rotate(360deg)}}',
  '.fsx-spinner{animation:fsx-spin .8s linear infinite;border:2px solid color-mix(in srgb, var(--dt-muted-foreground) 30%, transparent);border-radius:999px;border-top-color:var(--dt-primary);flex:none;height:12px;width:12px}',

  /* ── Sketch / proposals stages ── */
  '.fsx-sketchrow{align-items:center;border:1px dashed color-mix(in srgb, var(--dt-muted-foreground) 35%, transparent);border-radius:10px;display:flex;gap:10px;margin-top:8px;min-height:44px;padding:10px 12px}',
  '.fsx-sketchlabel{color:var(--dt-muted-foreground);font-family:var(--mono);font-size:12px;letter-spacing:.04em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.fsx-sketchbars{display:flex;flex:1;flex-direction:column;gap:4px}',
  '.fsx-sketchbar{animation:fsx-shimmer 1.6s linear infinite;background:linear-gradient(90deg, color-mix(in srgb, var(--dt-muted-foreground) 14%, transparent) 25%, color-mix(in srgb, var(--dt-muted-foreground) 26%, transparent) 50%, color-mix(in srgb, var(--dt-muted-foreground) 14%, transparent) 75%);background-size:200px 100%;border-radius:3px;height:6px}',
  '.fsx-stagecap{align-items:center;color:var(--dt-primary);display:flex;font-family:var(--mono);font-size:11px;gap:7px;letter-spacing:.1em;margin-top:14px;text-transform:uppercase}',
  '.fsx-proprow{background:var(--dt-card);border:1px solid var(--dt-border);border-radius:10px;display:flex;flex-direction:column;gap:2px;margin-top:8px;padding:9px 12px}',
  '.fsx-dropped{opacity:.38}',
  '.fsx-dropped .fsx-proplabel{text-decoration:line-through}',
  '.fsx-propkind{color:var(--dt-primary);font-family:var(--mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase}',
  '.fsx-proplabel{font-size:14px;font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',

  '.fsx-foot{display:none}'
].join('')

/* Send a prompt through the active chat; toast when no surface owns it. */
function send(prompt) {
  const ok = typeof host.submitPrompt === 'function' && host.submitPrompt(prompt)
  if (!ok) host.notify({ kind: 'info', message: 'Open a chat first. The buttons here send prompts into it.' })
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
        h('span', { className: 'fsx-steptext' }, s),
        h('span', { className: 'fsx-stepgo' }, 'start \\u2192')
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
        h('div', { className: 'fsx-fillnote' }, h('span', { className: 'fsx-spinner' }), 'writing yours now'),
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
      // In-progress: populating:true means the fill is STILL RUNNING — that
      // always wins (a partial write stamps populatedAt with content for only
      // SOME blocks; the rest must keep shimmering, never say "Press Run").
      // Age heuristic stays as the fallback for files from older builds.
      const freshPending = Boolean(
        (config && config.populating) ||
          (!populated && config && config.generatedAt && Date.now() - Date.parse(config.generatedAt) < 180000)
      )
      const filePath = (config && config.path) || '~/.hermes/desktop-plugins/first-screen/screen.json'

      const regen = () =>
        send(
          'Rebuild my first screen\\u2019s content in place: read ' +
            filePath +
            ' , re-run each block\\u2019s prompt fresh (search the web for feed blocks), and rewrite ONLY the content fields in that file \\u2014 keep the schema and prompts exactly as they are, update populatedAt. Reply in chat with one line when done.'
        )


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
          h('div', { className: 'fsx-titlerow' }, h('div', { className: 'fsx-title' }, (config && config.title) || 'Your Dashboard')),
          h('div', { className: 'fsx-stagecap' }, h('span', { className: 'fsx-spinner' }), stage === 'sketch' ? 'Taking shape as you talk' : 'Drafted from your answers'),
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
                  { className: 'fsx-proprow' + (block.dropped ? ' fsx-dropped' : ''), key: block.id || i },
                  h('span', { className: 'fsx-propkind' }, block.dropped ? 'dropped' : block.kind || 'module'),
                  h('span', { className: 'fsx-proplabel' }, block.label),
                  block.dropped ? null : blockBody(block, true)
                )
              ),
          null
        )
      }

      return h(
        'div',
        { className: 'fsx', 'data-tour': 'first-screen' },
        h('style', null, CSS),
        h(
          'div',
          { className: 'fsx-titlerow' },
          h('div', { className: 'fsx-title' }, (config && config.title) || 'Your Dashboard'),
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
        null
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
