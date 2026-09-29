import { createHash } from 'node:crypto'

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const positiveInteger = value => Number.isSafeInteger(value) && value > 0

function assertChapterNumber(value) {
  if (!positiveInteger(value)) throw new Error('chapterNumber must be a positive integer')
}

function assertRevision(value) {
  if (value !== null && (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value))) {
    throw new Error('baseRevision must be the revision returned by the read tool, or null for a new blueprint')
  }
}

function blueprintRow(db, chapterNumber) {
  return db.prepare(`
    SELECT chapter_number, volume_id, title, role, purpose, key_events, characters,
           suspense_hook, user_guidance, notes, notes_updated_at, updated_at
    FROM blueprints WHERE chapter_number = ?
  `).get(chapterNumber) ?? null
}

export function readBlueprint(db, chapterNumber) {
  assertChapterNumber(chapterNumber)
  const row = blueprintRow(db, chapterNumber)
  if (!row) return { chapterNumber, blueprint: null, revision: null }
  return {
    chapterNumber,
    blueprint: {
      chapterNumber,
      volumeId: row.volume_id,
      title: row.title,
      role: row.role,
      purpose: row.purpose,
      keyEvents: row.key_events,
      characters: JSON.parse(row.characters),
      suspenseHook: row.suspense_hook,
      userGuidance: row.user_guidance,
      notes: row.notes,
      notesUpdatedAt: row.notes_updated_at,
    },
    revision: hash(row),
  }
}

function draftRow(db, draftId) {
  return db.prepare(`
    SELECT drafts.id, drafts.chapter_number, drafts.blueprint_chapter_number, drafts.version,
           drafts.status, drafts.source, drafts.word_count, drafts.content_id,
           drafts.updated_at, contents.body
    FROM drafts JOIN contents ON contents.id = drafts.content_id WHERE drafts.id = ?
  `).get(draftId) ?? null
}

export function readDraft(db, draftId) {
  if (!positiveInteger(draftId)) throw new Error('draftId must be a positive integer')
  const row = draftRow(db, draftId)
  if (!row) return { draftId, draft: null, revision: null }
  return {
    draftId,
    draft: {
      id: row.id,
      chapterNumber: row.chapter_number,
      blueprintChapterNumber: row.blueprint_chapter_number,
      version: row.version,
      status: row.status,
      source: row.source,
      wordCount: row.word_count,
      content: row.body,
    },
    revision: hash(row),
  }
}

export function validateBlueprintProposal(args) {
  assertChapterNumber(args.chapterNumber)
  assertRevision(args.baseRevision)
  const blueprint = args.blueprint
  if (!blueprint || typeof blueprint !== 'object' || Array.isArray(blueprint)) throw new Error('blueprint must be an object')
  if (blueprint.chapterNumber !== args.chapterNumber) throw new Error('blueprint chapterNumber mismatch')
  for (const field of ['title', 'role', 'purpose', 'keyEvents', 'suspenseHook', 'userGuidance', 'notes', 'notesUpdatedAt']) {
    if (typeof blueprint[field] !== 'string') throw new Error(`blueprint.${field} must be a string`)
  }
  if (blueprint.volumeId !== undefined && (typeof blueprint.volumeId !== 'string' || !blueprint.volumeId.trim())) {
    throw new Error('blueprint.volumeId must be a nonempty string')
  }
  if (!Array.isArray(blueprint.characters) || !blueprint.characters.every(value => typeof value === 'string')) {
    throw new Error('blueprint.characters must be a string array')
  }
  return { chapterNumber: args.chapterNumber, baseRevision: args.baseRevision, blueprint }
}

export function validateDraftProposal(args) {
  if (!positiveInteger(args.draftId)) throw new Error('draftId must be a positive integer')
  assertRevision(args.baseRevision)
  if (args.baseRevision === null) throw new Error('draft update requires an existing revision')
  if (typeof args.content !== 'string' || args.content.length > 500_000) throw new Error('content must be a string of at most 500000 characters')
  return { draftId: args.draftId, baseRevision: args.baseRevision, content: args.content }
}

// Keep the persisted word-count algorithm aligned with src/shared/draft-units.ts.
export function countDraftUnits(text) {
  const withoutHan = text.normalize('NFC').replace(/\p{Script=Han}/gu, ' ')
  const han = text.normalize('NFC').match(/\p{Script=Han}/gu)?.length ?? 0
  const words = withoutHan.match(/\p{L}[\p{L}\p{M}]*(?:['’]\p{L}[\p{L}\p{M}]*)*/gu)?.length ?? 0
  const other = [...withoutHan.replace(/\p{L}[\p{L}\p{M}]*(?:['’]\p{L}[\p{L}\p{M}]*)*/gu, '').replace(/[\s\p{P}\p{S}]/gu, '')].length
  return han + words + other
}

export function commitChapterProposal(db, proposal) {
  const args = JSON.parse(proposal.payload_json)
  if (proposal.proposal_type === 'propose_blueprint_update') {
    const input = validateBlueprintProposal(args)
    const current = readBlueprint(db, input.chapterNumber)
    if ((current.revision ?? 'new') !== proposal.base_revision || (input.baseRevision ?? 'new') !== proposal.base_revision) {
      throw new Error('蓝图已变化，请重新读取并提交提案')
    }
    const data = input.blueprint
    const volumeId = data.volumeId ?? current.blueprint?.volumeId ?? 'volume-1'
    if (!db.prepare('SELECT 1 FROM blueprint_volumes WHERE id = ?').get(volumeId)) throw new Error('指定的卷不存在')
    db.prepare(`
      INSERT INTO blueprints (chapter_number, volume_id, title, role, purpose, key_events,
        characters, suspense_hook, user_guidance, notes, notes_updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(chapter_number) DO UPDATE SET
        volume_id = excluded.volume_id, title = excluded.title, role = excluded.role,
        purpose = excluded.purpose, key_events = excluded.key_events,
        characters = excluded.characters, suspense_hook = excluded.suspense_hook,
        user_guidance = excluded.user_guidance, notes = excluded.notes,
        notes_updated_at = excluded.notes_updated_at, updated_at = datetime('now')
    `).run(input.chapterNumber, volumeId, data.title, data.role, data.purpose, data.keyEvents,
      JSON.stringify(data.characters), data.suspenseHook, data.userGuidance, data.notes, data.notesUpdatedAt)
    return { resource: 'blueprint', chapterNumber: input.chapterNumber, revision: readBlueprint(db, input.chapterNumber).revision }
  }
  if (proposal.proposal_type === 'propose_draft_update') {
    const input = validateDraftProposal(args)
    const current = readDraft(db, input.draftId)
    if (!current.draft) throw new Error('草稿不存在')
    if (current.draft.status === 'finalized' || current.draft.status === 'archived') throw new Error('只能修改未定稿的有效草稿')
    if (current.revision !== proposal.base_revision || input.baseRevision !== proposal.base_revision) {
      throw new Error('草稿已变化，请重新读取并提交提案')
    }
    const wordCount = countDraftUnits(input.content)
    db.prepare('UPDATE contents SET body = ? WHERE id = ?').run(input.content, draftRow(db, input.draftId).content_id)
    db.prepare("UPDATE drafts SET word_count = ?, updated_at = datetime('now') WHERE id = ?").run(wordCount, input.draftId)
    return { resource: 'draft', draftId: input.draftId, wordCount, revision: readDraft(db, input.draftId).revision }
  }
  throw new Error(`提案类型尚不支持实际提交：${proposal.proposal_type}`)
}
