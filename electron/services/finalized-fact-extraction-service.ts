import { createHash } from 'node:crypto'
import { getProjectDb } from '../database'
import { extractStoryCandidates } from './story-candidate-extractor'
import { StoryCandidatePersistenceService } from './story-candidate-persistence-service'
import type { StoryFactCandidate } from '../../src/shared/story-domain'

interface FinalizedDraftRow {
  id: number
  chapterNumber: number
  version: number
  status: string
  content: string
}

function requiredDb() {
  const db = getProjectDb()
  if (!db) throw new Error('项目数据库未打开')
  return db
}

/**
 * Extracts labelled facts from an author-finalized draft into the candidate
 * inbox. It never writes a confirmed fact: normal approval/version checks are
 * still required. The draft identity and content hash become the provenance.
 */
export function extractFinalizedDraftFactCandidates(
  projectId: string,
  draftId: number,
): StoryFactCandidate[] {
  if (!Number.isSafeInteger(draftId) || draftId < 1) throw new Error('定稿草稿身份无效')
  const row = requiredDb().prepare(`
    SELECT drafts.id, drafts.chapter_number AS chapterNumber, drafts.version, drafts.status, contents.body AS content
    FROM drafts JOIN contents ON contents.id = drafts.content_id
    WHERE drafts.id = ?
  `).get(draftId) as FinalizedDraftRow | undefined
  if (!row || row.status !== 'finalized' || !row.content.trim()) throw new Error('只能从当前定稿正文提取候选')
  const contentHash = createHash('sha256').update(row.content, 'utf8').digest('hex')
  const proposal = extractStoryCandidates({
    projectId,
    source: {
      projectId,
      sourceId: `finalized-draft:${row.id}`,
      snapshotId: `finalized-v${row.version}`,
      fragmentId: `draft-${row.id}-body-v${row.version}`,
      relativePath: `internal://finalized-drafts/${row.id}/v${row.version}`,
      headingPath: `第${row.chapterNumber}章定稿正文`,
      startLine: 1,
      endLine: row.content.split(/\r?\n/u).length,
      fragmentHash: contentHash,
      content: row.content,
    },
  })
  return StoryCandidatePersistenceService.persistProposal(projectId, proposal)
}
