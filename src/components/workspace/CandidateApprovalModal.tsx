import { useState } from 'react'
import { Check, X, Users, BookMarked, AlertTriangle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../ui/Dialog'
import { Button } from '../ui/Button'
import { useWorkspaceHubStore } from '../../stores/workspace-hub-store'
import { useLocaleStore } from '../../stores/locale-store'
import { toast } from '../ui/Toast'
import type { WorkspaceImportCandidate } from '../../shared/workspace-hub'
import type { CharacterRosterEntry } from '../../shared/character-roster'

interface Props {
  open: boolean
  onClose: () => void
}

export default function CandidateApprovalModal({ open, onClose }: Props) {
  const text = useLocaleStore(s => s.text)
  const candidates = useWorkspaceHubStore(s => s.candidates)
  const actionCandidate = useWorkspaceHubStore(s => s.actionCandidate)
  const actioningCandidateId = useWorkspaceHubStore(s => s.actioningCandidateId)

  const pendingCandidates = candidates.filter(c => c.status === 'pending')
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null)

  const activeCandidate = pendingCandidates.find(c => c.candidateId === selectedCandidateId)
    ?? pendingCandidates[0]

  const handleApprove = async (candidate: WorkspaceImportCandidate) => {
    const ok = await actionCandidate(candidate.candidateId, 'approve')
    if (ok) {
      toast.success(
        candidate.candidateType === 'character'
          ? text('角色已确认并原子写入结构化角色名单', 'Character confirmed and committed to structured roster')
          : text('规则已确认并写入设定表', 'Rule confirmed and saved')
      )
    } else {
      toast.error(text('审批导入失败', 'Approval failed'))
    }
  }

  const handleReject = async (candidate: WorkspaceImportCandidate) => {
    const ok = await actionCandidate(candidate.candidateId, 'reject')
    if (ok) {
      toast.info(text('已忽略该候选项', 'Candidate ignored'))
    }
  }

  let parsedCharacter: CharacterRosterEntry | null = null
  if (activeCandidate && activeCandidate.candidateType === 'character') {
    try {
      parsedCharacter = JSON.parse(activeCandidate.suggestedData) as CharacterRosterEntry
    } catch {
      parsedCharacter = null
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-[780px] max-h-[85vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="p-4 pb-2 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <DialogTitle className="flex items-center gap-2">
            <span>{text('待确认导入候选', 'Pending Import Candidates')}</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-accent/20 font-normal" style={{ color: 'var(--color-accent)' }}>
              {pendingCandidates.length}
            </span>
          </DialogTitle>
          <DialogDescription className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {text(
              '从外部创作母稿中识别出的候选事实，必须经作者人工预览并确认后，才会原子提交至数据库事实源。',
              'Candidates extracted from external drafts must be reviewed and confirmed before committing to database facts.',
            )}
          </DialogDescription>
        </DialogHeader>

        {pendingCandidates.length === 0 ? (
          <div className="p-12 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {text('暂无待确认的候选项', 'No pending candidates to review')}
          </div>
        ) : (
          <div className="flex flex-1 min-h-[380px] overflow-hidden">
            {/* 左侧候选列表 */}
            <div
              className="w-56 border-r overflow-y-auto p-2 space-y-1 shrink-0"
              style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-sidebar)' }}
            >
              {pendingCandidates.map(c => {
                const isSelected = activeCandidate?.candidateId === c.candidateId
                let label = c.sourceHeadingPath
                if (c.candidateType === 'character') {
                  try {
                    const obj = JSON.parse(c.suggestedData) as { name?: string }
                    if (obj.name) label = obj.name
                  } catch {
                    // ignore
                  }
                }
                return (
                  <button
                    key={c.candidateId}
                    onClick={() => setSelectedCandidateId(c.candidateId)}
                    className={`w-full flex items-center gap-2 px-2.5 py-2 rounded text-left text-xs transition-colors ${
                      isSelected ? 'bg-accent/20 font-medium' : 'hover:bg-black/5 dark:hover:bg-white/5'
                    }`}
                    style={{ color: isSelected ? 'var(--color-accent)' : 'var(--color-text)' }}
                  >
                    {c.candidateType === 'character' ? (
                      <Users size={13} className="shrink-0 opacity-75" />
                    ) : (
                      <BookMarked size={13} className="shrink-0 opacity-75" />
                    )}
                    <span className="truncate flex-1">{label}</span>
                  </button>
                )
              })}
            </div>

            {/* 右侧候选详情与操作 */}
            {activeCandidate && (
              <div className="flex-1 flex flex-col p-4 overflow-y-auto space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 rounded font-medium bg-black/10 dark:bg-white/10">
                      {activeCandidate.candidateType === 'character'
                        ? text('角色候选', 'Character Candidate')
                        : text('设定候选', 'Setting Candidate')}
                    </span>
                    <span className="text-xs text-muted-foreground truncate max-w-xs">
                      {activeCandidate.sourceFile}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={actioningCandidateId === activeCandidate.candidateId}
                      onClick={() => void handleReject(activeCandidate)}
                      className="text-xs gap-1"
                    >
                      <X size={12} />
                      {text('忽略/拒绝', 'Reject')}
                    </Button>
                    <Button
                      size="sm"
                      disabled={actioningCandidateId === activeCandidate.candidateId}
                      onClick={() => void handleApprove(activeCandidate)}
                      className="text-xs gap-1"
                    >
                      <Check size={12} />
                      {text('确认导入', 'Approve & Import')}
                    </Button>
                  </div>
                </div>

                {/* 角色卡预览 */}
                {parsedCharacter ? (
                  <div className="border rounded p-3 text-xs space-y-2" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
                    <div className="font-semibold text-sm flex items-center justify-between" style={{ color: 'var(--color-text)' }}>
                      <span>{parsedCharacter.name}</span>
                      <span className="text-xs font-normal opacity-80">{parsedCharacter.role}</span>
                    </div>

                    {parsedCharacter.background && (
                      <div>
                        <span className="font-medium opacity-70">{text('背景与身份: ', 'Background: ')}</span>
                        <span>{parsedCharacter.background}</span>
                      </div>
                    )}
                    {parsedCharacter.personality && (
                      <div>
                        <span className="font-medium opacity-70">{text('性格特征: ', 'Personality: ')}</span>
                        <span>{parsedCharacter.personality}</span>
                      </div>
                    )}
                    {parsedCharacter.abilities && (
                      <div>
                        <span className="font-medium opacity-70">{text('能力与技能: ', 'Abilities: ')}</span>
                        <span>{parsedCharacter.abilities}</span>
                      </div>
                    )}
                    {parsedCharacter.motivation && (
                      <div>
                        <span className="font-medium opacity-70">{text('核心动机: ', 'Motivation: ')}</span>
                        <span>{parsedCharacter.motivation}</span>
                      </div>
                    )}
                    {parsedCharacter.notes && (
                      <div>
                        <span className="font-medium opacity-70">{text('备注: ', 'Notes: ')}</span>
                        <span>{parsedCharacter.notes}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="border rounded p-3 text-xs font-mono whitespace-pre-wrap" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
                    {activeCandidate.suggestedData}
                  </div>
                )}

                {/* 原始来源片段证据 */}
                <div className="space-y-1">
                  <div className="text-[11px] font-medium flex items-center justify-between" style={{ color: 'var(--color-text-muted)' }}>
                    <span>{text('母稿来源证据 (只读)', 'Draft Evidence (Read-only)')}</span>
                    <span>行 {activeCandidate.sourceLineRange}</span>
                  </div>
                  <div
                    className="border rounded p-2.5 text-xs font-mono whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed"
                    style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-editor-bg)', color: 'var(--color-text-secondary)' }}
                  >
                    {activeCandidate.rawData}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="p-3 border-t flex justify-between items-center" style={{ borderColor: 'var(--color-border)' }}>
          <div className="text-[11px] flex items-center gap-1.5" style={{ color: 'var(--color-text-muted)' }}>
            <AlertTriangle size={12} className="text-warning" />
            <span>{text('未经作者确认的内容绝不会写入正式运行事实', 'Unconfirmed content is never written into official running facts')}</span>
          </div>
          <Button size="sm" variant="outline" onClick={onClose}>
            {text('关闭', 'Close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
