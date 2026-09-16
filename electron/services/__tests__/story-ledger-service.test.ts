import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { closeProjectDatabase, initProjectDatabase } from '../../database'
import { getEntityStateAtChapter, saveEntityStateSnapshot, saveStoryEvent } from '../story-ledger-service'

const roots: string[] = []
afterEach(() => { closeProjectDatabase(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
describe('story ledger service', () => {
  it('round-trips sourced events and chapter state snapshots', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-ledger-')); roots.push(root); initProjectDatabase(root)
    const event = saveStoryEvent({ projectId: 'main', title: '钟声响起', chapterNumber: 3, participantFactIds: [], preconditions: [], result: { outcome: 'open' }, source: { chapter: 3 }, status: 'confirmed' })
    expect(event.title).toBe('钟声响起')
    saveEntityStateSnapshot({ projectId: 'main', entityFactId: 'character-1', chapterNumber: 3, state: { location: '塔楼' }, source: { chapter: 3 }, authorityStatus: 'confirmed' })
    expect(getEntityStateAtChapter('main', 'character-1', 4)?.state).toEqual({ location: '塔楼' })
  })
})
