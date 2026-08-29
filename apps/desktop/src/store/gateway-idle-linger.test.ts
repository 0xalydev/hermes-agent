import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Secondary-socket idle linger.
//
// Every scoped RPC runs through requestGatewayForAgent's per-request lease, and
// disposing the instant the refcount hit 0 meant a caller that fires on a timer
// dialled a brand-new WebSocket every tick. Against a remote gateway that was
// ~33 connects a minute — each one a full handshake whose reconnect work lands
// on the renderer's main thread — and it showed up in the gateway log as an
// endless run of `ws accepted` / `messages=1` / `client_disconnect` triples.
// #93594 patched the shape once for the bot relay by handing it an explicit
// retainer; lingering generalises that so no caller has to know to retain.

const gatewayMocks = vi.hoisted(() => ({
  closes: 0,
  connects: 0,
  constructions: 0
}))

vi.mock('@/hermes', () => ({
  setApiRequestConnection: vi.fn(),
  HermesGateway: class {
    connectionState = 'closed'
    constructor() {
      gatewayMocks.constructions += 1
    }
    connect = async (): Promise<void> => {
      gatewayMocks.connects += 1
      this.connectionState = 'open'
    }
    close = (): void => {
      gatewayMocks.closes += 1
      this.connectionState = 'closed'
    }
    request = async (): Promise<unknown> => ({})
    onEvent = vi.fn(() => () => {})
    onState = vi.fn(() => () => {})
  }
}))
vi.mock('@/store/session', () => ({ setConnection: vi.fn(), setGatewayState: vi.fn() }))
vi.mock('@/store/notify-baseline', () => ({ markNativeNotifyBaseline: vi.fn() }))

const {
  closeSecondaryGateways,
  configureGatewayRegistry,
  pruneSecondaryGateways,
  requestGatewayForAgent,
  SECONDARY_IDLE_LINGER_MS,
  setPrimaryGateway
} = await import('./gateway')

const remoteConn = {
  authMode: 'token',
  baseUrl: 'https://homelab.invalid',
  mode: 'remote',
  profile: 'research',
  token: 'fake-test-token',
  wsUrl: 'wss://homelab.invalid/api/ws?token=fake-test-token'
}

/** One tick of a recurring backstop poll against a scoped route. */
const poll = () => requestGatewayForAgent('homelab', 'research', 'session.active_list', {})

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  ;(window as unknown as { hermesDesktop: unknown }).hermesDesktop = {
    getConnection: vi.fn(async () => remoteConn),
    getConnectionFor: vi.fn(async () => remoteConn)
  }
  configureGatewayRegistry({ onEvent: vi.fn() })
  setPrimaryGateway({ connectionState: 'open' } as never, 'default')
  gatewayMocks.closes = 0
  gatewayMocks.connects = 0
  gatewayMocks.constructions = 0
})

afterEach(() => {
  closeSecondaryGateways()
  vi.clearAllMocks()
  vi.useRealTimers()
  delete (window as unknown as { hermesDesktop?: unknown }).hermesDesktop
})

describe('secondary socket idle linger', () => {
  it('a recurring poll reuses one socket instead of redialling every tick', async () => {
    for (let tick = 0; tick < 6; tick += 1) {
      await poll()
      await vi.advanceTimersByTimeAsync(5_000)
    }

    expect(gatewayMocks.constructions).toBe(1)
    expect(gatewayMocks.connects).toBe(1)
    expect(gatewayMocks.closes).toBe(0)
  })

  it('reclaims the socket once the polling stops', async () => {
    await poll()
    expect(gatewayMocks.closes).toBe(0)

    await vi.advanceTimersByTimeAsync(SECONDARY_IDLE_LINGER_MS + 1)
    expect(gatewayMocks.closes).toBe(1)

    // And the route still works afterwards — reclamation, not a dead entry.
    await poll()
    expect(gatewayMocks.constructions).toBe(2)
  })

  it('each tick re-arms the window rather than letting the first one expire', async () => {
    // Ticks land inside the window but their total span exceeds it, so a
    // one-shot timer armed at the first release would have torn the socket
    // down underneath the run.
    for (let tick = 0; tick < 4; tick += 1) {
      await poll()
      await vi.advanceTimersByTimeAsync(SECONDARY_IDLE_LINGER_MS - 1_000)
    }

    expect(gatewayMocks.closes).toBe(0)
    expect(gatewayMocks.constructions).toBe(1)
  })

  it('deliberate reclamation still disposes on the spot', async () => {
    await poll()

    // The live-work pruner is not idle reclamation — it must not have to wait
    // out the window.
    pruneSecondaryGateways(new Set())
    expect(gatewayMocks.closes).toBe(1)

    // The pruner's dispose cancels the pending timer, so nothing fires later.
    await vi.advanceTimersByTimeAsync(SECONDARY_IDLE_LINGER_MS + 1)
    expect(gatewayMocks.closes).toBe(1)
  })
})
