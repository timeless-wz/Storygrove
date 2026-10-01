import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
const [root, name, value] = process.argv.slice(2)
const evidence = path.join(root, 'evidence')
const launches = fs.readFileSync(path.join(evidence, 'launches.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${launches.at(-1).port}`)
try {
  const page = browser.contexts()[0].pages()[0]
  const field = page.getByRole('textbox', { name, exact: true })
  await field.fill(value)
  fs.appendFileSync(path.join(evidence, 'input-actions.jsonl'), JSON.stringify({ mode: launches.at(-1).kind, name, value, observedValue: await field.inputValue() }) + '\n')
  console.log(await page.locator('body').ariaSnapshot())
} finally { await browser.close() }
