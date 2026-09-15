import { useState } from 'react'
import {
  Layers,
  Copy,
  Check,
  Save,
  AlertTriangle,
  Info,
  Ban,
  Clock,
  Sparkles,
  BookOpen,
} from 'lucide-react'
import { Button } from '../ui/Button'
import { useWorkspaceHubStore } from '../../stores/workspace-hub-store'
import { useLocaleStore } from '../../stores/locale-store'
import { confirm } from '../ui/Confirm'
import { toast } from '../ui/Toast'

export default function WorkspaceChapterContextTab() {
  const text = useLocaleStore(s => s.text)
  const bundle = useWorkspaceHubStore(s => s.chapterContextBundle)
  const targetChapterNumber = useWorkspaceHubStore(s => s.targetChapterNumber)
  const setTargetChapterNumber = useWorkspaceHubStore(s => s.setTargetChapterNumber)
  const budgetChars = useWorkspaceHubStore(s => s.budgetChars)
  const setBudgetChars = useWorkspaceHubStore(s => s.setBudgetChars)
  const includeCandidates = useWorkspaceHubStore(s => s.includeCandidates)
  const setIncludeCandidates = useWorkspaceHubStore(s => s.setIncludeCandidates)
  const assembleChapterContext = useWorkspaceHubStore(s => s.assembleChapterContext)
  const saveChapterContextSnapshot = useWorkspaceHubStore(s => s.saveChapterContextSnapshot)
  const loading = useWorkspaceHubStore(s => s.loading)

  const [copied, setCopied] = useState(false)
  const [activeInspectorTab, setActiveInspectorTab] = useState<'blocks' | 'omissions' | 'exclusions'>('blocks')

  const handleCopy = async () => {
    if (!bundle) return
    try {
      await navigator.clipboard.writeText(bundle.fullAssembledText)
      setCopied(true)
      toast.success(text('章节上下文包已复制到剪贴板', 'Chapter context bundle copied to clipboard'))
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(text('复制失败', 'Copy failed'))
    }
  }

  const handleSaveSnapshot = async () => {
    if (!bundle) return

    // 1. 规范只读快照确认框文案
    const ok = await confirm(
      text(
        `确定保存第${bundle.chapterNumber}章的只读上下文快照吗？该操作不会修改章节蓝图，也不会自动触发正文生成。`,
        `Are you sure you want to save the read-only context snapshot for Chapter ${bundle.chapterNumber}? This will not modify chapter blueprints or trigger text generation.`,
      ),
      {
        title: text('保存上下文快照', 'Save Context Snapshot'),
        confirmText: text('确认保存', 'Confirm Save'),
      },
    )
    if (!ok) return

    // 2. 超预算时的二次确认防护
    if (bundle.isOverBudget) {
      const forceOk = await confirm(
        text(
          `当前上下文已超出预算限制（超出 ${bundle.exceededChars} 字符）。确定要强制保存此【超预算快照】吗？\n超长上下文可能会导致后续模型处理截断或遗忘核心约束。`,
          `Current context exceeds budget by ${bundle.exceededChars} chars. Force save this over-budget snapshot? Long context may cause LLM truncation.`,
        ),
        {
          title: text('超预算快照二次确认', 'Over-budget Snapshot Confirmation'),
          confirmText: text('确认强制保存超预算快照', 'Force Save Over-Budget Snapshot'),
          danger: true,
        },
      )
      if (!forceOk) return
    }

    const success = await saveChapterContextSnapshot()
    if (success) {
      toast.success(text('上下文快照已保存。', 'Context snapshot saved.'))
    } else {
      toast.error(text('保存失败', 'Failed to save'))
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 顶部控制面板 */}
      <div className="flex items-center justify-between p-4 border-b text-xs shrink-0" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 font-medium">
            <Layers size={15} style={{ color: 'var(--color-accent)' }} />
            <span>{text('目标章节: 第', 'Target: Chapter ')}</span>
            <input
              type="number"
              min={1}
              value={targetChapterNumber}
              onChange={e => setTargetChapterNumber(parseInt(e.target.value, 10) || 1)}
              className="w-16 px-2 py-1 rounded border bg-transparent font-semibold text-center"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            />
            <span>{text('章', '')}</span>
          </div>

          <div className="flex items-center gap-1.5 opacity-80">
            <span>{text('上下文预算上限: ', 'Budget: ')}</span>
            <input
              type="number"
              min={1000}
              step={1000}
              value={budgetChars}
              onChange={e => setBudgetChars(parseInt(e.target.value, 10) || 16000)}
              className="w-20 px-2 py-1 rounded border bg-transparent text-center font-mono"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            />
            <span>{text('字符', 'chars')}</span>
          </div>

          {/* 明确的“预览候选内容”开关，默认关闭 */}
          <label className="flex items-center gap-1.5 cursor-pointer select-none text-[11px] ml-2 px-2 py-1 rounded border" style={{ borderColor: 'var(--color-border)' }}>
            <input
              type="checkbox"
              checked={includeCandidates}
              onChange={e => setIncludeCandidates(e.target.checked)}
              className="rounded"
            />
            <span className={includeCandidates ? 'text-[var(--color-warning-text)] font-semibold' : 'opacity-80'}>
              {text('预览候选内容', 'Preview Candidates')}
            </span>
          </label>

          <Button
            size="sm"
            disabled={loading}
            onClick={() => void assembleChapterContext()}
            className="text-xs gap-1.5 h-8 ml-2"
          >
            <Sparkles size={13} />
            {loading ? text('正在装配...', 'Assembling...') : text('生成本章上下文包', 'Assemble Chapter Bundle')}
          </Button>
        </div>

        {bundle && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleCopy}
              className="text-xs gap-1.5 h-8"
            >
              {copied ? <Check size={13} style={{ color: 'var(--color-success)' }} /> : <Copy size={13} />}
              {copied ? text('已复制', 'Copied') : text('一键复制', 'Copy Context')}
            </Button>

            <Button
              size="sm"
              onClick={handleSaveSnapshot}
              className="text-xs gap-1.5 h-8"
            >
              <Save size={13} />
              {text('保存上下文快照', 'Save Context Snapshot')}
            </Button>
          </div>
        )}
      </div>

      {/* 开启候选预览时的醒目警告条 */}
      {includeCandidates && (
        <div className="px-4 py-2 bg-amber-500/15 border-b text-[11px] flex items-center gap-2 text-[var(--color-warning-text)] shrink-0" style={{ borderColor: 'var(--color-border)' }}>
          <AlertTriangle size={14} className="shrink-0" />
          <span>
            {text(
              '⚠️ 警告：当前已开启【预览候选内容】。候选内容包含未经作者正式确认推导的角色或世界设定，仅用于临时预览，严禁作为故事定稿事实依赖！',
              '⚠️ Warning: Previewing candidate facts is enabled. Candidates are unverified assumptions and must not be used as authoritative canon.',
            )}
          </span>
        </div>
      )}

      {/* 超出预算时的明确字符统计与阻断提示 */}
      {bundle && bundle.isOverBudget && (
        <div className="px-4 py-2 bg-red-500/15 border-b text-[11px] flex items-center justify-between text-[var(--color-error-text)] shrink-0" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle size={14} className="shrink-0" />
            <span>
              {text(
                `⚠️ 上下文超出预算 ${bundle.exceededChars} 字符（预算上限: ${budgetChars} 字符，当前装配: ${bundle.totalCharCount} 字符）`,
                `⚠️ Context exceeds budget by ${bundle.exceededChars} chars (Limit: ${budgetChars}, Assembled: ${bundle.totalCharCount})`,
              )}
            </span>
          </div>
          <span className="text-[10px] opacity-80">
            {text('保存快照时将要求二次确认', 'Secondary confirmation required to save')}
          </span>
        </div>
      )}

      {/* 指示统计条 */}
      {bundle && (
        <div className="flex flex-wrap items-center gap-4 px-4 py-2 border-b text-[11px] shrink-0" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
          <div className="flex items-center gap-1 font-medium" style={{ color: 'var(--color-text)' }}>
            <span>{text(`总字符数: ${bundle.totalCharCount}`, `Characters: ${bundle.totalCharCount}`)}</span>
            <span className="opacity-70">({text(`预估 ~${bundle.estimatedTokens} Token`, `est. ~${bundle.estimatedTokens} Tokens`)})</span>
          </div>

          <div className="flex items-center gap-1">
            <span className="opacity-70">{text('装入模块: ', 'Blocks: ')}</span>
            <span className="font-semibold">{bundle.blocks.length}</span>
          </div>

          {bundle.excludedDeprecatedCount > 0 && (
            <div className="flex items-center gap-1 text-[var(--color-error-text)]">
              <Ban size={12} />
              <span>{text(`已主动排除 ${bundle.excludedDeprecatedCount} 项废案`, `${bundle.excludedDeprecatedCount} deprecated items excluded`)}</span>
            </div>
          )}

          {bundle.staleWarnings.length > 0 && (
            <div className="flex items-center gap-1 text-[var(--color-warning-text)]">
              <Clock size={12} />
              <span>{text(`存在 ${bundle.staleWarnings.length} 处已过期索引`, `${bundle.staleWarnings.length} stale locators`)}</span>
            </div>
          )}

          {bundle.candidateWarnings.length > 0 && (
            <div className="flex items-center gap-1 text-[var(--color-warning-text)]">
              <AlertTriangle size={12} />
              <span>{text(`包含 ${bundle.candidateWarnings.length} 项候选事实`, `${bundle.candidateWarnings.length} candidate facts included`)}</span>
            </div>
          )}

          {bundle.omissions.length > 0 && (
            <div className="flex items-center gap-1 text-[var(--color-info)]">
              <Info size={12} />
              <span>{text(`因预算省略 ${bundle.omissions.length} 处可选资料`, `${bundle.omissions.length} items omitted due to budget`)}</span>
            </div>
          )}
        </div>
      )}

      {/* 主展示区：左右分栏 */}
      {!bundle ? (
        <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
          <BookOpen size={36} className="mb-3 opacity-30" />
          <p className="font-medium text-base mb-1" style={{ color: 'var(--color-text)' }}>
            {text('按照确定性 13 阶段规则装配上下文', 'Deterministic 13-stage Context Assembly')}
          </p>
          <p className="text-xs max-w-md leading-relaxed opacity-75">
            {text(
              '输入目标章节号并点击“生成本章上下文包”，系统将按创作总则、已确认设定、细纲、角色名单、动态连续性、伏笔、近期证据到风格规范的确定性顺序合成，并严格排除废案。',
              'Enter target chapter number to assemble context across principles, settings, detailed outline, roster, continuity, narrative threads, and style constraints.',
            )}
          </p>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* 左侧：完整装配正文预览 */}
          <div className="flex-1 flex flex-col border-r overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
            <div className="px-3 py-1.5 border-b text-[11px] font-medium flex items-center justify-between" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-sidebar)' }}>
              <span>{text('装配产物正文预览 (只读)', 'Assembled Context Preview (Read-only)')}</span>
              <span className="font-mono text-[10px] opacity-70">{bundle.blocks.length} 个结构块</span>
            </div>
            <textarea
              readOnly
              value={bundle.fullAssembledText}
              className="flex-1 w-full p-4 font-mono text-xs leading-relaxed resize-none focus:outline-none overflow-y-auto"
              style={{
                backgroundColor: 'var(--color-editor-bg)',
                color: 'var(--color-text)',
              }}
            />
          </div>

          {/* 右侧：溯源检查与省略分析 */}
          <div className="w-80 flex flex-col overflow-hidden shrink-0" style={{ backgroundColor: 'var(--color-surface)' }}>
            {/* 检查页签 */}
            <div className="flex border-b text-xs shrink-0" style={{ borderColor: 'var(--color-border)' }}>
              <button
                onClick={() => setActiveInspectorTab('blocks')}
                className={`flex-1 py-2 font-medium text-center border-b-2 transition-colors ${
                  activeInspectorTab === 'blocks'
                    ? 'border-accent text-accent'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {text('来源拆解', 'Provenance')}
              </button>
              <button
                onClick={() => setActiveInspectorTab('omissions')}
                className={`flex-1 py-2 font-medium text-center border-b-2 transition-colors ${
                  activeInspectorTab === 'omissions'
                    ? 'border-accent text-accent'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {text('省略报告', 'Omissions')} ({bundle.omissions.length})
              </button>
              <button
                onClick={() => setActiveInspectorTab('exclusions')}
                className={`flex-1 py-2 font-medium text-center border-b-2 transition-colors ${
                  activeInspectorTab === 'exclusions'
                    ? 'border-accent text-accent'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {text('废案排除', 'Exclusions')} ({bundle.excludedDeprecatedCount})
              </button>
            </div>

            {/* 拆解详情内容 */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2 text-xs">
              {activeInspectorTab === 'blocks' && (
                bundle.blocks.map(b => (
                  <div
                    key={b.id}
                    className="border rounded p-2.5 space-y-1"
                    style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-sidebar)' }}
                  >
                    <div className="flex items-center justify-between font-medium" style={{ color: 'var(--color-text)' }}>
                      <span className="truncate flex-1">
                        {b.stage}. {b.stageName}
                      </span>
                      <span className="font-mono text-[10px] opacity-70 shrink-0">
                        {b.charCount} 字
                      </span>
                    </div>

                    <div className="text-[11px] text-muted-foreground truncate" title={b.title}>
                      {b.title}
                    </div>

                    <div className="text-[10px] opacity-60 flex items-center gap-1.5 pt-0.5 truncate font-mono">
                      <span>{b.sourceType === 'file' ? text('文件: ', 'File: ') : text('数据库: ', 'DB: ')}</span>
                      <span className="truncate">{b.sourceFile}</span>
                    </div>
                  </div>
                ))
              )}

              {activeInspectorTab === 'omissions' && (
                bundle.omissions.length === 0 ? (
                  <div className="p-6 text-center text-xs text-muted-foreground">
                    {text('本次装配在预算内完整容纳，无省略内容', 'No materials omitted in this assembly')}
                  </div>
                ) : (
                  bundle.omissions.map((om, idx) => (
                    <div
                      key={idx}
                      className="border rounded p-2.5 space-y-1 text-xs"
                      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-sidebar)' }}
                    >
                      <div className="flex items-center justify-between font-medium text-[var(--color-warning-text)]">
                        <span>{om.stage}. {om.stageName}</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/10 font-normal">
                          {text('超出预算', 'Budget exceeded')}
                        </span>
                      </div>
                      <div className="text-[11px] truncate" style={{ color: 'var(--color-text)' }}>
                        {om.title}
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {om.sourceInfo}
                      </div>
                    </div>
                  ))
                )
              )}

              {activeInspectorTab === 'exclusions' && (
                <div className="space-y-2 text-xs">
                  <div className="text-[11px] leading-relaxed p-2 rounded bg-red-500/10 text-[var(--color-error-text)]">
                    {text(
                      '已依据创作总则与设定规则，严格屏蔽废案与已淘汰设定。废案仅作为背景警示清单，严禁作为故事内事实注入正文。',
                      'Deprecated lore is strictly excluded from in-story facts.',
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {text(`本轮装配已排查并排除 ${bundle.excludedDeprecatedCount} 项废弃设定条目。`, `Excluded ${bundle.excludedDeprecatedCount} deprecated records.`)}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
