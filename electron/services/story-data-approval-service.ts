import { createHash } from 'node:crypto'
import type BetterSqlite3 from 'better-sqlite3'

import { getProjectDb } from '../database'
import { StoryDomainRepository } from '../repositories/story-domain-repository'
import { synchronizeConfirmedFactKnowledge } from './rag-context-service'
import type {
  StoryDataApprovalRequest,
  StoryDataApprovalResult,
  StoryDataImpact,
} from '../../src/shared/story-data-approval'
import type { StoryEntityType, StoryFactCandidate } from '../../src/shared/story-domain'

function requiredDb(): BetterSqlite3.Database {
  const db = getProjectDb()
  if (!db) throw new Error('项目数据库未打开')
  return db
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function getCandidate(projectId: string, candidateId: string): StoryFactCandidate | undefined {
  return StoryDomainRepository.listCandidates(projectId).find(candidate => candidate.candidateId === candidateId)
}

/**
 * 第二阶段作者确认门：提取器只创建 story_fact_candidates，正式资料、版本和
 * 影响索引只能从这里进入。所有查找均以 projectId 限定，避免候选 ID 串项目。
 */
export class StoryDataApprovalService {
  static approve(request: StoryDataApprovalRequest): StoryDataApprovalResult {
    const projectId = request.projectId.trim()
    const approvedBy = request.approvedBy.trim()
    if (!projectId) return { success: false, error: '必须提供显式 projectId' }
    if (!approvedBy) return { success: false, error: '必须提供确认人' }

    const candidate = getCandidate(projectId, request.candidateId)
    if (!candidate) return { success: false, error: '候选不存在、或不属于当前项目' }
    if (candidate.reviewStatus === 'rejected') return { success: false, error: '已拒绝的候选不能直接批准' }

    // 已批准候选是安全的幂等 replay，不会再次创建版本。
    if (candidate.reviewStatus === 'approved') {
      const fact = StoryDomainRepository.listFacts(projectId, undefined, candidate.entityType)
        .find(item => item.canonicalName === candidate.canonicalName)
      if (!fact) return { success: false, error: '候选已批准但正式资料缺失' }
      const version = StoryDomainRepository.listVersions(projectId, fact.factId).at(-1)
      if (!version) return { success: false, error: '正式资料版本缺失' }
      return {
        success: true,
        idempotent: true,
        factId: fact.factId,
        version,
        impacts: StoryDomainRepository.listImpacts(projectId, fact.factId),
      }
    }

    try {
      const fact = StoryDomainRepository.approveCandidate(projectId, request.candidateId, approvedBy)
      const impacts = this.rebuildImpacts(projectId, fact.factId, candidate)
      const version = StoryDomainRepository.listVersions(projectId, fact.factId).at(-1)
      if (version) synchronizeConfirmedFactKnowledge(fact, version.versionId)
      return { success: true, idempotent: false, factId: fact.factId, version, impacts }
    } catch (error) {
      // A concurrent retry may observe the candidate after the repository's
      // transaction committed. Re-read by project and return the committed
      // version instead of exposing a spurious "already processed" failure.
      const completed = getCandidate(projectId, request.candidateId)
      if (completed?.reviewStatus === 'approved') {
        const fact = StoryDomainRepository.listFacts(projectId, undefined, completed.entityType)
          .find(item => item.canonicalName === completed.canonicalName)
        if (fact) {
          const version = StoryDomainRepository.listVersions(projectId, fact.factId).at(-1)
          if (version) return {
            success: true,
            idempotent: true,
            factId: fact.factId,
            version,
            impacts: StoryDomainRepository.listImpacts(projectId, fact.factId),
          }
        }
      }
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  static reject(projectId: string, candidateId: string): { success: boolean; error?: string } {
    try {
      const candidate = getCandidate(projectId.trim(), candidateId)
      if (!candidate) return { success: false, error: '候选不存在、或不属于当前项目' }
      // Reject is intentionally idempotent for retrying an author action.
      if (candidate.reviewStatus === 'rejected') return { success: true }
      StoryDomainRepository.rejectCandidate(projectId, candidateId)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  static listImpacts(projectId: string, factId?: string): StoryDataImpact[] {
    return StoryDomainRepository.listImpacts(projectId.trim(), factId).map(impact => impact)
  }

  private static rebuildImpacts(
    projectId: string,
    factId: string,
    candidate: StoryFactCandidate,
  ): StoryDataImpact[] {
    const db = requiredDb()
    const fragment = db.prepare(`
      SELECT chapter_start, chapter_end, purpose
      FROM workspace_source_snapshot_fragments
      WHERE id = ? AND source_id = ? AND snapshot_id = ? AND project_id = ?
    `).get(
      candidate.provenance.sourceFragmentId,
      candidate.provenance.sourceId,
      candidate.provenance.sourceSnapshotId,
      projectId,
    ) as { chapter_start?: number | null; chapter_end?: number | null; purpose?: string } | undefined
    if (!fragment || fragment.chapter_start === null || fragment.chapter_start === undefined) {
      return StoryDomainRepository.listImpacts(projectId, factId)
    }
    const start = fragment.chapter_start
    const end = fragment.chapter_end ?? start
    const impactType: 'appears' | 'depends_on' | 'mentions' = candidate.entityType === 'character'
      ? 'appears'
      : candidate.entityType === 'narrative_thread' || candidate.entityType === 'foreshadowing'
        ? 'depends_on'
        : 'mentions'
    const narrativeLine = fragment.purpose?.trim() ?? ''
    db.transaction(() => {
      const insert = db.prepare(`
        INSERT OR IGNORE INTO story_fact_impacts (
          impact_id, project_id, fact_id, chapter_number, impact_type, narrative_line
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
      for (let chapter = start; chapter <= end; chapter += 1) {
        insert.run(
          `impact-${hash(`${projectId}:${factId}:${chapter}:${impactType}:${narrativeLine}`).slice(0, 24)}`,
          projectId, factId, chapter, impactType, narrativeLine,
        )
      }
    })()
    return StoryDomainRepository.listImpacts(projectId, factId)
  }
}

export type { StoryEntityType }
