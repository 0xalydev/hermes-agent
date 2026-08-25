#!/usr/bin/env node
/**
 * Run the guided first-run flow against a throwaway install.
 *
 *   npm run dev:fresh          (from apps/desktop)
 *
 * Onboarding happens once per install and writes as it goes — profiles
 * (`hermes-setup`, then the task bot), Electron latches, connection state. So
 * testing it needs a sandbox, and it needs all three of these or it silently
 * does the wrong thing:
 *
 *   HOME                          profiles are HOME-anchored by design
 *                                 (`_get_profiles_root`), so this is what keeps
 *                                 minted bots out of your real ~/.hermes
 *   HERMES_HOME                   must be explicit — the user-data override
 *                                 alone relocates it to an EMPTY dir, and an
 *                                 empty home means the first-run installer
 *                                 instead of the flow (looks like a hang)
 *   HERMES_DESKTOP_USER_DATA_DIR  Electron ignores HOME for userData on macOS,
 *                                 so without it the onboarding latches in your
 *                                 real profile suppress the whole thing
 *
 * Credentials are copied from your real ~/.hermes: the flow needs a working
 * model, not a working install.
 *
 * The sandbox is wiped every run — a second run of a once-per-install flow
 * tests nothing. Pass --keep to resume one (e.g. to inspect what it wrote).
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const DESKTOP_ROOT = path.resolve(import.meta.dirname, '..')
const SANDBOX = path.join(os.tmpdir(), 'hermes-dev-fresh')

// dev:electron waits on this exact port, and vite quietly increments past a
// busy one — which strands the launch instead of failing it.
const RENDERER_PORT = 5174

// Enough of a real install to reach a model; everything else is born fresh.
const SEED_FILES = ['.env', 'config.yaml', 'auth.json']

function assertPortFree(port) {
  return new Promise((resolve, reject) => {
    const probe = net
      .createServer()
      .once('error', () =>
        reject(
          new Error(
            `Port ${port} is busy — another dev renderer is running.\n` +
              'Electron waits on that exact port, so this run would hang. Stop the other one first.'
          )
        )
      )
      .once('listening', () => probe.close(() => resolve()))
      .listen(port, '127.0.0.1')
  })
}

function stageSandbox({ keep }) {
  const hermesHome = path.join(SANDBOX, '.hermes')
  const userDataDir = path.join(SANDBOX, 'electron-user-data')

  if (!keep) {
    fs.rmSync(SANDBOX, { force: true, recursive: true })
  }

  fs.mkdirSync(hermesHome, { recursive: true })
  fs.mkdirSync(userDataDir, { recursive: true })

  // os.homedir() still reads the REAL home — nothing has been overridden yet.
  const source = path.join(os.homedir(), '.hermes')
  const copied = SEED_FILES.filter(name => {
    const from = path.join(source, name)

    if (!fs.existsSync(from)) {
      return false
    }

    fs.copyFileSync(from, path.join(hermesHome, name))

    return true
  })

  if (copied.length === 0) {
    throw new Error(
      `Nothing to seed from ${source} — no .env, config.yaml or auth.json.\n` +
        'The guided flow needs a working model. Configure Hermes normally first.'
    )
  }

  return { copied, hermesHome, userDataDir }
}

async function main() {
  const keep = process.argv.includes('--keep')

  await assertPortFree(RENDERER_PORT)

  const { copied, hermesHome, userDataDir } = stageSandbox({ keep })

  console.log(`Fresh guided run — sandbox at ${SANDBOX}${keep ? ' (kept)' : ''}`)
  console.log(`  seeded: ${copied.join(', ')}`)
  console.log('')
  console.log('  Watch for: cinematic → guided chat → name, color, connectors,')
  console.log('  layout → the fork → the handoff card asking bot vs session.')
  console.log(`  Elite layout leads with session, Basic with bot.`)
  console.log('')
  console.log(`  Setup's check-in cron: HOME=${SANDBOX} hermes -p hermes-setup cron list`)
  console.log('')

  const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev:chat'], {
    cwd: DESKTOP_ROOT,
    env: {
      ...process.env,
      HERMES_DESKTOP_USER_DATA_DIR: userDataDir,
      HERMES_HOME: hermesHome,
      HOME: SANDBOX
    },
    stdio: 'inherit'
  })

  child.on('exit', code => process.exit(code ?? 0))
}

main().catch(error => {
  console.error(error.message)
  process.exit(1)
})
