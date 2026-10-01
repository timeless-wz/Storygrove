import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
const [root, raw] = process.argv.slice(2)
const command = JSON.parse(raw)
const evidence = path.join(root, 'evidence')
const launches = fs.readFileSync(path.join(evidence, 'launches.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${launches.at(-1).port}`)
try {
  const page = browser.contexts()[0].pages()[0]
  const locator = command.name ? page.getByRole(command.role ?? 'button', { name: command.name, exact: true }) : null
  if (command.action === 'click') await (command.index === undefined ? locator : locator.nth(command.index)).click()
  else if (command.action === 'fill') await locator.fill(command.file ? fs.readFileSync(command.file, 'utf8') : command.value)
  else if (command.action === 'select') await locator.selectOption(command.value)
  else if (command.action === 'screenshot') await page.screenshot({ path: path.join(evidence, command.file), fullPage: true })
  else if (command.action !== 'snapshot') throw new Error('Unknown action')
  const snapshot = await page.locator('body').ariaSnapshot()
  fs.appendFileSync(path.join(evidence, 'chain-ui.jsonl'), JSON.stringify({ at: new Date().toISOString(), command, snapshot }) + '\n')
  console.log(snapshot)
} finally { await browser.close() }
