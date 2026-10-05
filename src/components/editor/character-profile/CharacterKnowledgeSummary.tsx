/**
 * 角色侧只读知情摘要（信息与揭露模块提供给角色档案的只读组件）。
 * 只展示该人物在信息与揭露模块中的记录，绝不在此编辑人物认知；
 * 记录数据权威在 knowledge_records 表（knowledge-action-outline-sync-contract §3.2）。
 */

import { useEffect, useMemo, useState } from 'react'
import { EyeOff, ShieldQuestion } from 'lucide-react'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { captureProjectSession, isProjectSessionCurrent } from '../../project-session-gate'
import type { InfoEntry, KnowledgeRecord } from '../../../shared/knowledge-gap'
import { KNOWLEDGE_COGNITION_LABEL, KNOWLEDGE_TRUTH_RELATION_LABEL } from '../../../shared/knowledge-gap'
import { listInfoEntries, listKnowledgeRecords } from '../../../services/knowledge-gap-client'

interface CharacterKnowledgeSummaryProps {
  projectKey: string
  characterId: string
}

export default function CharacterKnowledgeSummary({ projectKey, characterId }: CharacterKnowledgeSummaryProps) {
  const text = useLocaleStore(s => s.text)
  const currentProject = useProjectStore(s => s.currentProject)
  const [records, setRecords] = useState<KnowledgeRecord[]>([])
  const [entries, setEntries] = useState<InfoEntry[]>([])
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        const projectSession = captureProjectSession(currentProject)
        if (!projectSession || projectSession.projectPath !== projectKey || !characterId) {
          if (!cancelled) { setRecords([]); setEntries([]) }
          return
        }
        try {
          const [recordList, entryList] = await Promise.all([
            listKnowledgeRecords(projectSession, { characterId }),
            listInfoEntries(projectSession),
          ])
          if (!cancelled && isProjectSessionCurrent(projectSession)) {
            setRecords(recordList)
            setEntries(entryList)
          }
        } catch {
          if (!cancelled) { setRecords([]); setEntries([]) }
        }
      })()
    }, 0)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [characterId, currentProject, projectKey])

  const entryTitleById = useMemo(() => new Map(entries.map(entry => [entry.id, entry.title])), [entries])
  const concealedCount = records.filter(record => record.concealment).length

  if (!characterId || records.length === 0) {
    return (
      <div className="text-[11px] text-[var(--color-text-secondary)] px-3 py-2" data-testid="character-knowledge-summary-empty">
        {text(
          '信息与揭露：该人物暂无知情记录。可在「创作规划 → 信息与揭露」中维护谁在何时知道什么。',
          'Info & Revelation: no knowledge records for this character yet. Maintain who-knows-what under Writing plan → Info & Revelation.',
        )}
      </div>
    )
  }

  const visibleRecords = expanded ? records : records.slice(0, 3)

  return (
    <div className="text-xs px-3 py-2" data-testid="character-knowledge-summary">
      <div className="flex items-center gap-2 mb-1.5">
        <ShieldQuestion size={13} className="text-[var(--color-accent)]" />
        <span className="font-semibold text-[var(--color-text)]">{text('信息与揭露 · 知情摘要（只读）', 'Info & Revelation · knowledge summary (read-only)')}</span>
        {concealedCount > 0 && (
          <span className="inline-flex items-center gap-1 text-[10px] text-[var(--color-warning-text)]">
            <EyeOff size={10} /> {text(`${concealedCount} 条涉及隐瞒`, `${concealedCount} involve concealment`)}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        {visibleRecords.map(record => (
          <div key={record.id} className="rounded border px-2 py-1" style={{ borderColor: 'var(--color-border)' }}>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium">{entryTitleById.get(record.infoId) ?? record.infoId}</span>
              <span className="text-[10px] rounded px-1 border" style={{ borderColor: 'var(--color-border)' }}>
                {text(KNOWLEDGE_COGNITION_LABEL[record.cognition].zh, KNOWLEDGE_COGNITION_LABEL[record.cognition].en)}
              </span>
              <span className="text-[10px] text-[var(--color-text-secondary)]">
                {text(KNOWLEDGE_TRUTH_RELATION_LABEL[record.truthRelation].zh, KNOWLEDGE_TRUTH_RELATION_LABEL[record.truthRelation].en)}
              </span>
              {record.concealment && (
                <span className="text-[10px] text-[var(--color-warning-text)]">{text('隐瞒', 'Concealing')}</span>
              )}
            </div>
            {record.knownContent && (
              <div className="text-[11px] text-[var(--color-text-secondary)] line-clamp-2 mt-0.5">{record.knownContent}</div>
            )}
          </div>
        ))}
      </div>
      {records.length > 3 && (
        <button
          type="button"
          className="text-[11px] text-[var(--color-accent)] mt-1"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? text('收起', 'Collapse') : text(`展开全部 ${records.length} 条`, `Show all ${records.length}`)}
        </button>
      )}
    </div>
  )
}
