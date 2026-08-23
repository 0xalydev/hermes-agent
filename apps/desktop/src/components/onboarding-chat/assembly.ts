/**
 * The "magic lego" assembly for in-chat onboarding.
 *
 * The guided chat starts SOLO: just the chat pane in a small window — no
 * sidebar, no statusbar, nothing to explain. When the user picks a layout in
 * the ::onboarding card, the app assembles around the conversation:
 *
 * 1. The OS window grows OUTWARD by the MINIMUM each layout needs — the
 *    sidebar's width to the left, the terminal/rail minimums where a layout
 *    has them — animated (macOS setBounds animate), so the chat stays roughly
 *    where it was and the window ends as small as the layout allows.
 * 2. The new panes mount into the grown area with a staggered snap-in
 *    animation (`pane-lego-in`).
 * 3. The statusbar comes back; its height is pre-added to the bottom growth
 *    so its arrival doesn't lift the composer.
 */

import { atom } from 'nanostores'
import type { CSSProperties } from 'react'

import { allPaneIds, group, type LayoutNode } from '@/components/pane-shell/tree/model'
import { applyLayoutPreset } from '@/components/pane-shell/tree/presets'
import { $layoutTree, dismissTreePane, isCollapsePane } from '@/components/pane-shell/tree/store'
import { setSidebarOpen } from '@/store/layout'
import { setOnboardingSurfaceActive } from '@/store/onboarding-presence'
import { onboardingDevStage } from '@/store/onboarding-wizard'
import { $statusbarVisible } from '@/store/statusbar-prefs'

/** True from guide kickoff until the layout pick assembles the app. */
export const $chatOnboardingSolo = atom(false)

// Presence mirror — see onboarding-presence.ts (update toast stands down).
$chatOnboardingSolo.subscribe(solo => setOnboardingSurfaceActive('solo-chat', solo))

/** The guided-setup session's ids — stored AND runtime, because consumers key
 *  sessions differently (the thread list by stored id, the composer by runtime
 *  id). That one thread gets the onboarding transcript treatment and drops the
 *  composer's git strip; every other session is untouched. */
export const $chatOnboardingThreadIds = atom<readonly string[]>([])

/** Whether the layout card's pick happened. A STORE, not card-local state:
 *  applying the layout replaces the pane tree, which remounts the chat pane
 *  and the card with it — component state would forget the selection the
 *  moment it takes effect. */
export const $chatLayoutPicked = atom(false)

// The statusbar footer is h-5 (see statusbar-controls.tsx).
const STATUSBAR_PX = 20

let statusbarWasVisible = true

/** Strip the app to the conversation: chat-only layout, no statusbar. The
 *  window itself is born small when `dev:chat` bakes the stage (main.ts). */
export function startChatOnboardingSolo(): void {
  if ($chatOnboardingSolo.get()) {
    return
  }

  $chatOnboardingSolo.set(true)
  $chatLayoutPicked.set(false)
  // Both the statusbar pref and the layout persist — a dev run killed mid-flow
  // must not leave the bar hidden forever, so the dev:chat stage always
  // restores to visible (a real first run has it visible anyway).
  statusbarWasVisible = $statusbarVisible.get() || onboardingDevStage() === 'chat'
  $statusbarVisible.set(false)
  // One zone, strip pinned off. applyTree ADOPTS panes the preset doesn't
  // declare (sessions, terminal, …) into this group as tabs — with the strip
  // never shown and workspace active, they're simply invisible until the
  // assembled layout re-places them. That adoption is also why reactive
  // unhides (files on cwd-arrival) can't pop a zone open mid-flow: there is
  // no other zone to open.
  applyLayoutPreset('chat-solo', group(['workspace'], { tabStrip: 'never' }))
}

/** Minimal per-edge growth per layout — the least the window must gain for
 *  the new panes to be usable, NOT a chat-size-preserving projection (which
 *  balloons the window). Left = sessions sidebar; Elite adds its right rail
 *  and terminal row. Tune by feel. */
const LAYOUT_GROWTH: Record<string, { bottom?: number; left?: number; right?: number; top?: number }> = {
  'basic': { left: 220 },
  'terminal-deck': { bottom: 200, left: 220, right: 240 }
}

/** Assemble the picked layout around the conversation (see module header). */
export function assembleChatOnboarding(id: string, tree: LayoutNode): void {
  const growth = LAYOUT_GROWTH[id] ?? { left: 220 }

  window.hermesDesktop?.chatOnboarding?.grow({
    bottom: (growth.bottom ?? 0) + (statusbarWasVisible ? STATUSBAR_PX : 0),
    left: growth.left ?? 0,
    right: growth.right ?? 0,
    top: growth.top ?? 0
  })

  assembleStamp = Date.now()
  assembleOrder = 0
  applyLayoutPreset(id, tree)

  // Adoption keeps every pane a preset doesn't declare — as a TAB. Hide-style
  // panes (files, review) vanish with their stores, but tool panels (terminal,
  // logs) keep their tab visible even while collapsed, so Basic would land
  // with a Terminal tab beside the chat. Dismiss the undeclared tool panes:
  // the tab goes, and the toggle (⌃`) can still bring the pane back.
  const declared = new Set(allPaneIds(tree))

  for (const paneId of allPaneIds($layoutTree.get() ?? tree)) {
    if (!declared.has(paneId) && isCollapsePane(paneId)) {
      dismissTreePane(paneId)
    }
  }

  // The tree now HAS a sessions column, but the renderer drops the whole left
  // column when the persisted ⌘B state says closed ($sidebarOpen →
  // $collapsedTreeSides) — picking a layout with a sidebar is an explicit
  // intent to see it, so open the side through its store (truthful toggle),
  // the same way resetLayoutTree reopens bound sides.
  setSidebarOpen(true)

  if (statusbarWasVisible) {
    $statusbarVisible.set(true)
  }

  $chatOnboardingSolo.set(false)
}

// ── Pane entrance ("lego") ───────────────────────────────────────────────────
//
// Groups mounting within the window after an assembly snap in with a stagger.
// The chat group is exempt — it must not move. Read once at mount (not a
// subscription): entrance is a birth property, not live state.

const LEGO_WINDOW_MS = 1500
const LEGO_EASE = 'cubic-bezier(0.22, 1.2, 0.36, 1)'

let assembleStamp = 0
let assembleOrder = 0

export function paneEntranceStyle(panes: readonly string[]): CSSProperties | undefined {
  if (panes.includes('workspace') || Date.now() - assembleStamp > LEGO_WINDOW_MS) {
    return undefined
  }

  return { animation: `pane-lego-in 420ms ${LEGO_EASE} ${assembleOrder++ * 80}ms both` }
}
