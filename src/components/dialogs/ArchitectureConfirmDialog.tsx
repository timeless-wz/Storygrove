import { useCallback, useEffect, useRef, useState } from 'react'
import { Wand2, AlertCircle, AlertTriangle, Check, ChevronDown, ChevronRight } from 'lucide-react'
import { useProjectStore } from '../../stores/project-store'
import { guardArchitectureGeneration, guardCharacterRegeneration } from '../../services/workflow-guards'
import {
  ARCH_STEP_ORDER,
  createDefaultArchitectureSelection,
  getMissingArchitecturePrerequisites,
  getRequiredArchitectureSteps,
  includeMissingArchitecturePrerequisites,
  type ArchStepKey,
  type ArchitectureLaunchMode,
} from '../../services/architecture-step-selection'
import { toast } from '../ui/Toast'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Textarea } from '../ui/Textarea'
import { useLocaleStore } from '../../stores/locale-store'
import { AUDIENCE_EN, GENRE_EN } from '../editor/novel-config-labels'
import { openArchFile, openBuiltinEditor } from '../panels/sidebar/sidebar-file-openers'

const ARCH_FILES: Array<{
  key: ArchStepKey
  label: string
  labelEn: string
  input: string
  inputEn: string
  output: string
  outputEn: string
}> = [
  {
    key: 'premise',
    label: '故事前提',
    labelEn: 'Story premise',
    input: '输入：创作方向中的核心构想、类型与写作要求。',
    inputEn: 'Input: core ideas, genre, and writing requirements from Creative Direction.',
    output: '输出：故事前提文档；成功后替换当前故事前提。',
    outputEn: 'Output: the story-premise document; a successful run replaces the current premise.',
  },
  {
    key: 'characters',
    label: '角色资料',
    labelEn: 'Character profiles',
    input: '输入：故事前提与创作方向。',
    inputEn: 'Input: the story premise and Creative Direction.',
    output: '输出：结构化角色档案；角色图谱由档案投影，不另存可编辑副本。已有章节蓝图时会阻止重生成。',
    outputEn: 'Output: the structured character roster; the graph is projected from those profiles, not stored as a second editable copy. Regeneration is blocked when chapter blueprints exist.',
  },
  {
    key: 'worldbuilding',
    label: '世界观总纲',
    labelEn: 'Worldbuilding overview',
    input: '输入：故事前提与创作方向。',
    inputEn: 'Input: the story premise and Creative Direction.',
    output: '输出：世界观总纲文档；成功完成后写入正式总纲，未完成输出只保留为候选；不会自动创建世界、势力或秘境记录。',
    outputEn: 'Output: the worldbuilding overview; completed output updates the formal document, while incomplete output stays a candidate. It does not create world, faction, or secret-realm records.',
  },
  {
    key: 'synopsis',
    label: '兼容模式：全书总纲（按章范围）',
    labelEn: 'Legacy: book outline (chapter range)',
    input: '输入：故事前提、角色档案图谱、世界观总纲及写作参数。',
    inputEn: 'Input: the premise, projected character graph, worldbuilding overview, and writing parameters.',
    output: '兼容模式：沿用旧按章范围大纲命令；从第 1 章重写会替换该范围，连续续批保留已确认前缀；断点恢复只续写已校验检查点。',
    outputEn: 'Legacy mode: uses the existing chapter-range outline command; rewriting from chapter 1 replaces that range, contiguous batches retain the confirmed prefix, and checkpoint recovery resumes only the validated checkpoint.',
  },
]

interface Props {
  isOpen: boolean
  onClose: () => void
  /** Launch intent is explicit: batch, a single-document request, or one checkpoint resume. */
  launchMode: ArchitectureLaunchMode
  /** The actual availability of each formal architecture input. */
  archStatus: Record<string, boolean>
  /** Existing continuation range; it is not a checkpoint-resume flag. */
  initialSynopsisRange?: { from: number; to: number } | null
  onConfirm: (
    selectedSteps: ArchStepKey[],
    stepGuidance: Record<string, string>,
    synopsisRange: { from: number; to: number } | undefined,
    launchMode: ArchitectureLaunchMode,
  ) => Promise<void>
}

/** Default per-request scope for a long outline; the author can edit it. */
const SCOPE_WARNING_THRESHOLD = 20

export default function ArchitectureConfirmDialog({
  isOpen,
  onClose,
  launchMode,
  archStatus,
  initialSynopsisRange = null,
  onConfirm,
}: Props) {
  const currentProject = useProjectStore(s => s.currentProject)
  const text = useLocaleStore(s => s.text)
  const locale = useLocaleStore(s => s.locale)
  const modeKey = launchMode.kind === 'batch' ? 'batch' : `${launchMode.kind}:${launchMode.step}`

  const [checked, setChecked] = useState<Record<ArchStepKey, boolean>>(() => (
    createDefaultArchitectureSelection(launchMode)
  ))
  const wasOpen = useRef(false)
  const lastOpenMode = useRef<string | null>(null)
  const [stepGuidance, setStepGuidance] = useState<Record<string, string>>({})
  const [showGuidance, setShowGuidance] = useState(false)
  const [synopsisFrom, setSynopsisFrom] = useState('')
  const [synopsisTo, setSynopsisTo] = useState('')
  const [isConfirming, setIsConfirming] = useState(false)
  const [guardError, setGuardError] = useState<string | null>(null)

  const resetForLaunchMode = useCallback(() => {
    setChecked(createDefaultArchitectureSelection(launchMode))
    if (initialSynopsisRange) {
      setSynopsisFrom(String(initialSynopsisRange.from))
      setSynopsisTo(String(initialSynopsisRange.to))
    } else {
      const total = Number(currentProject?.novelConfig.totalChapters) || 0
      setSynopsisFrom(total > SCOPE_WARNING_THRESHOLD ? '1' : '')
      setSynopsisTo(total > SCOPE_WARNING_THRESHOLD ? String(SCOPE_WARNING_THRESHOLD) : '')
    }
    setGuardError(null)
  }, [currentProject?.novelConfig.totalChapters, initialSynopsisRange, launchMode])

  useEffect(() => {
    if (!isOpen) {
      wasOpen.current = false
      return
    }
    if (!wasOpen.current || lastOpenMode.current !== modeKey) {
      resetForLaunchMode()
      lastOpenMode.current = modeKey
    }
    wasOpen.current = true
  }, [isOpen, modeKey, resetForLaunchMode])

  if (!currentProject) return null

  const config = currentProject.novelConfig
  const genre = [text(config.genre, GENRE_EN[config.genre] ?? config.genre), config.subGenre]
    .filter(Boolean)
    .join(' · ')
  const audience = text(config.targetAudience, AUDIENCE_EN[config.targetAudience] ?? config.targetAudience)
  const selectedSteps = ARCH_STEP_ORDER.filter(step => checked[step])
  const noneSelected = selectedSteps.length === 0
  const configGuard = guardArchitectureGeneration(undefined, undefined, locale)
  const missingConfiguration = !configGuard.ok && configGuard.action === 'open-config'
  const requiredSteps = getRequiredArchitectureSteps(selectedSteps)
  const missingRequiredSteps = requiredSteps.filter(step => !archStatus[step])
  const unselectedPrerequisites = getMissingArchitecturePrerequisites(selectedSteps, archStatus)
  const hasUnselectedPrerequisites = unselectedPrerequisites.length > 0
  const isPinnedResume = launchMode.kind === 'resume'

  const toggleStep = (key: ArchStepKey) => {
    if (isPinnedResume) return
    setGuardError(null)
    setChecked(previous => ({ ...previous, [key]: !previous[key] }))
  }

  const handleIncludePrerequisites = () => {
    setChecked(previous => {
      const selected = ARCH_STEP_ORDER.filter(step => previous[step])
      const expanded = includeMissingArchitecturePrerequisites(selected, archStatus)
      return Object.fromEntries(ARCH_STEP_ORDER.map(step => [step, expanded.includes(step)])) as Record<ArchStepKey, boolean>
    })
    setGuardError(null)
  }

  const openPrerequisite = (target: 'config' | ArchStepKey) => {
    onClose()
    if (target === 'config') {
      openBuiltinEditor('config', text('创作方向', 'Creative Direction'), 'config')
      return
    }
    if (target === 'characters') {
      openBuiltinEditor('character-editor', text('角色档案', 'Character Profiles'), 'character')
      return
    }
    const file = ARCH_FILES.find(item => item.key === target)
    if (file) void openArchFile(`vela://core/${target}`, text(file.label, file.labelEn))
  }

  const totalChapters = Number(config.totalChapters) > 0 ? Number(config.totalChapters) : 0
  const resolveSynopsisRange = (): { ok: true; range?: { from: number; to: number } } | { ok: false } => {
    if (isPinnedResume || !checked.synopsis || totalChapters <= 0) return { ok: true }
    const parseBound = (value: string): { empty: true } | { empty: false; value: number } | null => {
      if (!value.trim()) return { empty: true }
      const parsed = Number(value)
      return Number.isSafeInteger(parsed) && parsed > 0 ? { empty: false, value: parsed } : null
    }
    const parsedFrom = parseBound(synopsisFrom)
    const parsedTo = parseBound(synopsisTo)
    if (!parsedFrom || !parsedTo) return { ok: false }
    const from = parsedFrom.empty ? 1 : parsedFrom.value
    const to = parsedTo.empty ? totalChapters : parsedTo.value
    if (from > totalChapters || to > totalChapters || from > to) return { ok: false }
    return from === 1 && to === totalChapters
      ? { ok: true }
      : { ok: true, range: { from, to } }
  }

  const handleConfirm = async () => {
    if (noneSelected || hasUnselectedPrerequisites) return
    setIsConfirming(true)
    try {
      if (!configGuard.ok) {
        setGuardError(configGuard.message || text('配置校验失败', 'Configuration validation failed.'))
        return
      }

      const resolution = resolveSynopsisRange()
      if (!resolution.ok) {
        setGuardError(text(
          `全书总纲兼容模式的按章范围无效：应在第 1–${totalChapters} 章之间且起始章 ≤ 结束章。`,
          `Invalid legacy book-outline chapter range: it must stay within chapters 1-${totalChapters} with from ≤ to.`,
        ))
        return
      }

      if (selectedSteps.includes('characters') && archStatus.characters) {
        const charGuard = await guardCharacterRegeneration(undefined, locale)
        if (!charGuard.ok) {
          setGuardError(charGuard.message || text('角色档案不可重新生成', 'Character profiles cannot be regenerated.'))
          return
        }
      }

      setGuardError(null)
      await onConfirm(selectedSteps, stepGuidance, resolution.range, launchMode)
      onClose()
      const stepNames = selectedSteps.map(key => {
        const item = ARCH_FILES.find(file => file.key === key)
        return item ? text(item.label, item.labelEn) : ''
      }).filter(Boolean).join(text('、', ', '))
      const verb = launchMode.kind === 'resume'
        ? text('正在从检查点继续', 'Resuming from checkpoint')
        : text('正在生成', 'Generating')
      toast.info(text(`已提交：${verb}${stepNames}...`, `Submitted: ${verb} ${stepNames}...`))
    } catch (error) {
      setGuardError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsConfirming(false)
    }
  }

  const handleOpenChange = (open: boolean) => {
    if (!open) onClose()
  }

  const modeSummary = launchMode.kind === 'batch'
    ? text('批量选择：四项默认均不勾选。', 'Batch selection: all four steps start unchecked.')
    : launchMode.kind === 'resume'
      ? text(`检查点恢复：仅继续「${ARCH_FILES.find(file => file.key === launchMode.step)?.label ?? launchMode.step}」，使用原检查点。`, `Checkpoint resume: continue only “${ARCH_FILES.find(file => file.key === launchMode.step)?.labelEn ?? launchMode.step}” using its existing checkpoint.`)
      : text(`单项请求：默认只选择「${ARCH_FILES.find(file => file.key === launchMode.step)?.label ?? launchMode.step}」；其他步骤须由你明确选择。`, `Single request: only “${ARCH_FILES.find(file => file.key === launchMode.step)?.labelEn ?? launchMode.step}” is preselected; choose any additional steps explicitly.`)

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[min(760px,calc(100vw-2rem))] max-w-[760px]" style={{ width: 'min(760px, calc(100vw - 32px))', maxWidth: 760 }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 size={16} className="text-[var(--color-accent)]" />
            {text('生成基础设定', 'Generate Basic Settings')}
          </DialogTitle>
          <DialogDescription>
            {text('先确认本次输入、输出和写入影响；未选择的内容不会启动生成。', 'Review the inputs, outputs, and write effects before starting. Unselected content will not be generated.')}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[min(68vh,680px)] overflow-y-auto px-5 py-3 space-y-4">
          <div className="rounded-lg px-3 py-2 text-xs" role="note" style={{ backgroundColor: 'var(--color-panel)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
            {modeSummary}
          </div>

          <div
            className="rounded-lg p-3 space-y-1.5 text-xs"
            style={{ backgroundColor: 'var(--color-panel)', border: '1px solid var(--color-border)' }}
          >
            <p className="font-medium text-[0.7rem] mb-2" style={{ color: 'var(--color-text-muted)' }}>
              {text('当前创作方向输入', 'Current Creative Direction inputs')}
            </p>
            <div className="grid grid-cols-2 gap-1">
              <ConfigRow label={text('类型', 'Genre')} value={genre} />
              <ConfigRow label={text('受众', 'Audience')} value={audience} />
              <ConfigRow label={text('总章数', 'Chapters')} value={text(`${config.totalChapters} 章`, `${config.totalChapters}`)} />
              <ConfigRow label={text('每章字数', 'Words/chapter')} value={text(`${config.wordsPerChapter} 字`, `${config.wordsPerChapter} words`)} />
            </div>
            {config.coreOutline && (
              <p
                className="mt-1.5 pt-1.5 text-xs"
                style={{ borderTop: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
              >
                {config.coreOutline.slice(0, 80)}{config.coreOutline.length > 80 ? '...' : ''}
              </p>
            )}
          </div>

          {missingConfiguration && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs" style={{ borderColor: 'var(--color-warning)', backgroundColor: 'var(--color-panel)', color: 'var(--color-warning-text)' }}>
              <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="m-0 whitespace-pre-line">{configGuard.message}</p>
                <Button variant="ghost" size="sm" className="mt-1 h-7 px-2" onClick={() => openPrerequisite('config')}>
                  {text('去填写创作方向', 'Fill in Creative Direction')}
                </Button>
              </div>
            </div>
          )}

          <fieldset className="rounded-lg p-3 space-y-2.5" style={{ backgroundColor: 'var(--color-panel)', border: '1px solid var(--color-border)' }}>
            <legend className="sr-only">{text('基础设定生成步骤', 'Basic-setting generation steps')}</legend>
            <div className="flex items-center justify-between gap-3 mb-1">
              <p className="m-0 text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                {text('生成步骤', 'Generation steps')}
              </p>
              {launchMode.kind !== 'resume' && (
                <button
                  type="button"
                  onClick={() => {
                    setGuardError(null)
                    setChecked(Object.fromEntries(ARCH_STEP_ORDER.map(step => [step, true])) as Record<ArchStepKey, boolean>)
                  }}
                  className="rounded px-1 text-xs underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {text('明确全选', 'Select all explicitly')}
                </button>
              )}
            </div>

            {ARCH_FILES.map(file => {
              const exists = Boolean(archStatus[file.key])
              const isChecked = checked[file.key]
              const isPinnedStep = launchMode.kind === 'resume' && launchMode.step === file.key
              const isDisabled = launchMode.kind === 'resume' && !isPinnedStep
              return (
                <div key={file.key} className="rounded-md border px-2.5 py-2" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg)' }}>
                  <label className={`flex items-start gap-2.5 select-none ${isDisabled ? 'cursor-not-allowed opacity-55' : 'cursor-pointer'} focus-within:outline focus-within:outline-2 focus-within:outline-[var(--color-accent)]`}>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={isChecked}
                      disabled={isPinnedResume || isConfirming}
                      onChange={() => toggleStep(file.key)}
                      aria-label={text(`${file.label}生成步骤`, `${file.labelEn} generation step`)}
                    />
                    <span aria-hidden="true" className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded transition-all" style={{ backgroundColor: isChecked ? 'var(--color-accent)' : 'transparent', border: `1.5px solid ${isChecked ? 'var(--color-accent)' : 'var(--color-border)'}`, color: 'var(--color-bg)' }}>
                      {isChecked && <Check size={10} strokeWidth={2} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium" style={{ color: isChecked ? 'var(--color-text)' : 'var(--color-text-muted)' }}>{text(file.label, file.labelEn)}</span>
                        {isPinnedStep && <span className="rounded px-1.5 py-0.5 text-[0.65rem]" style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-bg)' }}>{text('固定恢复项', 'Pinned resume step')}</span>}
                        <span className="rounded px-1.5 py-0.5 text-[0.65rem]" style={{ backgroundColor: exists ? 'color-mix(in srgb, var(--color-success) 12%, transparent)' : 'color-mix(in srgb, var(--color-warning) 12%, transparent)', color: exists ? 'var(--color-success-text)' : 'var(--color-warning-text)' }}>
                          {exists
                            ? text(isChecked ? '已有内容 · 本次会写入' : '已有内容 · 保留', isChecked ? 'Existing content · written this run' : 'Existing content · kept')
                            : text(isChecked ? '暂无正式内容 · 本次写入' : '内容缺失或不足', isChecked ? 'No formal content · written this run' : 'Content missing or incomplete')}
                        </span>
                      </span>
                      <span className="mt-1 block text-[0.7rem] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{text(file.input, file.inputEn)}</span>
                      <span className="block text-[0.7rem] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>{text(file.output, file.outputEn)}</span>
                    </span>
                  </label>
                </div>
              )
            })}
          </fieldset>

          {missingRequiredSteps.length > 0 && (
            <div role={hasUnselectedPrerequisites ? 'alert' : 'status'} className="rounded-lg border p-3 space-y-2" style={{ borderColor: hasUnselectedPrerequisites ? 'var(--color-warning)' : 'var(--color-border)', backgroundColor: 'var(--color-panel)' }}>
              <div className="flex items-start gap-2 text-xs" style={{ color: hasUnselectedPrerequisites ? 'var(--color-warning-text)' : 'var(--color-text-secondary)' }}>
                <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                <p className="m-0">
                  {hasUnselectedPrerequisites
                    ? text('所选步骤缺少前置内容；可先去填写，或明确把缺少的生成步骤加入本次任务。', 'The selected steps are missing prerequisites. Add the content first, or explicitly include its generation steps in this run.')
                    : text('以下缺少的前置内容已明确加入本轮，会按步骤顺序先生成。', 'The missing prerequisites below are explicitly included and will run first in dependency order.')}
                </p>
              </div>
              <ul className="m-0 list-none space-y-1 pl-5">
                {missingRequiredSteps.map(step => {
                  const item = ARCH_FILES.find(file => file.key === step)!
                  return (
                    <li key={step} className="flex flex-wrap items-center gap-2 text-xs">
                      <span style={{ color: checked[step] ? 'var(--color-success-text)' : 'var(--color-warning-text)' }}>
                        {text(item.label, item.labelEn)} · {checked[step] ? text('本轮将先生成', 'scheduled before dependent steps') : text('当前缺失', 'currently missing')}
                      </span>
                      <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={() => openPrerequisite(step)}>
                        {text('去填写', 'Open to edit')}
                      </Button>
                    </li>
                  )
                })}
              </ul>
              {hasUnselectedPrerequisites && launchMode.kind !== 'resume' && (
                <Button variant="outline" size="sm" className="ml-5 h-7" onClick={handleIncludePrerequisites}>
                  {text('加入所需生成步骤', 'Add required generation steps')}
                </Button>
              )}
            </div>
          )}

          {checked.synopsis && !isPinnedResume && totalChapters > 0 && (
            <div className="rounded-lg p-3 space-y-2" style={{ backgroundColor: 'var(--color-panel)', border: '1px solid var(--color-border)' }}>
              <div className="flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--color-warning-text)' }}>
                <AlertTriangle size={13} />
                {text('兼容模式：全书总纲 · 本次按章范围', 'Legacy mode: book outline · chapter range')}
              </div>
              <p role="note" className="m-0 text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                {totalChapters > SCOPE_WARNING_THRESHOLD
                  ? text(
                      `全书共 ${totalChapters} 章，默认本次生成第 1–20 章。若这些章节已有大纲，本次会按命令校验后重写所选范围；连续续批请从已覆盖章节的下一章开始。`,
                      `The book has ${totalChapters} chapters; this run defaults to chapters 1-20. Existing outline text in this range may be rewritten after command validation. For a contiguous batch, start after the last covered chapter.`,
                    )
                  : text(
                      `全书共 ${totalChapters} 章；从第 1 章重新生成会覆盖所选范围，连续续批请从已覆盖章节的下一章开始。`,
                      `The book has ${totalChapters} chapters. Regenerating from chapter 1 replaces the selected range; contiguous batches start after the last covered chapter.`,
                    )}
              </p>
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span style={{ color: 'var(--color-text-muted)' }}>{text('第', 'From ch.')}</span>
                <input type="number" min={1} max={totalChapters} value={synopsisFrom} onChange={event => setSynopsisFrom(event.target.value)} placeholder="1" aria-label={text('本次生成范围的起始章', 'First chapter of this batch')} className="w-20 rounded-md px-2 py-1.5 text-xs outline-none" style={{ color: 'var(--color-text)', backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }} />
                <span style={{ color: 'var(--color-text-muted)' }}>{text('章 到第', 'to ch.')}</span>
                <input type="number" min={1} max={totalChapters} value={synopsisTo} onChange={event => setSynopsisTo(event.target.value)} placeholder={String(totalChapters)} aria-label={text('本次生成范围的结束章', 'Last chapter of this batch')} className="w-20 rounded-md px-2 py-1.5 text-xs outline-none" style={{ color: 'var(--color-text)', backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }} />
                <span style={{ color: 'var(--color-text-muted)' }}>{text('章（留空起始=1、结束=全书）', 'chapter (blank means chapter 1 / whole book)')}</span>
              </div>
            </div>
          )}

          {selectedSteps.length > 0 && !isPinnedResume && (
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
              <button type="button" className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium" style={{ color: 'var(--color-text-muted)', backgroundColor: 'var(--color-panel)' }} onClick={() => setShowGuidance(value => !value)}>
                {showGuidance ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {text('为每个步骤添加补充指导（可选）', 'Add optional guidance for each step')}
              </button>
              {showGuidance && (
                <div className="px-3 pb-3 space-y-3" style={{ backgroundColor: 'var(--color-panel)' }}>
                  {ARCH_FILES.filter(file => checked[file.key]).map(file => (
                    <div key={file.key}>
                      <label className="text-[0.7rem] font-medium mb-1 block" style={{ color: 'var(--color-text-muted)' }}>{text(file.label, file.labelEn)}</label>
                      <Textarea value={stepGuidance[file.key] || ''} onChange={event => setStepGuidance(previous => ({ ...previous, [file.key]: event.target.value }))} placeholder={text(`对「${file.label}」生成的特殊要求`, `Special requirements for “${file.labelEn}”`)} rows={2} className="text-xs" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {noneSelected && (
            <p role="alert" className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--color-error)', color: 'var(--color-error-text)', backgroundColor: 'color-mix(in srgb, var(--color-error) 10%, transparent)' }}>
              <AlertTriangle size={13} className="inline mr-1" />
              {text('请至少勾选一个步骤', 'Select at least one step.')}
            </p>
          )}
          {guardError && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs" style={{ borderColor: 'var(--color-warning)', color: 'var(--color-warning-text)', backgroundColor: 'color-mix(in srgb, var(--color-warning) 10%, transparent)' }}>
              <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
              <span className="whitespace-pre-line">{guardError}</span>
            </div>
          )}

          {selectedSteps.length > 0 && (
            <section aria-label={text('提交影响', 'Submission effects')} className="rounded-lg p-3" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-panel)' }}>
              <h3 className="m-0 mb-2 text-xs font-medium" style={{ color: 'var(--color-text)' }}>{text('提交前确认 · 本次实际写入', 'Review · actual writes in this run')}</h3>
              <ul className="m-0 list-disc space-y-1 pl-4 text-[0.7rem]" style={{ color: 'var(--color-text-secondary)' }}>
                {selectedSteps.map(step => {
                  const file = ARCH_FILES.find(item => item.key === step)!
                  const effect = launchMode.kind === 'resume'
                    ? text('只继续已保存的检查点，不启动其他生成步骤。', 'Continues the saved checkpoint without starting any other generation step.')
                    : text(file.output, file.outputEn)
                  const exists = Boolean(archStatus[step])
                  return <li key={step}><strong style={{ color: 'var(--color-text)' }}>{text(file.label, file.labelEn)}</strong> · {exists ? text('已有正式内容', 'formal content exists') : text('尚无正式内容', 'no formal content yet')} · {effect}</li>
                })}
              </ul>
            </section>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isConfirming}>{text('取消', 'Cancel')}</Button>
          <Button variant="default" onClick={handleConfirm} disabled={noneSelected || hasUnselectedPrerequisites || missingConfiguration || isConfirming}>
            <Wand2 size={13} />
            {isConfirming
              ? text('校验中...', 'Checking...')
              : launchMode.kind === 'resume'
                ? text('继续检查点（1/4）', 'Resume checkpoint (1/4)')
                : text(`确认生成（${selectedSteps.length}/4）`, `Generate (${selectedSteps.length}/4)`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  const text = useLocaleStore(s => s.text)
  return (
    <div className="flex min-w-0 items-center gap-1 text-xs">
      <span className="shrink-0" style={{ color: 'var(--color-text-muted)' }}>{label}:</span>
      <span className="min-w-0 truncate" style={{ color: 'var(--color-text)' }} title={value || undefined}>{value || text('未填写', 'Not set')}</span>
    </div>
  )
}
