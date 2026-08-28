/*
 * TEMPORARY Windows live-smoke driver for PR #96726 (Bot Mode rewrite).
 * Lives only on the wine2e/96726-botmode-smoke proof branch - never merges.
 *
 * Drives the INSTALLED-shape desktop (production renderer, real backend,
 * real HERMES_HOME) via Playwright _electron on windows-latest and runs the
 * Bot Mode smoke matrix:
 *   1. shell boots, sidebar renders
 *   2. BOTS tab -> roster row renders   <-- the #92843/#93262 Windows assert
 *   3. bot chat opens: empty state, main zone stays put
 *   4. create bot via dialog WITHOUT clone -> profile config.yaml seeded (DOA fix)
 *   5. optional live model turn (only when OPENROUTER_API_KEY provided)
 *   6. delete bot -> row gone, no resurrection, main zone alive
 * Screenshots into E2E_EVIDENCE_DIR at every step; exits non-zero on failure.
 */
'use strict'

const path = require('path')
const fs = require('fs')

const appsDesktop = path.resolve(__dirname)
const pw = require(require.resolve('@playwright/test', { paths: [appsDesktop] }))
const { _electron } = pw

const EVIDENCE = process.env.E2E_EVIDENCE_DIR || path.join(appsDesktop, 'win-smoke-evidence')
fs.mkdirSync(EVIDENCE, { recursive: true })

const HAS_KEY = process.env.E2E_HAS_KEY === '1'
let shotN = 0

function log(msg) {
  console.log(`[win-smoke] ${new Date().toISOString()} ${msg}`)
}

async function shot(page, name) {
  shotN += 1
  const file = path.join(EVIDENCE, `${String(shotN).padStart(2, '0')}-${name}.png`)
  try {
    await page.screenshot({ path: file })
    log(`screenshot ${file}`)
  } catch (e) {
    log(`screenshot failed (${name}): ${e.message}`)
  }
}

async function fail(page, name, msg) {
  await shot(page, `ERROR-${name}`)
  throw new Error(msg)
}

async function main() {
  const electronPath = require(require.resolve('electron', { paths: [appsDesktop] }))
  log(`electron: ${electronPath}`)
  log(`HERMES_HOME: ${process.env.HERMES_HOME}`)

  const app = await _electron.launch({
    executablePath: electronPath,
    // Launch by PACKAGE DIR (package.json "main"), not the bundled mjs file:
    // passing dist/electron-main.mjs directly makes app.getAppPath() resolve
    // to dist/, and the main process then looks for dist/dist/index.html.
    args: [appsDesktop],
    cwd: appsDesktop,
    env: { ...process.env },
    timeout: 120000
  })
  const page = await app.firstWindow({ timeout: 120000 })
  page.setDefaultTimeout(30000)
  log('window acquired')

  // 1. Shell boot: wait for the sidebar tabs (backend cold boot can be slow on CI)
  await page.waitForSelector('text=SESSIONS', { timeout: 300000 }).catch(async () => {
    await fail(page, 'boot', 'shell did not render SESSIONS tab within 5 min')
  })
  await shot(page, 'shell-booted')

  // Onboarding overlay: the boot progress card ("Starting Hermes...") morphs
  // into the provider picker once the backend is ready. The dismiss click is
  // LOAD-BEARING (covers the whole shell incl. the BOTS tab) - wait for
  // either the "later" button to appear or the overlay to vanish, up to 5 min.
  const overlayGone = async () => {
    const t = await page.evaluate(() => document.body.innerText)
    return !/Let's get you setup with Hermes Agent|Starting Hermes/i.test(t)
  }
  for (let i = 0; i < 60; i++) {
    if (await overlayGone()) break
    const later = page.getByRole('button', { name: /choose a provider later|skip/i }).first()
    if (await later.isVisible().catch(() => false)) {
      await later.click().catch(() => {})
      log('dismissed onboarding')
      await page.waitForTimeout(1500)
      break
    }
    await page.waitForTimeout(5000)
  }
  if (!(await overlayGone())) {
    // Non-button variants: try any visible dismiss/close affordance once
    const anyDismiss = page.getByRole('button', { name: /later|skip|close|not now/i }).first()
    if (await anyDismiss.isVisible().catch(() => false)) await anyDismiss.click().catch(() => {})
    await page.waitForTimeout(2000)
  }
  if (!(await overlayGone())) {
    await fail(page, 'onboarding', 'onboarding/boot overlay never cleared and no dismiss button appeared')
  }
  await shot(page, 'onboarding-cleared')

  // 2. BOTS tab -> roster renders (THE Windows-specific assert: #92843 / #93262)
  await page.getByRole('tab', { name: /bots/i }).first().click()
  await page.waitForTimeout(2000)
  const hermesRow = page.getByRole('button', { name: /Hermes/ }).first()
  if (!(await hermesRow.isVisible().catch(() => false))) {
    await fail(page, 'roster', 'BOTS roster did not render the default Hermes row (Windows roster-blank class #92843/#93262)')
  }
  await shot(page, 'bots-roster')
  log('ASSERT PASS: roster renders on Windows')

  // 3. Open the bot chat: empty state + main zone put
  await hermesRow.click()
  await page.waitForSelector('text=Say something to get started', { timeout: 60000 }).catch(async () => {
    await fail(page, 'botchat-open', 'bot chat empty state did not render after roster click')
  })
  await shot(page, 'botchat-empty-state')
  log('ASSERT PASS: bot chat opens with face/wordmark empty state, no jump to list')

  // 4. Create a bot WITHOUT clone via the + menu (keyboard nav - Radix menus)
  const plusBtn = page.getByRole('button', { name: 'New bot or group chat' }).first()
  await plusBtn.focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(800)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await page.waitForSelector('text=Create Bot', { timeout: 15000 }).catch(async () => {
    await fail(page, 'create-dialog', 'New Bot dialog did not open')
  })
  await shot(page, 'create-dialog')

  const nameInput = page.locator('[role=dialog] input').first()
  await nameInput.fill('winsmoke')
  await page.getByRole('button', { name: 'Create Bot' }).click()
  await page.waitForSelector('text=WINSMOKE', { timeout: 120000 }).catch(async () => {
    await fail(page, 'create', 'winsmoke bot chat did not open after Create Bot')
  })
  await shot(page, 'winsmoke-created')

  // DOA-fix assert on disk: profile config.yaml carries a model block
  const cfgPath = path.join(process.env.HERMES_HOME, 'profiles', 'winsmoke', 'config.yaml')
  let cfgOk = false
  for (let i = 0; i < 24; i++) {
    if (fs.existsSync(cfgPath) && /(^|\n)model:/.test(fs.readFileSync(cfgPath, 'utf8'))) { cfgOk = true; break }
    await page.waitForTimeout(5000)
  }
  if (!cfgOk) {
    await fail(page, 'doa-config', `no-clone profile missing model block: ${cfgPath}`)
  }
  log('ASSERT PASS: no-clone bot profile seeded with model block (DOA fix) on Windows')

  // 5. Live model turn (only when a key was provided to the runner)
  if (HAS_KEY) {
    const ta = page.locator('textarea').first()
    await ta.click()
    await ta.fill('Reply with exactly the word WINPONG and nothing else.')
    await page.getByRole('button', { name: /send/i }).first().click()
    await page.waitForSelector('text=WINPONG', { timeout: 180000 }).catch(async () => {
      await fail(page, 'turn', 'live model turn did not round-trip within 3 min')
    })
    await shot(page, 'live-turn')
    log('ASSERT PASS: live model turn round-trips on Windows')
  } else {
    log('SKIP: live turn (no OPENROUTER_API_KEY provided)')
  }

  // 6. Delete the bot: row gone, no resurrection, main zone alive
  const winsRow = page.getByRole('button', { name: /winsmoke/i }).first()
  await winsRow.click({ button: 'right' })
  await page.waitForTimeout(800)
  const items = await page.getByRole('menuitem').allTextContents()
  log(`context menu: ${items.join(', ')}`)
  const delIdx = items.findIndex(s => /delete/i.test(s))
  if (delIdx < 0) await fail(page, 'ctx-menu', 'no Delete item in roster context menu')
  for (let i = 0; i <= delIdx; i++) await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1000)
  const confirm = page.locator('[role=dialog] button, [role=alertdialog] button').filter({ hasText: /delete|remove|confirm/i }).first()
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
  await page.waitForTimeout(8000)
  if (await page.getByRole('button', { name: /winsmoke/i }).first().isVisible().catch(() => false)) {
    await fail(page, 'delete', 'winsmoke row still visible after delete')
  }
  // no-resurrection window: > 4 roster poll cycles
  await page.waitForTimeout(22000)
  if (await page.getByRole('button', { name: /winsmoke/i }).first().isVisible().catch(() => false)) {
    await fail(page, 'resurrect', 'deleted bot resurrected after poll cycles (stale-overlay class #94235)')
  }
  const bodyText = await page.evaluate(() => document.body.innerText)
  if (!bodyText.includes('Hermes') || bodyText.length < 100) {
    await fail(page, 'mainzone', 'main zone appears vanished after delete')
  }
  await shot(page, 'after-delete-no-resurrect')
  log('ASSERT PASS: delete clean, no resurrection, main zone alive')

  await app.close().catch(() => {})
  log('ALL WINDOWS SMOKE ASSERTS PASSED')
}

main().catch(err => {
  console.error(`[win-smoke] FAILED: ${err.stack || err}`)
  process.exit(1)
})
