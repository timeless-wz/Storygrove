/**
 * 细纲对照同步 — 补丁审查对话框（knowledge-action-outline-sync-contract §5.2）。
 *
 * 并排展示：正文证据 / 原细纲条目 / 新细纲建议，作者逐项接受/拒绝后提交。
 * 提交时主进程复核正文版本、蓝图 revision/contentHash 与绑定关系；任一变化阻止
 * 提交但保留候选并要求重新核对。提交成功展示下游影响提示（不自动改写）。
 */

import { useCallback, useEffect, useState } from 'react'
import { Check, GitCompareArrows, Play, Trash2, X } from 'lucide-react'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { useWorkflowStore } from '../../../stores/workflow-store'
import { captureProjectSession, isProjectSessionCurrent } from '../../project-session-gate'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../ui/Dialog'
import { Button } from '../../ui/Button'
import { NativeSelect } from '../../ui/NativeSelect'
import { toast } from '../../ui/Toast'
import type { OutlineSyncCandidate, OutlineSyncPatchItem, OutlineSyncAffected } from '../../../shared/outline-sync'
import {
  clearOutlineSyncPending,
  commitOutlineSyncCandidate,
  createOutlineSyncCandidate,
  discardOutlineSyncCandidate,
  listOutlineSyncCandidates,
} from '../../../services/knowledge-gap-client'
import { ipc } from '../../../services/ipc-client'
import { computeProseContentHash } from '../../../shared/prose-anchor'

interface OutlineSyncReviewDialogProps {
  projectKey: string
  chapterNumber: number
  open: boolean
  onClose: () => void
}

function changeKindLabel(kind: string, text: (zh: string, en: string) => string): string {
  const labels: Record<string, [string, string]> = {
    'scene-order': ['分镜顺序', 'Scene order'],
    'scene-content': ['分镜内容', 'Scene content'],
    'scene-added': ['新增分镜', 'Scene added'],
    'scene-omitted': ['分镜省略', 'Scene omitted'],
    'character-action': ['人物行动', 'Character action'],
    'location-time': ['地点时间', 'Location/time'],
    'knowledge': ['获知信息', 'Knowledge'],
    'conflict-outcome': ['冲突结果', 'Conflict outcome'],
    'hook': ['钩子', 'Hook'],
    'field-content': ['字段内容', 'Field content'],
    'no-change': ['无实质变化', 'No substantive change'],
  }
  const label = labels[kind]
  return label ? text(label[0], label[1]) : kind
}

export default function OutlineSyncReviewDialog({ projectKey, chapterNumber, open, onClose }: OutlineSyncReviewDialogProps) {
  const text = useLocaleStore(s => s.text)
  const currentProject = useProjectStore(s => s.currentProject)
  const addLog = useWorkflowStore(s => s.addLog)

  const [candidates, setCandidates] = useState<OutlineSyncCandidate[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [accepted, setAccepted] = useState<Set<string>>(new Set())
  const [drafts, setDrafts] = useState<Array<{ id: number; version: number; status: string }>>([])
  const [draftId, setDraftId] = useState('')
  const [unfinished, setUnfinished] = useState(false)
  const [running, setRunning] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [affected, setAffected] = useState<OutlineSyncAffected | null>(null)

  const selected = candidates.find(candidate => candidate.id === selectedId) ?? null

  const loadCandidates = useCallback(async () => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession || projectSession.projectPath !== projectKey) return
    try {
      const [list, draftList] = await Promise.all([
        listOutlineSyncCandidates(projectSession, { chapterNumber }),
        ipc.invokeWithProjectSession(projectSession, 'db:draft-list', chapterNumber, projectSession.projectPath) as Promise<Array<{ id: number; version: number; status: string; blueprintChapterNumber?: number | null }>>,
      ])
      if (!isProjectSessionCurrent(projectSession)) return
      const bound = draftList.filter(draft => draft.blueprintChapterNumber === chapterNumber)
      setCandidates(list)
      setDrafts(bound)
      setDraftId(previous => previous || String(bound[0]?.id ?? ''))
      setSelectedId(previous => previous ?? list.find(candidate => candidate.status === 'pending')?.id ?? null)
    } catch (error) {
      addLog('error', text(`同步候选加载失败：${String(error)}`, `Could not load sync candidates: ${String(error)}`))
    }
  }, [addLog, chapterNumber, currentProject, projectKey, text])

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => {
      setAffected(null)
      void loadCandidates()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadCandidates, open])

  const selectCandidate = (candidate: OutlineSyncCandidate) => {
    setSelectedId(candidate.id)
    setAccepted(new Set(candidate.items.filter(item => item.status !== 'rejected').map(item => item.id)))
    setAffected(null)
  }

  const runCompare = async () => {
    const projectSession = captureProjectSession(currentProject)
    const numericDraftId = Number.parseInt(draftId, 10)
    if (!projectSession || !numericDraftId) {
      toast.error(text('请先选择已绑定本章蓝图的草稿', 'Select a draft bound to this blueprint first'))
      return
    }
    setRunning(true)
    try {
      const { createOutlineSyncWorkflow } = await import('../../../services/workflows/knowledge-workflows')
      const workflow = createOutlineSyncWorkflow({
        projectSession,
        chapterNumber,
        draftId: numericDraftId,
        unfinishedDraft: unfinished,
        onCandidateReady: (candidateId) => {
          setSelectedId(candidateId)
          void loadCandidates()
        },
      })
      await useWorkflowStore.getState().startWorkflow(workflow)
      toast.info(text(
        '对照任务已开始；完成后回到本对话框逐项核对补丁',
        'Comparison started; come back to this dialog to review each patch item',
      ))
    } catch (error) {
      toast.error(text(`对照任务启动失败：${String(error)}`, `Could not start the comparison: ${String(error)}`))
    } finally {
      setRunning(false)
    }
  }

  const markPendingManually = async () => {
    const projectSession = captureProjectSession(currentProject)
    const numericDraftId = Number.parseInt(draftId, 10)
    if (!projectSession || !numericDraftId) return
    try {
      const full = await ipc.invokeWithProjectSession(
        projectSession, 'db:draft-get-full', numericDraftId, projectSession.projectPath,
      ) as { content: string } | null
      if (!full) return
      const { markOutlineSyncPending } = await import('../../../services/knowledge-gap-client')
      await markOutlineSyncPending(projectSession, {
        chapterNumber,
        draftId: numericDraftId,
        proseHash: computeProseContentHash(full.content),
      })
      toast.success(text('已标记「细纲待核对」；此标记不会自动调用 AI', 'Marked "outline needs review"; this does not trigger any AI run'))
    } catch (error) {
      toast.error(text(`标记失败：${String(error)}`, `Could not mark: ${String(error)}`))
    }
  }

  const toggleItem = (item: OutlineSyncPatchItem, accept: boolean) => {
    setAccepted(previous => {
      const next = new Set(previous)
      if (accept) next.add(item.id)
      else next.delete(item.id)
      return next
    })
  }

  const handleCommit = async () => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession || !selected) return
    setCommitting(true)
    try {
      const result = await commitOutlineSyncCandidate(projectSession, {
        candidateId: selected.id,
        acceptedItemIds: [...accepted],
      })
      if (!isProjectSessionCurrent(projectSession)) return
      setAffected(result.affected ?? null)
      await clearOutlineSyncPending(projectSession, chapterNumber)
      await loadCandidates()
      toast.success(text(
        `细纲已按 ${result.alreadyCommitted ? '既有提交结果' : '选中的补丁'}更新（revision ${result.revision ?? '?'})`,
        `Outline updated (${result.alreadyCommitted ? 'existing commit' : 'accepted patches'}), revision ${result.revision ?? '?'}`,
      ))
    } catch (error) {
      const needsRecompare = (error as { needsRecompare?: boolean }).needsRecompare
      if (needsRecompare) {
        toast.info(text(
          `${(error as Error).message}；候选已保留，请重新对照`,
          `${(error as Error).message}; the candidate is kept, please re-compare`,
        ))
      } else {
        toast.error(text(`提交失败：${String(error)}`, `Could not commit: ${String(error)}`))
      }
    } finally {
      setCommitting(false)
    }
  }

  const handleDiscard = async () => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession || !selected) return
    await discardOutlineSyncCandidate(projectSession, selected.id)
    await clearOutlineSyncPending(projectSession, chapterNumber)
    if (!isProjectSessionCurrent(projectSession)) return
    setSelectedId(null)
    await loadCandidates()
  }

  const manualCreateFromItems = () => {
    // 无模型回退路径：作者手工创建"无实质变化"候选，仅记录已核对。
    void (async () => {
      const projectSession = captureProjectSession(currentProject)
      const numericDraftId = Number.parseInt(draftId, 10)
      if (!projectSession || !numericDraftId) return
      try {
        const result = await createOutlineSyncCandidate(projectSession, {
          chapterNumber,
          draftId: numericDraftId,
          unfinishedDraft: unfinished,
          items: [],
          noSubstantiveChange: true,
          summaryNote: text('作者人工核对：无实质变化', 'Author manual check: no substantive change'),
        })
        if (!isProjectSessionCurrent(projectSession)) return
        selectCandidate(result.candidate)
        await loadCandidates()
      } catch (error) {
        toast.error(text(`候选创建失败：${String(error)}`, `Could not create the candidate: ${String(error)}`))
      }
    })()
  }

  if (!open) return null

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto" data-testid="outline-sync-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <GitCompareArrows size={14} className="text-[var(--color-accent)]" />
            {text(`第 ${chapterNumber} 章 · 正文对照细纲`, `Chapter ${chapterNumber} · prose vs outline`)}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 text-xs">
          {/* 运行对照 */}
          <div className="rounded-md border p-2.5 flex flex-wrap items-center gap-2" style={{ borderColor: 'var(--color-border)' }}>
            <span className="font-medium">{text('对照来源', 'Compare source')}</span>
            <NativeSelect value={draftId} onChange={e => setDraftId(e.target.value)} className="h-7 text-xs max-w-56" data-testid="outline-sync-draft-select">
              {drafts.length === 0 && <option value="">{text('（本章没有已绑定蓝图的草稿）', '(no draft bound to this blueprint)')}</option>}
              {drafts.map(draft => (
                <option key={draft.id} value={String(draft.id)}>{`#${draft.id} v${draft.version}${draft.status === 'finalized' ? text('（定稿）', ' (finalized)') : ''}`}</option>
              ))}
            </NativeSelect>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={unfinished} onChange={e => setUnfinished(e.target.checked)} />
              <span>{text('未完成稿（不把未写到的后半段推断为删掉）', 'Unfinished draft (do not infer omissions from missing content)')}</span>
            </label>
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { void markPendingManually() }}
              title={text('仅标记待核对，不运行 AI', 'Mark for review only, no AI run')}
            >
              {text('标记待核对', 'Mark for review')}
            </Button>
            <Button variant="ghost" size="sm" onClick={manualCreateFromItems} title={text('不运行 AI，仅记录"已核对，无实质变化"', 'No AI run; record "checked, no substantive change"')}>
              {text('记录无实质变化', 'Record no change')}
            </Button>
            <Button variant="default" size="sm" disabled={running || drafts.length === 0} onClick={() => { void runCompare() }} data-testid="outline-sync-run">
              <Play size={12} /> {running ? text('对照中…', 'Comparing…') : text('运行 AI 对照', 'Run AI comparison')}
            </Button>
          </div>

          {/* 候选列表 */}
          {candidates.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {candidates.map(candidate => (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => selectCandidate(candidate)}
                  className={`rounded border px-2 py-1 text-[11px] ${candidate.id === selectedId ? 'ring-1' : ''}`}
                  style={{
                    borderColor: candidate.id === selectedId ? 'var(--color-accent)' : 'var(--color-border)',
                    backgroundColor: candidate.id === selectedId ? 'var(--color-accent)' : 'transparent',
                    opacity: candidate.id === selectedId ? 0.1 : 1,
                    color: 'var(--color-text)',
                  }}
                  data-testid={`outline-sync-candidate-${candidate.id}`}
                >
                  {new Date(candidate.createdAt).toLocaleString()}
                  {' · '}
                  {candidate.status === 'pending' ? text('待核对', 'Pending')
                    : candidate.status === 'committed' ? text('已提交', 'Committed')
                      : candidate.status === 'discarded' ? text('已放弃', 'Discarded') : text('已过期', 'Stale')}
                  {' · '}
                  {candidate.noSubstantiveChange ? text('无实质变化', 'No change') : text(`${candidate.items.length} 条`, `${candidate.items.length} item(s)`)}
                </button>
              ))}
            </div>
          )}

          {/* 补丁审查 */}
          {selected && (
            <div className="flex flex-col gap-2" data-testid="outline-sync-items">
              {selected.summaryNote && (
                <div className="text-[11px] text-[var(--color-text-secondary)]">{selected.summaryNote}</div>
              )}
              {selected.status === 'committed' && (
                <div className="text-[11px]" style={{ color: 'var(--color-success-text)' }}>
                  {text('该候选已提交。版本标记只证明已针对该版本核对，不保证剧情永远一致。', 'This candidate is committed. The version mark only proves it was reviewed against that version.')}
                </div>
              )}
              {selected.items.length === 0 && (
                <div className="text-[11px] text-[var(--color-text-secondary)]">
                  {selected.noSubstantiveChange
                    ? text('无实质变化：仅措辞差异不产生补丁。', 'No substantive change: wording-only differences produce no patch.')
                    : text('该候选没有补丁条目。', 'This candidate has no patch items.')}
                </div>
              )}
              {selected.items.map(item => {
                const isAccepted = accepted.has(item.id)
                const op = item.op
                return (
                  <div key={item.id} className="rounded-md border p-2" style={{ borderColor: isAccepted ? 'var(--color-accent)' : 'var(--color-border)' }}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${isAccepted ? '' : 'opacity-60'}`}
                        style={{ borderColor: isAccepted ? 'var(--color-success-text)' : 'var(--color-border)', color: isAccepted ? 'var(--color-success-text)' : 'var(--color-text-secondary)' }}
                        onClick={() => toggleItem(item, !isAccepted)}
                        data-testid={`outline-sync-item-accept-${item.id}`}
                      >
                        {isAccepted ? <><Check size={10} /> {text('接受', 'Accepted')}</> : <><X size={10} /> {text('拒绝', 'Rejected')}</>}
                      </button>
                      <span className="text-[10px] rounded px-1 py-0.5 border" style={{ borderColor: 'var(--color-border)' }}>
                        {changeKindLabel(item.changeKind, text)}
                      </span>
                      <span className="text-[11px] text-[var(--color-text-secondary)] flex-1 min-w-40">{item.explanation}</span>
                    </div>
                    {item.proseEvidence && (
                      <div className="mt-1 rounded px-1.5 py-1 text-[11px]" style={{ backgroundColor: 'var(--color-editor-bg)' }}>
                        {text('正文证据：', 'Prose evidence: ')}
                        <span className="whitespace-pre-wrap">{item.proseEvidence}</span>
                      </div>
                    )}
                    {op.kind === 'replace-item' && (
                      <div className="mt-1 grid grid-cols-1 md:grid-cols-2 gap-1.5">
                        <div className="rounded px-1.5 py-1 text-[11px] whitespace-pre-wrap font-mono" style={{ backgroundColor: 'var(--color-editor-bg)' }}>
                          <div className="font-semibold mb-0.5">{text('原细纲', 'Before')}</div>
                          {op.beforeMarkdown}
                        </div>
                        <div className="rounded px-1.5 py-1 text-[11px] whitespace-pre-wrap font-mono" style={{ backgroundColor: 'var(--color-editor-bg)' }}>
                          <div className="font-semibold mb-0.5">{text('新细纲建议', 'After')}</div>
                          {op.afterMarkdown}
                        </div>
                      </div>
                    )}
                    {op.kind === 'add-scene' && (
                      <div className="mt-1 rounded px-1.5 py-1 text-[11px] whitespace-pre-wrap font-mono" style={{ backgroundColor: 'var(--color-editor-bg)' }}>
                        <div className="font-semibold mb-0.5">{text(`新增分镜：${op.title}`, `Add scene: ${op.title}`)}</div>
                        {op.markdown}
                      </div>
                    )}
                    {op.kind === 'remove-item' && (
                      <div className="mt-1 rounded px-1.5 py-1 text-[11px] whitespace-pre-wrap font-mono" style={{ backgroundColor: 'var(--color-editor-bg)' }}>
                        <div className="font-semibold mb-0.5">{text('将移除的原文', 'Content to remove')}</div>
                        {op.beforeMarkdown}
                      </div>
                    )}
                    {op.kind === 'reorder-scenes' && (
                      <div className="mt-1 text-[11px] text-[var(--color-text-secondary)]">
                        {text('新顺序：', 'New order: ')}{op.orderedSceneIds.join(' → ')}
                      </div>
                    )}
                  </div>
                )
              })}
              {selected.status === 'pending' && (
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => { void handleDiscard() }} data-testid="outline-sync-discard">
                    <Trash2 size={11} /> {text('放弃候选', 'Discard candidate')}
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    disabled={committing}
                    onClick={() => { void handleCommit() }}
                    data-testid="outline-sync-commit"
                  >
                    {committing ? text('提交中…', 'Committing…') : text(`提交选中的 ${accepted.size} 项`, `Commit ${accepted.size} accepted item(s)`)}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* 下游影响提示（只提示不自动改写） */}
          {affected && (
            <div className="rounded-md border p-2.5 text-[11px]" style={{ borderColor: 'var(--color-border)' }} data-testid="outline-sync-affected">
              <div className="font-semibold mb-1">{text('同步完成 · 可能受影响的对象（请自行核对，未自动修改）：', 'Sync complete · possibly affected objects (not modified automatically):')}</div>
              <div>
                {text('后续脉络计划 ', 'Thread plans: ')}{affected.threadPlanIds.length}
                {text('；信息记录 ', '; knowledge records: ')}{affected.knowledgeRecordIds.length}
                {text('；人物行动 ', '; actions: ')}{affected.actionIds.length}
                {text('；本章伏笔标记 ', '; foreshadowing markers: ')}{affected.foreshadowingIds.length}
              </div>
              {affected.staleProseAnchorRecordIds.length > 0 && (
                <div className="mt-1" style={{ color: 'var(--color-warning-text)' }}>
                  {text(
                    `${affected.staleProseAnchorRecordIds.length} 条信息记录的正文锚点已失效：原引用已保留并标记「需重新定位」，不会悄悄指向别的句子。`,
                    `${affected.staleProseAnchorRecordIds.length} knowledge anchor(s) went stale: original references kept and marked "needs relocation"; nothing was silently re-pointed.`,
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
