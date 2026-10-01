import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { prepareIsolatedNodeRuntime } from '../lib/isolated-node-runtime.mjs'
const root = path.resolve(process.argv[2])
const evidence = path.join(root, 'evidence')
const read = name => JSON.parse(fs.readFileSync(path.join(evidence, name), 'utf8'))
const Database = createRequire(import.meta.url)('better-sqlite3')
const runtime = prepareIsolatedNodeRuntime()
const requests = read('provider-requests.json')
const results = []
for (const kind of ['v2', 'legacy']) {
  const before = read(`${kind}-before-writing.json`)
  const after = read(`${kind}-readback.json`)
  assert.equal(after.integrity, 'ok')
  assert.deepEqual(after.blueprints, before.blueprints, 'Writing must not overwrite author blueprint fields')
  assert.deepEqual(after.details, before.details, 'Writing must not change the v2 source')
  assert.deepEqual(after.characters, before.characters, 'Writing guidance must not pollute character fields')
  assert.equal(after.drafts.length, 1)
  assert.equal(after.drafts[0].chapter_number, 1)
  assert.equal(after.drafts[0].blueprint_chapter_number, 1)
  assert.equal(after.drafts[0].source, 'write')
  assert.equal(after.drafts[0].status, 'draft')
  const generation = requests.filter(req => req.mode === kind && Array.isArray(req.payload.messages) && req.payload.messages.some(message => message.content.includes('【本章篇幅合同】')))
  assert.equal(generation.length, 1)
  const prompt = generation[0].payload.messages.map(message => message.content).join('\n')
  assert.ok(prompt.includes(kind === 'v2' ? 'UI-V2-GUIDANCE-保留雨夜悬念，不改写人工细纲' : 'UI-LEGACY-GUIDANCE-只落实旧版必需事件'))
  if (kind === 'v2') {
    const detail = JSON.parse(before.details[0].detail_json)
    const scenes = detail.sections.flatMap(section => section.items).filter(item => item.kind === 'scene')
    assert.equal(scenes.length, 4)
    let previous = -1
    for (const scene of scenes) {
      const index = prompt.indexOf(scene.markdown.trim())
      assert.ok(index > previous, `Missing or reordered full scene: ${scene.title}`)
      previous = index
    }
    assert.ok(prompt.includes('用户目标 4200 字；可接受范围 3360–5040 字'))
    assert.ok(!prompt.includes('v2-LEGACY-KEYEVENT-MARKER'), 'Legacy keyEvents must not override the detailed outline')
    assert.equal(after.characters[0].abilities, 'ONLY-ABILITY-KEEP-UNCHANGED')
  } else {
    assert.equal(after.details.length, 0)
    assert.ok(prompt.includes('legacy-LEGACY-KEYEVENT-MARKER'))
    assert.ok(prompt.includes('用户目标 3000 字；可接受范围 2400–3600 字'))
    assert.equal(after.characters[0].abilities, 'LEGACY-ABILITY-KEEP-UNCHANGED')
  }
  const db = new Database(path.join(root, kind, '.vela', 'vela.db'), { readonly: true, nativeBinding: runtime.binding })
  let calls
  try { calls = db.prepare('SELECT purpose,success FROM llm_calls').all(); assert.equal(db.pragma('integrity_check', { simple: true }), 'ok') } finally { db.close() }
  // The current command uses chapter-draft for both formats; prove v2 from
  // the actual complete scene payload and budget, rather than a purpose label.
  assert.deepEqual(calls, [{ purpose: 'chapter-draft', success: 1 }])
  const log = JSON.parse(fs.readFileSync(path.join(root, kind, '.vela', 'chapter_creation_log.json'), 'utf8'))
  assert.equal(log.lastUsed.chapterNumber, 1)
  assert.equal(log.lastUsed.wordsTarget, kind === 'v2' ? 4200 : 3000)
  results.push({ mode: kind, status: 'PASS', chapterNumber: 1, wordCount: after.drafts[0].word_count, llmCalls: calls, authorFieldsUnchanged: true, charactersUnchanged: true })
}
const lifecycle = fs.readFileSync(path.join(evidence, 'lifecycle.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
assert.ok(lifecycle.every(item => item.result.ok && !item.result.forced))
fs.writeFileSync(path.join(evidence, 'verification.json'), JSON.stringify({ results, lifecycle, provider: 'deterministic-local-http', flags: ['no-sandbox', 'disable-gpu', 'in-process-gpu'] }, null, 2))
console.log(JSON.stringify(results, null, 2))
