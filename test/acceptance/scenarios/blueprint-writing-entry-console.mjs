import * as entry from './blueprint-writing-entry-followup.mjs'
import readline from 'node:readline'
import fs from 'node:fs'
import path from 'node:path'

console.log(await entry.start())
console.log(await entry.session.page.locator('body').ariaSnapshot())
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
for await (const line of rl) {
  try {
    const command = JSON.parse(line)
    const page = entry.session?.page
    if (command.action === 'click') await page.getByRole(command.role ?? 'button', { name: command.name, exact: true }).click()
    else if (command.action === 'fill') {
      const field = page.getByRole('textbox', { name: command.name, exact: true })
      const value = command.file ? fs.readFileSync(command.file, 'utf8') : command.value
      await field.fill(value)
      fs.appendFileSync(path.join(entry.evidence, 'input-actions.jsonl'), JSON.stringify({ name: command.name, value, observedValue: await field.inputValue() }) + '\n')
    } else if (command.action === 'response') fs.writeFileSync(path.join(entry.evidence, 'provider-response.txt'), JSON.stringify(command.value))
    else if (command.action === 'restart') { console.log(await entry.close()); console.log(await entry.open('v2')) }
    else if (command.action === 'snapshot') {
      console.log(await page.locator('body').ariaSnapshot())
      console.log('FIELDS', await page.locator('[role="dialog"] input, [role="dialog"] textarea').evaluateAll(elements => elements.map(el => ({ tag: el.tagName, id: el.id, placeholder: el.placeholder, value: el.value }))))
    } else if (command.action === 'screenshot') await page.screenshot({ path: path.join(entry.evidence, command.name), fullPage: true })
    else if (command.action === 'readback') console.log(JSON.stringify(entry.readback(), null, 2))
    else if (command.action === 'legacy') { console.log(await entry.close()); console.log(await entry.open('legacy')) }
    else if (command.action === 'finish') { console.log(await entry.finish()); rl.close(); break }
    else throw new Error('Unknown action')
    fs.writeFileSync(path.join(entry.evidence, 'diagnostics.json'), JSON.stringify(entry.diagnostics, null, 2))
    console.log('READY', entry.root)
  } catch (error) { console.error(error.stack); console.log('READY', entry.root) }
}
