import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { createHash } from 'node:crypto'
import { launchApp, quitViaUI, createIsolationEnv } from '../lib/electron-driver.mjs'
const root = path.resolve(process.argv[2])
const repoRoot = path.resolve(import.meta.dirname, '../../..')
const evidence = path.join(root, 'evidence')
const diagnostics = []
const artifacts = Object.fromEntries(['dist/index.html', 'dist-electron/main.js', 'dist-electron/preload.mjs'].map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(repoRoot, file))).digest('hex')]))
fs.writeFileSync(path.join(evidence, 'restart-artifacts.json'), JSON.stringify(artifacts, null, 2))
const session = await launchApp({ repoRoot, electronProfile: path.join(root, 'profile-v2'), diagnostics, env: createIsolationEnv({ globalHome: path.join(root, 'global-home'), projectPath: path.join(root, 'v2'), markerPath: path.join(root, 'restart-opened.json') }) })
const page = session.page
await page.locator('.writer-project-tree').first().waitFor({ timeout: 45000 })
console.log(await page.locator('body').ariaSnapshot())
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
for await (const line of rl) {
  try {
    const command = JSON.parse(line)
    if (command.action === 'click') await page.getByRole(command.role ?? 'button', { name: command.name, exact: true }).click()
    else if (command.action === 'snapshot') console.log(await page.locator('body').ariaSnapshot())
    else if (command.action === 'screenshot') await page.screenshot({ path: path.join(evidence, command.name), fullPage: true })
    else if (command.action === 'verify-assets') {
      const images = await page.locator('img.writer-brand-image').evaluateAll(elements => elements.map(el => ({ src: el.src, width: el.naturalWidth, complete: el.complete })))
      if (!images.length || images.some(image => !image.complete || image.width === 0)) throw new Error('Brand image did not load')
      console.log(images)
      fs.writeFileSync(path.join(evidence, 'restart-brand-image.json'), JSON.stringify(images, null, 2))
    } else if (command.action === 'finish') {
      const result = await quitViaUI(page, session)
      fs.appendFileSync(path.join(evidence, 'lifecycle.jsonl'), JSON.stringify({ mode: 'ordinary-restart-final-build', result }) + '\n')
      console.log(result)
      rl.close()
      break
    } else throw new Error('Unknown action')
    fs.appendFileSync(path.join(evidence, 'restart-ui.jsonl'), JSON.stringify({ at: new Date().toISOString(), command }) + '\n')
    fs.writeFileSync(path.join(evidence, 'restart-diagnostics.json'), JSON.stringify(diagnostics, null, 2))
    console.log('READY')
  } catch (error) { console.error(error.stack) }
}
fs.writeFileSync(path.join(evidence, 'restart-diagnostics.json'), JSON.stringify(diagnostics, null, 2))
