import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { prepareIsolatedNodeRuntime } from '../lib/isolated-node-runtime.mjs'
const [directory, stage = 'after-exit'] = process.argv.slice(2)
const root = path.resolve(directory)
const evidence = path.join(root, 'evidence')
const Database = createRequire(import.meta.url)('better-sqlite3')
const db = new Database(path.join(root, 'v2/.vela/vela.db'), { readonly: true, nativeBinding: prepareIsolatedNodeRuntime().binding })
let data
try {
  data = {
    integrity: db.pragma('integrity_check', { simple: true }),
    blueprints: db.prepare('SELECT * FROM blueprints ORDER BY chapter_number').all(),
    details: db.prepare('SELECT * FROM blueprint_details').all(),
    drafts: db.prepare('SELECT d.*, c.body FROM drafts d JOIN contents c ON c.id=d.content_id ORDER BY d.id').all(),
    characters: db.prepare('SELECT * FROM characters').all(),
    reviews: db.prepare('SELECT r.*, c.body AS content FROM reviews r JOIN contents c ON c.id=r.content_id ORDER BY r.id').all(),
    canvasNodes: db.prepare('SELECT * FROM chapter_canvas_nodes').all(),
    llmCalls: db.prepare('SELECT purpose,success FROM llm_calls ORDER BY id').all(),
  }
} finally { db.close() }
fs.writeFileSync(path.join(evidence, `chain-${stage}.json`), JSON.stringify(data, null, 2))
const before = JSON.parse(fs.readFileSync(path.join(evidence, 'chain-before-writing.json'), 'utf8'))
assert.equal(data.integrity, 'ok')
for (const field of ['blueprints', 'details', 'characters']) assert.deepEqual(data[field], before[field], `${field} changed during writing/review`)
assert.equal(data.characters[0].abilities, 'CHAIN-ABILITY-KEEP-CLEAN')
assert.equal(data.blueprints[0].user_guidance, 'CHAIN-AUTHOR-GUIDANCE-保留人工细纲')
assert.equal(data.blueprints[0].notes, 'CHAIN-NOTES-保留人工章节记录')
assert.equal(data.drafts.length, 1)
assert.equal(data.drafts[0].chapter_number, 1)
assert.equal(data.drafts[0].blueprint_chapter_number, 1)
assert.equal(data.drafts[0].source, 'write')
assert.equal(data.reviews.length, 2)
assert.ok(data.reviews.every(review => review.base_draft_id === data.drafts[0].id && review.source_content === data.drafts[0].body))
const confirmed = JSON.parse(data.reviews[1].content)
assert.ok(JSON.stringify(confirmed).includes(data.details[0].content_hash))
assert.equal(data.canvasNodes.length, 4)
const detail = JSON.parse(data.details[0].detail_json)
const scenes = detail.sections.flatMap(section => section.items).filter(item => item.kind === 'scene')
assert.equal(scenes.length, 4)
const requests = JSON.parse(fs.readFileSync(path.join(evidence, 'provider-requests.json'), 'utf8'))
const generation = requests.filter(req => req.payload.messages?.some(message => message.content?.includes('【本章篇幅合同】')))
assert.equal(generation.length, 1)
const prompt = generation[0].payload.messages.map(message => message.content).join('\n')
assert.ok(prompt.includes('CHAIN-UI-WRITING-GUIDANCE-保留雨夜悬念'))
assert.ok(prompt.includes('3360') && prompt.includes('5040'))
let position = -1
for (const scene of scenes) {
  const next = prompt.indexOf(scene.markdown)
  assert.ok(next > position, 'All scene Markdown must arrive verbatim in order')
  position = next
}
assert.ok(!prompt.includes('CHAIN-STALE-KEYEVENTS'))
assert.ok(fs.existsSync(path.join(root, 'v2/.vela/prompts')))
if (stage === 'after-restart') assert.deepEqual(data, JSON.parse(fs.readFileSync(path.join(evidence, 'chain-after-exit.json'), 'utf8')), 'Restart changed persisted data')
console.log(JSON.stringify({ stage, status: 'PASS', chapter: 1, draftUnits: data.drafts[0].word_count, scenes: scenes.length, reviews: data.reviews.length, llmCalls: data.llmCalls }))
