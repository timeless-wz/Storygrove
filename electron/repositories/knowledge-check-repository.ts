/**
 * AI 检查报告仓库（knowledge-action-outline-sync-contract §6）。
 * 报告持久化可回看；删除报告不影响任何正式对象。
 */

import { getProjectDb } from '../database'
import { ensureKnowledgeCheckSchema } from '../services/knowledge-check-schema'
import {
  assertValidKnowledgeCheckReport,
  createKnowledgeCheckReportId,
  type KnowledgeCheckFinding,
  type KnowledgeCheckKind,
  type KnowledgeCheckReport,
} from '../../src/shared/knowledge-check'

type ProjectDatabase = NonNullable<ReturnType<typeof getProjectDb>>

function requireDb(): ProjectDatabase {
  const db = getProjectDb()
  if (!db) throw new Error('项目数据库未打开')
  return db
}

interface ReportRow {
  id: string
  kind: string
  scope: string
  payload: string
  created_at: string
}

function rowToReport(row: ReportRow): KnowledgeCheckReport {
  const payload = JSON.parse(row.payload) as { findings?: KnowledgeCheckFinding[]; modelNote?: string }
  return {
    id: row.id,
    kind: row.kind as KnowledgeCheckKind,
    scope: row.scope,
    findings: payload.findings ?? [],
    modelNote: payload.modelNote ?? '',
    createdAt: row.created_at,
  }
}

export class KnowledgeCheckRepository {
  static ensureSchema(db: ProjectDatabase): void {
    ensureKnowledgeCheckSchema(db)
  }

  static saveReport(report: Omit<KnowledgeCheckReport, 'id' | 'createdAt'>): KnowledgeCheckReport {
    assertValidKnowledgeCheckReport({ ...report, id: 'pending', createdAt: '' })
    const db = requireDb()
    const id = createKnowledgeCheckReportId()
    const createdAt = new Date().toISOString()
    db.prepare('INSERT INTO knowledge_check_reports (id, kind, scope, payload, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, report.kind, report.scope, JSON.stringify({ findings: report.findings, modelNote: report.modelNote }), createdAt)
    return { ...report, id, createdAt }
  }

  static listReports(query: { kind?: KnowledgeCheckKind; scope?: string } = {}): KnowledgeCheckReport[] {
    const db = requireDb()
    const rows = db.prepare('SELECT * FROM knowledge_check_reports ORDER BY created_at DESC, id').all() as ReportRow[]
    let reports = rows.map(rowToReport)
    if (query.kind) reports = reports.filter(report => report.kind === query.kind)
    if (query.scope) reports = reports.filter(report => report.scope === query.scope)
    return reports
  }

  static deleteReport(id: string): { success: boolean; error?: string } {
    const db = requireDb()
    db.prepare('DELETE FROM knowledge_check_reports WHERE id = ?').run(id)
    return { success: true }
  }
}
