/**
 * BlueprintV2ImportDialog — 完整 Markdown 细纲的导入预览与确认。
 *
 * 契约（blueprint-v2-contract §4.3）：
 * - 解析预览必须明确展示内容映射：七个规范分区、未归类（custom）分区、
 *   分镜清单；重复导入时展示差异（沿用旧分镜 ID / 将被移除的旧分镜）。
 * - 应用 = 用户确认后以 baseRevision = 当前 revision 保存；取消 = 零写入。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, FileUp } from 'lucide-react'

import {
  BLUEPRINT_V2_CANONICAL_SECTIONS,
  extractBlueprintV2WordBudget,
  getBlueprintV2Scenes,
  type ChapterBlueprintV2Content,
  type ChapterBlueprintV2DetailRead,
} from '../../shared/blueprint-v2'
import {
  applyBlueprintV2Reimport,
  matchScenesForReimport,
  parseChapterBlueprintMarkdown,
} from '../../shared/blueprint-v2-markdown'
import type { ProjectSessionContext } from '../../shared/ipc-channels'
import { ipc } from '../../services/ipc-client'
import { useLocaleStore } from '../../stores/locale-store'
import { Button } from '../ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/Dialog'
import { Label } from '../ui/Label'
import { NativeSelect } from '../ui/NativeSelect'
import { Textarea } from '../ui/Textarea'
import { toast } from '../ui/Toast'

export interface BlueprintV2ImportDialogProps {
  open: boolean
  onClose(): void
  /** 现有章节（来自 v1 蓝图列表），用于选择目标章。 */
  chapters: Array<{ chapterNumber: number; title: string }>
  projectSession: ProjectSessionContext
  projectKey: string
  /** 导入成功后的回调（上层刷新 v2 详情与 v1 投影）。 */
  onImported(chapterNumber: number): void
}

function detailToContent(detail: ChapterBlueprintV2DetailRead): ChapterBlueprintV2Content {
  return {
    schemaVersion: detail.schemaVersion,
    chapterNumber: detail.chapterNumber,
    chapterTitle: detail.chapterTitle,
    ...(detail.chapterTitleLevel === undefined ? {} : { chapterTitleLevel: detail.chapterTitleLevel }),
    docPreamble: detail.docPreamble,
    ...(detail.chapterPostamble === undefined ? {} : { chapterPostamble: detail.chapterPostamble }),
    sections: detail.sections,
    origin: detail.origin,
  }
}

export default function BlueprintV2ImportDialog({
  open,
  onClose,
  chapters,
  projectSession,
  projectKey,
  onImported,
}: BlueprintV2ImportDialogProps) {
  const text = useLocaleStore(s => s.text)
  const [step, setStep] = useState<'input' | 'preview'>('input')
  const [raw, setRaw] = useState('')
  const [targetChapter, setTargetChapter] = useState<number | null>(null)
  const [existingDetail, setExistingDetail] = useState<ChapterBlueprintV2DetailRead | null>(null)
  const [existingLookupFailed, setExistingLookupFailed] = useState(false)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) {
      setStep('input')
      setRaw('')
      setTargetChapter(null)
      setExistingDetail(null)
      setExistingLookupFailed(false)
      setError('')
      setApplying(false)
      setLoadingPreview(false)
    }
  }, [open])

  const parsed = useMemo(() => {
    if (step !== 'preview') return null
    try {
      return parseChapterBlueprintMarkdown(raw)
    } catch {
      return null
    }
  }, [step, raw])

  const canonicalSections = parsed
    ? parsed.content.sections.filter(section => section.kind === 'canonical')
    : []
  const customSections = parsed
    ? parsed.content.sections.filter(section => section.kind === 'custom')
    : []
  const incomingScenes = parsed ? getBlueprintV2Scenes(parsed.content) : []
  const wordBudget = parsed ? extractBlueprintV2WordBudget(parsed.content) : null

  const enterPreview = useCallback(async () => {
    setError('')
    if (raw.trim() === '') {
      setError(text('请先粘贴或选择要导入的 Markdown 细纲。', 'Paste or pick the Markdown outline to import first.'))
      return
    }
    let parseResult
    try {
      parseResult = parseChapterBlueprintMarkdown(raw)
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : String(parseError))
      return
    }
    setLoadingPreview(true)
    try {
      const suggested = parseResult.suggestedChapterNumber
      const target = suggested !== null && chapters.some(chapter => chapter.chapterNumber === suggested)
        ? suggested
        : (targetChapter ?? chapters[0]?.chapterNumber ?? null)
      setTargetChapter(target)
      setExistingLookupFailed(false)
      setStep('preview')
    } finally {
      setLoadingPreview(false)
    }
  }, [chapters, raw, targetChapter, text])

  // 进入预览后拉取目标章现有 v2 细纲，计算重导入差异。
  useEffect(() => {
    if (step !== 'preview' || targetChapter === null) return
    let cancelled = false
    void (async () => {
      setLoadingPreview(true)
      setExistingDetail(null)
      setExistingLookupFailed(false)
      try {
        const detail = await ipc.invokeWithProjectSession(
          projectSession, 'db:blueprint-v2-get', targetChapter, projectKey,
        )
        if (!cancelled) setExistingDetail(detail)
      } catch (fetchError) {
        if (!cancelled) {
          setExistingDetail(null)
          setExistingLookupFailed(true)
          setError(fetchError instanceof Error ? fetchError.message : String(fetchError))
        }
      } finally {
        if (!cancelled) setLoadingPreview(false)
      }
    })()
    return () => { cancelled = true }
  }, [step, targetChapter, projectSession, projectKey])

  const matchedByIncoming = useMemo(() => {
    if (!parsed || !existingDetail || existingDetail.readStatus !== undefined) return null
    const matches = matchScenesForReimport(detailToContent(existingDetail), parsed.content)
    return new Map(matches.incoming.map(entry => [
      entry.sceneId,
      entry.matchedSceneId
        ? getBlueprintV2Scenes(detailToContent(existingDetail)).find(scene => scene.sceneId === entry.matchedSceneId) ?? null
        : null,
    ]))
  }, [parsed, existingDetail, incomingScenes])

  const removedScenes = useMemo(() => {
    if (!parsed || !existingDetail || existingDetail.readStatus !== undefined || !matchedByIncoming) return []
    return matchScenesForReimport(detailToContent(existingDetail), parsed.content).removed
  }, [parsed, existingDetail, matchedByIncoming])

  const handleApply = useCallback(async () => {
    if (!parsed || targetChapter === null || applying || existingLookupFailed || existingDetail?.readStatus !== undefined) return
    setApplying(true)
    setError('')
    try {
      const incoming = { ...parsed.content, chapterNumber: targetChapter }
      const content = existingDetail
        ? applyBlueprintV2Reimport(detailToContent(existingDetail), incoming, targetChapter)
        : incoming
      const result = await ipc.invokeWithProjectSession(projectSession, 'db:blueprint-v2-save', {
        chapterNumber: targetChapter,
        baseRevision: existingDetail?.revision ?? 0,
        content,
      }, projectKey)
      if (!result.success) {
        if (result.conflict) {
          setError(text(
            `该章细纲刚被其他窗口修改（当前版本 r${result.currentRevision ?? '?'}）。请关闭后重新打开导入，以最新内容为基底。`,
            `The outline was just modified elsewhere (current revision r${result.currentRevision ?? '?'}). Reopen the import to base it on the latest content.`,
          ))
        } else {
          setError(result.error ?? text('导入保存失败。', 'Could not save the import.'))
        }
        return
      }
      toast.success(text(
        `已导入第 ${targetChapter} 章细纲（${incomingScenes.length} 个分镜）`,
        `Imported the outline for Chapter ${targetChapter} (${incomingScenes.length} scene(s))`,
      ))
      onImported(targetChapter)
      onClose()
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : String(applyError))
    } finally {
      setApplying(false)
    }
  }, [parsed, targetChapter, applying, existingDetail, existingLookupFailed, projectSession, projectKey, text, incomingScenes.length, onImported, onClose])

  const handleFilePick = useCallback(async (file: File | undefined) => {
    if (!file) return
    const content = await file.text()
    setRaw(content)
  }, [])

  const suggested = parsed?.suggestedChapterNumber ?? null
  const numberMismatch = suggested !== null && targetChapter !== null && suggested !== targetChapter

  return (
    <Dialog open={open} onOpenChange={nextOpen => { if (!nextOpen) onClose() }}>
      <DialogContent className="max-w-2xl" data-testid="blueprint-v2-import-dialog">
        <DialogHeader>
          <DialogTitle>
            {step === 'input'
              ? text('导入 Markdown 细纲', 'Import Markdown outline')
              : text('确认导入（预览）', 'Confirm import (preview)')}
          </DialogTitle>
          <DialogDescription>
            {step === 'input'
              ? text(
                '粘贴由 Codex 等工具生成的完整章节细纲 Markdown。解析预览不会改动任何数据；取消即零写入。',
                'Paste the full chapter outline Markdown generated by Codex or similar tools. The preview changes nothing; cancelling writes nothing.',
              )
              : text(
                '以下内容将写入所选章节的正式蓝图细纲。确认前请核对分区与分镜映射。',
                'The content below will be written into the selected chapter’s formal blueprint. Verify the section and scene mapping before confirming.',
              )}
          </DialogDescription>
        </DialogHeader>

        {step === 'input' ? (
          <div className="space-y-3 px-6 py-2">
            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="blueprint-v2-import-raw">{text('细纲 Markdown', 'Outline Markdown')}</Label>
                <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--color-accent)' }}>
                  <FileUp size={12} />
                  {text('选择 .md 文件', 'Pick a .md file')}
                  <input
                    type="file"
                    accept=".md,.markdown,.txt"
                    className="hidden"
                    onChange={event => { void handleFilePick(event.target.files?.[0]); event.target.value = '' }}
                  />
                </label>
              </div>
              <Textarea
                id="blueprint-v2-import-raw"
                value={raw}
                rows={14}
                onChange={event => setRaw(event.target.value)}
                className="font-mono text-xs"
                placeholder={text(
                  '### 第1章｜…\n\n#### 【本章定位与四维指标】\n…\n\n#### 【逐场分镜拆解】\n\n##### 场景一：…',
                  '### Chapter 1 | …\n\n#### 【本章定位与四维指标】\n…\n\n#### 【逐场分镜拆解】\n\n##### 场景一：…',
                )}
                data-testid="blueprint-v2-import-raw"
              />
            </div>
            {error && (
              <p className="text-xs" style={{ color: 'var(--color-error-text)' }} role="alert">{error}</p>
            )}
          </div>
        ) : (
          <div className="space-y-3 px-6 py-2 max-h-[60vh] overflow-y-auto" data-testid="blueprint-v2-import-preview">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{text('目标章节', 'Target chapter')}</Label>
                <NativeSelect
                  value={targetChapter ?? ''}
                  onChange={event => {
                    setExistingDetail(null)
                    setExistingLookupFailed(false)
                    setTargetChapter(Number(event.target.value))
                  }}
                  data-testid="blueprint-v2-import-target"
                >
                  {chapters.map(chapter => (
                    <option key={chapter.chapterNumber} value={chapter.chapterNumber}>
                      {text(`第 ${chapter.chapterNumber} 章`, `Chapter ${chapter.chapterNumber}`)}
                      {chapter.title ? ` · ${chapter.title}` : ''}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div>
                <Label>{text('文档章题（解析）', 'Document chapter title (parsed)')}</Label>
                <p className="text-sm" style={{ color: 'var(--color-text)' }}>
                  {parsed?.content.chapterTitle || text('（未检测到章题行）', '(no chapter title detected)')}
                </p>
              </div>
            </div>
            <div data-testid="blueprint-v2-import-project">
              <Label>{text('目标项目', 'Target project')}</Label>
              <p className="text-xs break-all" style={{ color: 'var(--color-text-secondary)' }} title={projectSession.projectPath}>
                {projectSession.projectPath}
              </p>
            </div>
            {numberMismatch && (
              <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-warning-text)' }}>
                <AlertTriangle size={12} />
                {text(
                  `文档章题建议第 ${suggested} 章，但目标为第 ${targetChapter} 章。章号以所选目标为准。`,
                  `The document title suggests Chapter ${suggested}, but the target is Chapter ${targetChapter}. The selected target wins.`,
                )}
              </p>
            )}
            {existingDetail && (
              <p className="text-xs" style={{ color: 'var(--color-warning-text)' }}>
                {text(
                  `该章已有 v2 细纲（版本 r${existingDetail.revision}）。确认后将以本文档为准更新；同名分镜保留原分镜 ID 与画布链接。`,
                  `This chapter already has a v2 outline (revision r${existingDetail.revision}). Confirming will replace it with this document; scenes with matching titles keep their IDs and canvas links.`,
                )}
              </p>
            )}
            {existingDetail?.readStatus && (
              <div className="rounded-md border p-3 space-y-2" style={{ borderColor: 'var(--color-error)', color: 'var(--color-error-text)' }} data-testid="blueprint-v2-import-read-error">
                <p className="text-xs">
                  {existingDetail.readStatus === 'corrupt'
                    ? text('目标章已有损坏的 v2 细纲。为避免覆盖无法读取的数据，当前导入已锁定；请先在蓝图页检查原始 Markdown 并显式删除损坏记录。', 'The target chapter has a corrupt v2 outline. Import is locked to avoid overwriting unreadable data; inspect the raw Markdown in the blueprint page and explicitly delete the corrupt record first.')
                    : text(`目标章细纲由较新版本写入（schema ${existingDetail.storedSchemaVersion ?? '?'}）。请升级应用后再导入；当前不会覆盖该记录。`, `The target outline was written by a newer app version (schema ${existingDetail.storedSchemaVersion ?? '?'}). Upgrade the app before importing; this record will not be overwritten.`)}
                </p>
                {existingDetail.rawMarkdown !== undefined && (
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded border p-2 text-[0.7rem]" style={{ borderColor: 'var(--color-border)' }} data-testid="blueprint-v2-import-raw-existing">
                    {existingDetail.rawMarkdown}
                  </pre>
                )}
              </div>
            )}

            <div>
              <Label>{text('分区映射', 'Section mapping')}</Label>
              <ul className="text-xs space-y-1" style={{ color: 'var(--color-text-secondary)' }}>
                {BLUEPRINT_V2_CANONICAL_SECTIONS.map(entry => {
                  const section = canonicalSections.find(candidate => candidate.kind === 'canonical' && candidate.id === entry.id)
                  return (
                    <li key={entry.id} data-testid="blueprint-v2-preview-canonical">
                      {section
                        ? `✔ ${section.title} → ${text('蓝图规范分区', 'canonical blueprint section')}`
                        : `· 【${entry.title}】 → ${text('本文档未包含；不新增内容', 'not present in this document; no content will be invented')}`}
                    </li>
                  )
                })}
                {customSections.map(section => (
                  <li key={section.id} className="space-y-1" style={{ color: 'var(--color-text-muted)' }} data-testid="blueprint-v2-preview-custom">
                    <span>⤷ {section.title} → {text('未归类部分（原文逐字保留，可随时编辑）', 'unclassified (kept verbatim, always editable)')}</span>
                    <pre className="max-h-28 overflow-auto whitespace-pre-wrap rounded border p-2" style={{ borderColor: 'var(--color-border)' }}>{section.body}</pre>
                  </li>
                ))}
                {parsed && parsed.content.docPreamble.trim() !== '' && (
                  <li className="space-y-1" style={{ color: 'var(--color-text-muted)' }} data-testid="blueprint-v2-preview-preamble">
                    <span>{text('⤷ 一级分区前的内容 → 未归类前导部分（原文逐字保留）', '⤷ Content before the sections → unclassified preamble (kept verbatim)')}</span>
                    <pre className="max-h-28 overflow-auto whitespace-pre-wrap rounded border p-2" style={{ borderColor: 'var(--color-border)' }}>{parsed.content.docPreamble}</pre>
                  </li>
                )}
                {parsed && parsed.content.sections.length === 0 && (
                  <li>{text('（未识别到一级分区，全部内容将保留在前导散块中）', '(no top-level sections detected; all content is kept in the preamble)')}</li>
                )}
              </ul>
            </div>

            {incomingScenes.length > 0 && (
              <div>
                <Label>{text('分镜清单（逐场分镜拆解）', 'Scene list (storyboard)')}</Label>
                <ul className="text-xs space-y-1" style={{ color: 'var(--color-text-secondary)' }} data-testid="blueprint-v2-preview-scenes">
                  {incomingScenes.map((scene, index) => {
                    const matched = matchedByIncoming?.get(scene.sceneId)
                    return (
                      <li key={scene.sceneId}>
                        {`#${index + 1}`} {scene.title}
                        {matched && (
                          <span className="ml-1" style={{ color: 'var(--color-success-text)' }}>
                            {text('（沿用原分镜 ID）', '(keeps the existing scene ID)')}
                          </span>
                        )}
                      </li>
                    )
                  })}
                  {removedScenes.map(scene => (
                    <li key={scene.sceneId} style={{ color: 'var(--color-error-text)' }}>
                      {text('将被移除：', 'Will be removed: ')}{scene.title}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="text-xs space-y-1" style={{ color: 'var(--color-text-muted)' }}>
              <p>
                {text('字数预算：', 'Word budget: ')}
                {wordBudget ?? text('（未识别）', '(not detected)')}
              </p>
              <p>
                {text(
                  '保存时将同步投影 v1 字段（标题/核心目的/关键事件/悬念钩子）；role、出场角色、作者微操指导与定稿要点不会被改动。',
                  'Saving also refreshes the v1 projection (title / purpose / key events / suspense hook); role, characters, author guidance, and finalized notes are never touched.',
                )}
              </p>
            </div>
            {error && (
              <p className="text-xs" style={{ color: 'var(--color-error-text)' }} role="alert">{error}</p>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 'input' ? (
            <>
              <Button variant="ghost" onClick={onClose} data-testid="blueprint-v2-import-cancel">
                {text('取消', 'Cancel')}
              </Button>
              <Button onClick={() => void enterPreview()} disabled={loadingPreview} data-testid="blueprint-v2-import-preview-btn">
                {text('解析预览', 'Parse & preview')}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => { setStep('input'); setError('') }}>
                {text('返回修改', 'Back to edit')}
              </Button>
              <Button variant="ghost" onClick={onClose} data-testid="blueprint-v2-import-cancel-preview">
                {text('取消（不保存）', 'Cancel (no writes)')}
              </Button>
              <Button
                onClick={() => void handleApply()}
                disabled={applying || loadingPreview || existingLookupFailed || existingDetail?.readStatus !== undefined || targetChapter === null || !parsed}
                data-testid="blueprint-v2-import-confirm"
              >
                {applying ? text('导入中…', 'Importing…') : text('确认导入', 'Confirm import')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
