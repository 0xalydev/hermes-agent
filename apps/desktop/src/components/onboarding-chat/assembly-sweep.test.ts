import { beforeEach, describe, expect, it, vi } from 'vitest'

import { allPaneIds, group, split } from '@/components/pane-shell/tree/model'
import {
  $dismissedPanes,
  $layoutTree,
  $paneVisible,
  adoptContributedPanes
} from '@/components/pane-shell/tree/store'
import { registry } from '@/contrib/registry'

import { assembleChatOnboarding } from './assembly'

vi.mock('@/store/first-screen-live', () => ({ redockLivePane: vi.fn() }))
vi.mock('@/store/zoom', () => ({ setZoomPercent: vi.fn() }))

const BOTS_PANE = 'hermes-bots:pane'

const disposers: (() => void)[] = []

function registerPane(id: string, data: Record<string, unknown>) {
  const dispose = registry.register({ area: 'panes', data, id, render: () => null, title: id })

  disposers.push(dispose)

  return dispose
}

beforeEach(() => {
  window.localStorage.clear()
  $dismissedPanes.set(new Set())

  for (const dispose of disposers.splice(0)) {
    dispose()
  }

  registerPane('workspace', { placement: 'main', uncloseable: true })
  registerPane('sessions', { collapsible: true, placement: 'left', width: '237px' })
  registerPane(BOTS_PANE, {
    collapsible: true,
    dock: { enforce: true, pane: 'sessions', pos: 'center' },
    placement: 'left',
    width: '260px'
  })
})

/** The Basic layout: sessions sidebar beside the conversation. */
const basic = () => split('row', [group(['sessions']), group(['workspace'])])

describe('onboarding assembly dismisses panes it never asked for', () => {
  // The bots plugin registers Cronjobs the moment its roster becomes VISIBLE,
  // and assembly fronts that roster — so the pane is a consequence of the
  // assembly, not a precondition of it. A sweep that ran before the fronting
  // saw a tree the pane could not be in yet, and Basic landed with an empty
  // Cronjobs column beside the chat (twice).
  it('drops a main pane that only registers once the bots roster is fronted', () => {
    let cronjobs: (() => void) | null = null

    // What the app root does (`watchContributedPanes`) — without it a late
    // registration never reaches the tree and the test proves nothing.
    const stopAdopting = registry.subscribe(adoptContributedPanes)

    const stop = $paneVisible(BOTS_PANE).listen(visible => {
      if (visible) {
        cronjobs ??= registerPane('hermes-bots:routines', {
          dock: { enforce: true, pane: 'workspace', pos: 'right' },
          placement: 'main',
          width: '250px'
        })
      }
    })

    try {
      assembleChatOnboarding('basic', basic())

      expect(cronjobs, 'the roster never fronted, so this asserts nothing').not.toBeNull()
      expect(allPaneIds($layoutTree.get()!)).not.toContain('hermes-bots:routines')
    } finally {
      stop()
      stopAdopting()
    }
  })

  it('keeps what the layout does declare', () => {
    assembleChatOnboarding('basic', basic())

    const placed = allPaneIds($layoutTree.get()!)

    expect(placed).toContain('workspace')
    expect(placed).toContain('sessions')
  })
})
