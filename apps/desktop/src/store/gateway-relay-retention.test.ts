import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Bot-relay socket retention (#93594): the desktop bot relay RPCs every
// registered connection on its drain loop through requestGatewayForAgent's
// per-request lease. With nothing else holding the entry, the refcount hit 0
// after every tick and the pooled socket was disposed — a fresh WebSocket
// dial + teardown per registered connection every 4 seconds, flooding the
// gateway logs with connect/disconnect pairs. retainGatewayForRelay pins the
// route's pooled entry for the relay's active lifetime; releasing (stopBotRelay
// / plugin dispose) restores dispose-at-refcount-0. Local routes are exempt so
// the idle reaper can still reclaim spawned local backends.

const gatewayMocks = vi.hoisted(() => ({
  constructions: 0,
  connect: vi.fn(async (_wsUrl: string): Promise<void> => undefined),
  setConnection: vi.fn(),
  setGatewayState: vi.fn()
}))

vi.mock('@/hermes', () => ({
  setApiRequestConnection: vi.fn(),
  HermesGateway: class {
    connectionState = 'closed'
    constructor() {
      gatewayMocks.constructions += 1
    }
    connect = async (wsUrl: string): Promise<void> => {
      await gatewayMocks.connect(wsUrl)
      this.connectionState = 'open'
    }
    close = (): void => {
      this.connectionState = 'closed'
    }
    request = async (): Promise<unknown> => ({})
    onEvent = vi.fn(() => () => {})
    onState = vi.fn(() => () => {})
  }
}))
vi.mock('@/store/session', () => ({
  setConnection: gatewayMocks.setConnection,
  setGatewayState: gatewayMocks.setGatewayState
}))
vi.mock('@/store/notify-baseline', () => ({ markNativeNotifyBaseline: vi.fn() }))

const {
  closeSecondaryGateways,
  configureGatewayRegistry,
  pruneSecondaryGateways,
  requestGatewayForAgent,
  retainGatewayForRelay,
  SECONDARY_IDLE_LINGER_MS,
  setPrimaryGateway
} = await import('./gateway')

/** Step past the idle linger so deferred reclamation actually runs. */
async function advanceIdleLinger(): Promise<void> {
  await vi.advanceTimersByTimeAsync(SECONDARY_IDLE_LINGER_MS + 1)
}

const agentConn = {
  authMode: 'token',
  baseUrl: 'https://homelab.invalid',
  mode: 'remote',
  profile: 'research',
  token: 'fake-test-token',
  wsUrl: 'wss://homelab.invalid/api/ws?token=fake-test-token'
}

function installDesktop(): void {
  ;(window as unknown as { hermesDesktop: unknown }).hermesDesktop = {
    getConnection: vi.fn(async () => agentConn),
    getConnectionFor: vi.fn(async () => agentConn)
  }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  configureGatewayRegistry({ onEvent: vi.fn() })
  setPrimaryGateway({ connectionState: 'open' } as never, 'default')
  installDesktop()
  gatewayMocks.constructions = 0
})

afterEach(() => {
  closeSecondaryGateways()
  vi.clearAllMocks()
  vi.useRealTimers()
  delete (window as unknown as { hermesDesktop?: unknown }).hermesDesktop
})

describe('bot-relay gateway retention (#93594)', () => {
  it('without retention, ticks inside the idle linger still reuse one socket', async () => {
    // The churn this retainer was introduced for is now covered generically by
    // the idle linger: an unheld route stays warm between ticks, so a caller
    // that never learned to retain no longer redials per tick.
    for (let tick = 0; tick < 3; tick += 1) {
      await requestGatewayForAgent('homelab', 'research', 'bot_relay.outbox.drain', {})
    }

    expect(gatewayMocks.constructions).toBe(1)
    expect(gatewayMocks.connect).toHaveBeenCalledTimes(1)

    // Reclamation is deferred, not cancelled: once the ticks stop, the socket
    // goes.
    await advanceIdleLinger()
    await requestGatewayForAgent('homelab', 'research', 'bot_relay.outbox.drain', {})
    expect(gatewayMocks.constructions).toBe(2)
  })

  it('a retained relay route holds ONE persistent socket across multiple drain ticks', async () => {
    const release = retainGatewayForRelay('homelab', 'research')

    for (let tick = 0; tick < 5; tick += 1) {
      await requestGatewayForAgent('homelab', 'research', 'bot_relay.outbox.drain', {})
    }

    expect(gatewayMocks.constructions).toBe(1)
    expect(gatewayMocks.connect).toHaveBeenCalledTimes(1)

    release()
  })

  it('release (stopBotRelay) drops retention: the socket is disposed and the next tick redials', async () => {
    const release = retainGatewayForRelay('homelab', 'research')

    await requestGatewayForAgent('homelab', 'research', 'bot_relay.outbox.drain', {})
    expect(gatewayMocks.constructions).toBe(1)

    release()

    // Dropping the retainer is a deliberate teardown (stopBotRelay / plugin
    // dispose), so it still disposes on the spot rather than lingering — a
    // later drain tick constructs a fresh gateway again.
    await requestGatewayForAgent('homelab', 'research', 'bot_relay.outbox.drain', {})
    expect(gatewayMocks.constructions).toBe(2)
  })

  it('release is once-only and counted: double-release cannot strip a second retainer', async () => {
    const first = retainGatewayForRelay('homelab', 'research')
    const second = retainGatewayForRelay('homelab', 'research')

    first()
    first() // once-only: must not decrement again

    await requestGatewayForAgent('homelab', 'research', 'bot_relay.outbox.drain', {})
    await requestGatewayForAgent('homelab', 'research', 'bot_relay.outbox.drain', {})
    expect(gatewayMocks.constructions).toBe(1)

    second()
  })

  it('the live-work pruner does not evict a relay-retained route between ticks', async () => {
    const release = retainGatewayForRelay('homelab', 'research')

    await requestGatewayForAgent('homelab', 'research', 'bot_relay.outbox.drain', {})

    // Empty keep-set: everything idle is evictable — except the relay pin.
    pruneSecondaryGateways(new Set())

    await requestGatewayForAgent('homelab', 'research', 'bot_relay.outbox.drain', {})
    expect(gatewayMocks.constructions).toBe(1)

    release()

    // After release the same prune reclaims it.
    pruneSecondaryGateways(new Set())
    await requestGatewayForAgent('homelab', 'research', 'bot_relay.outbox.drain', {})
    expect(gatewayMocks.constructions).toBe(2)
  })

  it('local routes are exempt: retention is a no-op so the idle reaper can reclaim spawned backends', () => {
    // Pinning a local route would keep the secondaries touch-loop pinging its
    // Electron-spawned backend forever, defeating the idle reaper
    // (gateway.ts local-backend lifecycle). Both the null/legacy and explicit
    // `local` source ids must decline the pin.
    const releaseNull = retainGatewayForRelay(null, 'research')
    const releaseLocal = retainGatewayForRelay('local', 'research')

    // No entry was created or pinned — nothing dials, nothing retains.
    expect(gatewayMocks.constructions).toBe(0)

    releaseNull()
    releaseLocal()
  })
})
