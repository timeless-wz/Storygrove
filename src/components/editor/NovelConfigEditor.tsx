import { cloneElement, isValidElement, useEffect, useId, useRef, useState } from 'react'
import { ArrowUpRight, ChevronDown, Save, Sparkles, Info, Loader2, RotateCcw } from 'lucide-react'
import { useProjectStore } from '../../stores/project-store'
import { registerEditorExitSaveHandler, useEditorStore } from '../../stores/editor-store'
import { CONFIG_DRAFT_TAB, getProjectEditorDraft, parseProjectEditorDraftLedger } from '../../stores/project-editor-draft-ledger'
import { useLayoutStore } from '../../stores/layout-store'
import { useLLMStore } from '../../stores/llm-store'
import { useWorkflowStore, workflowResourceKey } from '../../stores/workflow-store'
import type { NovelConfig } from '../../shared/ipc-channels'
import { sameProjectSessionContext } from '../../shared/project-session-context'
import {
  DEFAULT_NARRATIVE_THREAD_DORMANT_THRESHOLD,
  MAX_NARRATIVE_THREAD_DORMANT_THRESHOLD,
  MIN_NARRATIVE_THREAD_DORMANT_THRESHOLD,
  resolveNarrativeThreadDormantThreshold,
} from '../../shared/narrative-thread'
import {
  resolveWritingLanguage,
  type WritingLanguage,
} from '../../shared/writing-language'
import {
  GENERATABLE_FIELD_LABELS,
  type GeneratableField,
} from '../../services/workflows/novel-config-field-labels'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Textarea } from '../ui/Textarea'
import { NativeSelect } from '../ui/NativeSelect'
import GenerateConfigDialog from '../dialogs/GenerateConfigDialog'
import { useLocaleStore } from '../../stores/locale-store'
import {
  captureProjectSession,
  isProjectSessionCurrent,
  isProjectSessionPath,
} from '../project-session-gate'
import { AUDIENCE_EN, GENRE_EN } from './novel-config-labels'
import { openArchFile } from '../panels/sidebar/sidebar-file-openers'
import './novel-config-editor.css'

/** 小说配置编辑器 — Tab 内的可视化配置面板 */
export default function NovelConfigEditor({ projectKey }: { projectKey: string }) {
  const currentProject = useProjectStore(s => s.currentProject)
  const projectSession = captureProjectSession(currentProject)
  const sessionKey = projectSession && isProjectSessionPath(projectSession, projectKey)
    ? `${projectSession.projectId}:${projectSession.leaseId}`
    : `inactive:${projectKey}`

  // 同路径项目重新打开时强制重挂载，避免旧会话的保存/生成状态泄漏到新 lease。
  return <NovelConfigEditorSession key={sessionKey} projectKey={projectKey} />
}

function NovelConfigEditorSession({ projectKey }: { projectKey: string }) {
  // ✅ 用 selector 精确订阅：只有 currentProject 变化时才重新渲染
  //    不订阅 fileTree、recentProjects 等无关字段
  const currentProject = useProjectStore(s => s.currentProject)
  const currentProjectSession = captureProjectSession(currentProject)
  const updateNovelConfig = useProjectStore(s => s.updateNovelConfig)
  const saveProject = useProjectStore(s => s.saveProject)
  const defaultModelId = useLLMStore(s => s.defaultModelId)
  // ✅ addLog 用 getState() 命令式调用，不订阅 workflow store
  //    避免 AI 流式生成时 globalLogs 高频更新导致本组件被动重渲染
  const addLog = useWorkflowStore.getState().addLog
  const [saving, setSaving] = useState(false)
  const [showGenerateConfig, setShowGenerateConfig] = useState(false)
  const [navigationPending, setNavigationPending] = useState(false)
  const text = useLocaleStore(s => s.text)
  const [generateSession, setGenerateSession] = useState<ReturnType<typeof captureProjectSession>>(null)

  // 各区块的独立生成状态
  const [generatingField, setGeneratingField] = useState<GeneratableField | null>(null)
  const generatingFieldRef = useRef(false)
  const mountedRef = useRef(false)
  const activeConfigWorkflow = useWorkflowStore(s => s.activeRuns.find(run => (
    currentProjectSession != null
    && sameProjectSessionContext(currentProjectSession, run.projectSession)
    && run.resourceKeys?.includes(workflowResourceKey('novel-config')) === true
  )) ?? null)
  const activeWorkflowStepName = activeConfigWorkflow?.steps[activeConfigWorkflow.currentStepIndex]?.name
  const activeWorkflowField = activeConfigWorkflow
    ? (Object.entries(GENERATABLE_FIELD_LABELS).find(([, labels]) => (
      labels.some(label => label === activeWorkflowStepName)
    ))?.[0] as GeneratableField | undefined) ?? null
    : null
  const visibleGeneratingField = generatingField ?? activeWorkflowField
  const configWorkflowRunning = activeConfigWorkflow != null

  // 直接从 Store 读取配置 — 单一数据源，无需 local state 镜像
  const projectMatches = currentProject?.path === projectKey
  const config = projectMatches ? currentProject.novelConfig : null
  const exitSaveRef = useRef<() => Promise<void>>(async () => undefined)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  useEffect(() => {
    registerEditorExitSaveHandler({
      type: 'config',
      projectKey,
      save: async () => { await exitSaveRef.current() },
    })
  }, [projectKey])

  // 直接写 Store — 消除双向同步风险
  const update = <K extends keyof NovelConfig>(key: K, value: NovelConfig[K]) => {
    if (!config) return
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession || !isProjectSessionPath(projectSession, projectKey)) return
    updateNovelConfig({ [key]: value }, projectSession)
  }

  /** 保存配置 — Store 已是最新数据，仅需持久化到磁盘 */
  const handleSave = async (): Promise<boolean> => {
    const projectSession = captureProjectSession(currentProject)
    if (!config || saving || !projectSession || !isProjectSessionPath(projectSession, projectKey)) return false
    setSaving(true)
    try {
      const saved = await saveProject(projectSession)
      if (!isProjectSessionCurrent(projectSession)) return false
      if (!saved) throw new Error(text('项目配置未能写入磁盘', 'The project configuration could not be written to disk.'))
      addLog('info', text('创作方向已保存', 'Creative direction saved'))
      return true
    } catch (error) {
      if (!isProjectSessionCurrent(projectSession)) return false
      console.error('[NovelConfigEditor] 保存失败:', error)
      addLog('error', text(`保存失败：${error}`, `Save failed: ${error}`))
      return false
    } finally {
      if (isProjectSessionCurrent(projectSession)) setSaving(false)
    }
  }
  useEffect(() => {
    exitSaveRef.current = async () => { await handleSave() }
  })

  if (!config) return (
    <div className="h-full flex items-center justify-center" style={{ color: 'var(--color-text-muted)' }}>
      <span className="text-sm opacity-50">
        {projectMatches
          ? text('加载配置中...', 'Loading configuration...')
          : text('此标签属于另一个项目，请切回原项目后继续。', 'This tab belongs to another project. Switch back to continue.')}
      </span>
    </div>
  )

  /** AI 生成配置 — 打开弹框 */
  const handleAIGenerate = () => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession || !isProjectSessionPath(projectSession, projectKey)) return
    if (configWorkflowRunning) return
    if (!defaultModelId) {
      addLog('error', text('请先在设置中配置 AI 模型', 'Configure an AI model in Settings first.'))
      return
    }
    setGenerateSession(projectSession)
    setShowGenerateConfig(true)
  }

  /** 单字段 AI 生成 */
  const handleFieldGenerate = async (fieldKey: GeneratableField) => {
    if (generatingFieldRef.current || activeConfigWorkflow) return
    const project = useProjectStore.getState().currentProject
    const projectSession = captureProjectSession(project)
    if (!project || !projectSession || !isProjectSessionPath(projectSession, projectKey)) return
    const generationModelId = useLLMStore.getState().defaultModelId?.trim()
    if (!generationModelId) {
      addLog('error', text('请先在设置中配置 AI 模型', 'Configure an AI model in Settings first.'))
      return
    }

    generatingFieldRef.current = true
    setGeneratingField(fieldKey)
    try {
      if (!isProjectSessionCurrent(projectSession)) return
      const configSnapshot = Object.freeze({ ...project.novelConfig })
      const uiLocale = useLocaleStore.getState().locale
      const { createNovelConfigFieldWorkflow } = await import('../../services/workflows/novel-config-field-workflow')
      if (!isProjectSessionCurrent(projectSession)) return
      const definition = createNovelConfigFieldWorkflow({
        fieldKey,
        projectPath: project.path,
        projectSession,
        novelConfigSnapshot: configSnapshot,
        generationModelId,
        uiLocale,
      })
      const runId = await useWorkflowStore.getState().startWorkflow(definition)
      if (!isProjectSessionCurrent(projectSession)) return
      const terminalRun = useWorkflowStore.getState().history.find(run => run.id === runId)
      if (terminalRun?.status !== 'completed') return
      // The command has already used the single project-store update/save path;
      // re-read its authoritative value instead of applying a second local write.
      const refreshedProject = useProjectStore.getState().currentProject
      if (!sameProjectSessionContext(projectSession, captureProjectSession(refreshedProject))) return
    } catch (e) {
      if (!mountedRef.current || !isProjectSessionCurrent(projectSession)) return
      addLog('error', text(`生成失败：${e}`, `Generation failed: ${e}`))
    } finally {
      generatingFieldRef.current = false
      if (mountedRef.current && isProjectSessionCurrent(projectSession)) setGeneratingField(null)
    }
  }

  const genres = ['玄幻', '仙侠', '都市', '科幻', '历史', '军事', '游戏', '末世', '悬疑', '灵异', '言情', '古言', '现言', '奇幻', '武侠', '轻小说', '同人', '职场']
  const dormantThreshold = resolveNarrativeThreadDormantThreshold(
    config.narrativeThreadDormantChapterThreshold,
  )

  const hasUnsavedConfig = () => {
    const ledger = parseProjectEditorDraftLedger<NovelConfig>(
      useEditorStore.getState().draftLedgers[CONFIG_DRAFT_TAB.id],
    )
    return getProjectEditorDraft(ledger, projectKey) != null
  }

  const navigateAfterConfigSave = async (navigate: () => void | Promise<void>) => {
    if (saving || navigationPending) return
    const navigationSession = captureProjectSession(currentProject)
    if (!navigationSession || !isProjectSessionPath(navigationSession, projectKey)) return
    setNavigationPending(true)
    try {
      if (hasUnsavedConfig()) {
        const saved = await handleSave()
        if (!saved || !isProjectSessionCurrent(navigationSession)) return
        if (hasUnsavedConfig()) {
          addLog('error', text(
            '保存期间仍有新的配置修改，请保存后再打开关联页面。',
            'New configuration edits were made while saving. Save again before opening the linked page.',
          ))
          return
        }
      }
      if (!isProjectSessionCurrent(navigationSession)) return
      await navigate()
    } finally {
      if (isProjectSessionCurrent(navigationSession)) setNavigationPending(false)
    }
  }

  return (
    <div className="novel-config-page h-full overflow-y-auto">
      <div className="novel-config-page__content max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
        <header className="novel-config-page__header mb-5">
          <div className="min-w-0">
            <h2 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>
              {text('创作方向', 'Creative direction')}
            </h2>
            <p className="text-xs mt-1 leading-5" style={{ color: 'var(--color-text-muted)' }}>
              {text(
                '核心构想中的故事、背景、主角优势和主角构想仍会用于 AI 生成与正文写作。修改不会自动同步故事前提、世界观总纲或角色档案；设定改变后，请检查相关内容是否一致。',
                'The story, background, protagonist advantage, and protagonist concept in Core ideas continue to inform AI generation and prose writing. Changes do not automatically sync the story premise, worldbuilding overview, or character profiles; review related content for consistency after changing a setting.',
              )}
            </p>
          </div>
          <div className="novel-config-page__header-actions">
            <Button type="button" variant="ai" onClick={handleAIGenerate} disabled={navigationPending || configWorkflowRunning}>
              <Sparkles size={13} /> {text('AI 填充配置', 'Fill with AI')}
            </Button>
            <Button type="button" variant="outline" onClick={() => void handleSave()} disabled={saving || navigationPending}>
              <Save size={13} /> {saving ? text('保存中...', 'Saving...') : text('保存', 'Save')}
            </Button>
          </div>
        </header>

        <nav className="novel-config-page__section-nav" aria-label={text('创作方向分区', 'Creative direction sections')}>
          <a className="novel-config-page__section-link" href="#novel-config-basic">
            {text('基础信息', 'Basic information')}
          </a>
          <a className="novel-config-page__section-link" href="#novel-config-ideas">
            {text('核心构想', 'Core ideas')}
          </a>
          <a className="novel-config-page__section-link" href="#novel-config-writing">
            {text('写作要求', 'Writing requirements')}
          </a>
        </nav>

        {/* 配置表单 */}
        <fieldset className="novel-config-page__fields" disabled={navigationPending}>
          <legend className="sr-only">{text('创作方向配置字段', 'Creative direction configuration fields')}</legend>
          <div className="novel-config-page__form space-y-6">
          {/* 基本信息 */}
          <Section id="novel-config-basic" title={text('基础信息', 'Basic information')}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4 items-end">
              <Field label={text('写作语言', 'Writing language')} htmlFor="project-writing-language">
                <NativeSelect
                  id="project-writing-language"
                  value={resolveWritingLanguage(config.writingLanguage)}
                  onChange={(e) => update('writingLanguage', e.target.value as WritingLanguage)}
                >
                  <option value="zh-CN">{text('简体中文', 'Simplified Chinese')}</option>
                  <option value="en-US">English</option>
                </NativeSelect>
              </Field>
              <p className="col-span-2 text-xs leading-5 text-[var(--color-text-muted)]">
                {text(
                  '控制后续 AI 创作使用的内置指令语言；不会改变界面语言，也不会翻译已有内容。',
                  'Controls the built-in instruction language for future AI writing. It does not change the interface language or translate existing content.',
                )}
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Field label={text('类型', 'Genre')}>
                <NativeSelect value={config.genre} onChange={(e) => update('genre', e.target.value)}>
                  <option value="" disabled>{text('请选择类型', 'Select a genre')}</option>
                  {config.genre && !genres.includes(config.genre) && (
                    <option value={config.genre}>{config.genre}</option>
                  )}
                  {genres.map((g) => <option key={g} value={g}>{text(g, GENRE_EN[g] ?? g)}</option>)}
                </NativeSelect>
              </Field>
              <Field label={text('细分类型', 'Subgenre')}>
                <Input value={config.subGenre} onChange={(e) => update('subGenre', e.target.value)} placeholder={text('如：修仙/重生/末世', 'e.g. cultivation / rebirth / post-apocalyptic')} />
              </Field>
              <Field label={text('目标受众', 'Audience')}>
                <NativeSelect value={config.targetAudience} onChange={(e) => update('targetAudience', e.target.value)}>
                  <option value="" disabled>{text('请选择目标受众', 'Select an audience')}</option>
                  {config.targetAudience && !Object.hasOwn(AUDIENCE_EN, config.targetAudience) && (
                    <option value={config.targetAudience}>{config.targetAudience}</option>
                  )}
                  {Object.entries(AUDIENCE_EN).map(([value, labelEn]) => (
                    <option key={value} value={value}>{text(value, labelEn)}</option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
              <Field label={text('叙事视角', 'Point of view')} tipItems={[
                '第一人称："我"视角叙事，代入感最强，信息受限',
                '第三人称有限视角：跟随主角视角，兼顾代入感和灵活性，最常用',
                '第三人称全知视角：可自由切换角色内心，适合群像叙事',
                '多视角轮换：多名角色交替叙事，适合复杂群像故事',
              ].map((item, index) => text(item, [
                'First person: immersive and intentionally limited information',
                'Third-person limited: follows one viewpoint with flexibility',
                'Third-person omniscient: can enter any character’s perspective',
                'Multiple POV: alternates between several viewpoint characters',
              ][index]))}>
                <NativeSelect value={config.narrativePOV || 'third_limited'} onChange={(e) => update('narrativePOV', e.target.value as NovelConfig['narrativePOV'])}>
                  <option value="first_person">{text('第一人称', 'First person')}</option>
                  <option value="third_limited">{text('第三人称有限视角', 'Third-person limited')}</option>
                  <option value="third_omniscient">{text('第三人称全知视角', 'Third-person omniscient')}</option>
                  <option value="multi_pov">{text('多视角轮换', 'Multiple POV')}</option>
                </NativeSelect>
              </Field>
              <Field label={text('总章数', 'Total chapters')}>
                <Input
                  type="number"
                  value={config.totalChapters}
                  onChange={(e) => update('totalChapters', (e.target.value === '' ? '' : parseInt(e.target.value)) as number)}
                  onBlur={() => {
                    const v = Number(config.totalChapters)
                    if (!v || v < 1) update('totalChapters', 100)
                  }}
                  placeholder="100"
                  min={1}
                />
              </Field>
              <Field label={text('每章字数', 'Words per chapter')}>
                <Input
                  type="number"
                  value={config.wordsPerChapter}
                  onChange={(e) => update('wordsPerChapter', (e.target.value === '' ? '' : parseInt(e.target.value)) as number)}
                  onBlur={() => {
                    const v = Number(config.wordsPerChapter)
                    if (!v || v < 100) update('wordsPerChapter', 3000)
                  }}
                  placeholder="3000"
                  min={100}
                />
              </Field>
            </div>
            <p className="mt-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {text(
                `目标字数：${(Number(config.totalChapters) * Number(config.wordsPerChapter) || 0).toLocaleString()} 字（总章数 × 每章字数）`,
                `Target length: ${(Number(config.totalChapters) * Number(config.wordsPerChapter) || 0).toLocaleString()} words (chapters × words per chapter)`,
              )}
            </p>
          </Section>



          {/* 核心构想 */}
          <section id="novel-config-ideas" className="novel-config-page__group space-y-4" aria-labelledby="novel-config-ideas-heading">
            <div className="novel-config-page__group-heading">
              <h3 id="novel-config-ideas-heading">{text('核心构想', 'Core ideas')}</h3>
              <p>{text(
                '故事构想、背景构想、主角优势与主角构想分别保存在这里。',
                'Story, background, protagonist-advantage, and protagonist concepts are stored here as separate fields.',
              )}</p>
            </div>
          <Section
            title={text('故事构想', 'Story concept')}
            desc={text('故事构想是简要方向；故事前提负责展开核心故事。', 'The story concept sets a brief direction; the story premise develops the central story.')}
            aiFieldKey="coreOutline"
            generatingField={visibleGeneratingField}
            workflowRunning={configWorkflowRunning}
            onAIGenerate={handleFieldGenerate}
          >
            <Textarea value={config.coreOutline} onChange={(e) => update('coreOutline', e.target.value)} placeholder={text('简要写下故事方向，可由 AI 仅补充当前字段...', 'Capture the story direction; AI can expand this field only...')} rows={4} />
          </Section>

          {/* 背景构想 */}
          <Section
            title={text('背景构想', 'Background concept')}
            desc={text('背景构想记录简要想法；世界观总纲维护详细的共同规则。', 'The background concept captures brief ideas; the worldbuilding overview maintains the detailed shared rules.')}
            aiFieldKey="worldSetting"
            generatingField={visibleGeneratingField}
            workflowRunning={configWorkflowRunning}
            onAIGenerate={handleFieldGenerate}
            action={(
              <button
                type="button"
                className="novel-config-page__related-link"
                disabled={saving || navigationPending || configWorkflowRunning}
                title={configWorkflowRunning ? text('等待当前 AI 生成完成后再打开', 'Wait for the current AI generation to finish before opening') : undefined}
                onClick={() => void navigateAfterConfigSave(() => {
                  return openArchFile('vela://core/worldbuilding', text('世界观总纲', 'Worldbuilding overview'))
                })}
              >
                <ArrowUpRight size={13} aria-hidden="true" />
                {text('打开世界观总纲', 'Open worldbuilding overview')}
              </button>
            )}
          >
            <Textarea value={config.worldSetting} onChange={(e) => update('worldSetting', e.target.value)} placeholder={text('描述故事发生的背景、时代、力量体系、社会结构...', 'Describe the setting, era, power system, and social structure...')} rows={4} />
          </Section>

          {/* 金手指 */}
          <Section
            title={text('主角优势 / 核心卖点', 'Protagonist advantage / core hook')}
            desc={text('记录主角优势或核心卖点的简要方向；具体人物资料仍在角色档案维护。', 'Capture the brief direction for the protagonist’s advantage or core hook; maintain the detailed character profile in the character archive.')}
            aiFieldKey="goldenFinger"
            generatingField={visibleGeneratingField}
            workflowRunning={configWorkflowRunning}
            onAIGenerate={handleFieldGenerate}
          >
            <Textarea value={config.goldenFinger} onChange={(e) => update('goldenFinger', e.target.value)} placeholder={text('主角的独特优势或故事核心卖点...', 'Describe the protagonist’s unique advantage or the story’s core hook...')} rows={3} />
          </Section>

          {/* 主角构想 */}
          <Section
            title={text('主角构想', 'Protagonist concept')}
            desc={text('主角构想说明总体要求；具体人物资料、动机和关系由角色档案维护。', 'The protagonist concept captures overall requirements; the character archive maintains the detailed profile, motives, and relationships.')}
            aiFieldKey="protagonistProfile"
            generatingField={visibleGeneratingField}
            workflowRunning={configWorkflowRunning}
            onAIGenerate={handleFieldGenerate}
            action={(
              <button
                type="button"
                className="novel-config-page__related-link"
                disabled={saving || navigationPending || configWorkflowRunning}
                title={configWorkflowRunning ? text('等待当前 AI 生成完成后再打开', 'Wait for the current AI generation to finish before opening') : undefined}
                onClick={() => void navigateAfterConfigSave(() => {
                  useLayoutStore.getState().openCharacterProfile('edit')
                })}
              >
                <ArrowUpRight size={13} aria-hidden="true" />
                {text('打开角色档案', 'Open character profile')}
              </button>
            )}
          >
            <Textarea value={config.protagonistProfile} onChange={(e) => update('protagonistProfile', e.target.value)} placeholder={text('主角的性格特征、背景故事、核心目标...', 'Personality traits, backstory, and central goal...')} rows={4} />
          </Section>

          </section>

          {/* 全局写作要求 */}
          <section id="novel-config-writing" className="novel-config-page__group space-y-4" aria-labelledby="novel-config-writing-heading">
            <div className="novel-config-page__group-heading">
              <h3 id="novel-config-writing-heading">{text('写作要求', 'Writing requirements')}</h3>
              <p>{text(
                '全局写作要求、文风与参考作品分别保存，供后续创作流程使用。',
                'Global guidance, writing style, and reference works are saved separately for later creative workflows.',
              )}</p>
            </div>
          <Section
            title={text('全局写作要求', 'Global writing guidance')}
            desc={text('写作风格、禁忌事项、节奏控制等全局规则（AI 填充配置时会自动生成）', 'Global rules for style, pacing, and content restrictions.')}
            aiFieldKey="globalGuidance"
            generatingField={visibleGeneratingField}
            workflowRunning={configWorkflowRunning}
            onAIGenerate={handleFieldGenerate}
          >
            <Textarea
              value={config.globalGuidance}
              onChange={(e) => update('globalGuidance', e.target.value)}
              placeholder={text('全局的写作风格要求、禁忌事项、特殊规则...', 'Global style requirements, restrictions, and special rules...')}
              rows={6}
            />
          </Section>

          {/* 文风配置 */}
          <Section
            title={text('文风配置', 'Writing style')}
            desc={text('AI 写稿/修稿时会严格遵循这里的风格要求。可手动填写或由 AI 自动生成。', 'AI follows these style requirements when drafting and revising. Enter them manually or generate with AI.')}
            aiFieldKey="writingStyle"
            generatingField={visibleGeneratingField}
            workflowRunning={configWorkflowRunning}
            onAIGenerate={handleFieldGenerate}
          >
            <Textarea
              value={config.writingStyle || ''}
              onChange={(e) => update('writingStyle', e.target.value)}
              placeholder={text('尚未配置。点击右上角「AI 生成」或手动填写…', 'Not configured. Generate with AI or enter a style manually...')}
              rows={6}
            />
          </Section>

          {/* 参考作品 */}
          <Section title={text('参考作品', 'Reference works')} desc={text('参考作品的风格、体系或机制，如：“参考《证道》的修炼体系”', 'Reference the style, setting, or mechanics of other works.')}>
            <Textarea value={config.referenceWorks || ''} onChange={(e) => update('referenceWorks', e.target.value)} placeholder={text('参考哪些作品的风格、设定或机制？（AI 架构生成时会参考）', 'Which works should inform the style, setting, or mechanics?')} rows={2} />
          </Section>
          </section>

          <details className="novel-config-page__advanced">
            <summary>
              <ChevronDown size={16} aria-hidden="true" />
              <span>
                <strong>{text('高级选项', 'Advanced options')}</strong>
                <span>{text('情节组织方式与质量、连续性配置', 'Plot structure, quality, and continuity settings')}</span>
              </span>
            </summary>
            <div className="novel-config-page__advanced-content space-y-4">
          {/*
           * 故事结构是创作约束：影响 AI 生成全书总纲时的组织方式，不是单独内容入口。
           */}
          <Section
            title={text('高级结构偏好', 'Advanced structure preference')}
            desc={text(
              '只影响 AI 生成「全书总纲」时的组织方式。全书总纲正文仍由章节蓝图统一维护。',
              'Only guides how AI organizes the book outline. The authoritative outline is maintained in Chapter Blueprints.',
            )}
          >
            <Field label={text('情节组织方式', 'Outline organization')} tipItems={[
              '三幕结构：经典的“建置→对抗→高潮”，适合大多数网文类型',
              '英雄之旅：神话学十二阶段，适合冒险/成长类，强调内在蜕变',
              '节拍表：好莱坞十五拍结构，节奏最精细，适合情感张力强的故事',
              '起承转合：中国传统四段式结构，适合古言/武侠/仙侠',
              '多线叙事：多条故事线并进交织，适合群像或复杂情节',
              '自由结构：不限定特定框架，AI 根据内容自适应，适合日常/轻小说',
            ].map((item, index) => text(item, [
              'Three-act structure: setup, confrontation, and climax; suitable for most genres',
              'Hero’s journey: a transformation-focused adventure structure',
              'Beat sheet: detailed pacing for emotionally intense stories',
              'Kishōtenketsu: a four-part East Asian structure',
              'Multi-thread: interwoven story lines for ensembles and complex plots',
              'Freeform: AI adapts the structure to the content',
            ][index]))}>
              <NativeSelect value={config.plotStructure || 'three_act'} onChange={(e) => update('plotStructure', e.target.value as NovelConfig['plotStructure'])}>
                <option value="three_act">{text('三幕结构', 'Three-act')}</option>
                <option value="heros_journey">{text('英雄之旅', 'Hero’s journey')}</option>
                <option value="save_the_cat">{text('节拍表', 'Beat sheet')}</option>
                <option value="kishotenketsu">{text('起承转合', 'Kishōtenketsu')}</option>
                <option value="multi_thread">{text('多线叙事', 'Multi-thread')}</option>
                <option value="freeform">{text('自由结构', 'Freeform')}</option>
              </NativeSelect>
            </Field>
          </Section>

          <Section
            title={text('质量与连续性', 'Quality and continuity')}
            desc={text(
              '控制叙事线索多久未推进后显示沉寂提醒；逾期状态仍按目标章节即时计算。',
              'Controls when an unadvanced narrative thread shows a dormant reminder. Overdue state is still computed from its target chapters.',
            )}
          >
            <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-4 items-end">
              <Field label={text('沉寂提醒阈值（章）', 'Dormant reminder threshold (chapters)')} htmlFor="narrative-thread-dormant-threshold">
                <Input
                  id="narrative-thread-dormant-threshold"
                  type="number"
                  min={MIN_NARRATIVE_THREAD_DORMANT_THRESHOLD}
                  max={MAX_NARRATIVE_THREAD_DORMANT_THRESHOLD}
                  value={dormantThreshold}
                  onChange={event => update(
                    'narrativeThreadDormantChapterThreshold',
                    resolveNarrativeThreadDormantThreshold(Number(event.target.value)),
                  )}
                />
              </Field>
              <Button
                type="button"
                variant="outline"
                onClick={() => update(
                  'narrativeThreadDormantChapterThreshold',
                  DEFAULT_NARRATIVE_THREAD_DORMANT_THRESHOLD,
                )}
              >
                <RotateCcw size={13} />{text('恢复默认值', 'Restore default')}
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              <span>{text('作用范围：当前项目', 'Scope: this project')}</span>
              <span>{text(
                `产品默认值：${DEFAULT_NARRATIVE_THREAD_DORMANT_THRESHOLD} 章`,
                `Product default: ${DEFAULT_NARRATIVE_THREAD_DORMANT_THRESHOLD} chapters`,
              )}</span>
              <span>{text(
                `当前生效值：${dormantThreshold} 章`,
                `Effective now: ${dormantThreshold} chapters`,
              )}</span>
            </div>
          </Section>

            </div>
          </details>
          </div>
        </fieldset>
      </div>

      {/* AI 生成配置弹框 */}
      <GenerateConfigDialog
        isOpen={showGenerateConfig}
        onClose={() => {
          setGenerateSession(null)
          setShowGenerateConfig(false)
        }}
        onGenerated={(parsed) => {
          const projectSession = generateSession
          if (!isProjectSessionCurrent(projectSession)) return
          // 只允许开启对话框时冻结的会话提交生成结果。
          updateNovelConfig(parsed, projectSession)
        }}
      />
    </div>
  )
}

/** 表单分组 — 支持右上角 AI 生成按钮 */
function Section({
  id,
  title,
  desc,
  children,
  action,
  aiFieldKey,
  generatingField,
  workflowRunning,
  onAIGenerate,
}: {
  id?: string
  title: string
  desc?: string
  children: React.ReactNode
  action?: React.ReactNode
  /** 对应 NovelConfig 中的字段 key，传入则显示 AI 生成按钮 */
  aiFieldKey?: GeneratableField
  /** 当前正在生成的字段（全局共享状态，防止并发） */
  generatingField?: GeneratableField | null
  /** 由工作流 store 报告的真实配置工作流生命周期，包括取消收尾阶段。 */
  workflowRunning?: boolean
  /** AI 生成回调 */
  onAIGenerate?: (fieldKey: GeneratableField) => void
}) {
  const text = useLocaleStore(s => s.text)
  const isGenerating = aiFieldKey != null && generatingField === aiFieldKey
  const isAnyGenerating = generatingField != null || workflowRunning === true
  const showAIButton = aiFieldKey != null && onAIGenerate != null
  const labelledChildren = isValidElement(children) && children.type === Textarea
    ? cloneElement(children as React.ReactElement<{ 'aria-label'?: string }>, { 'aria-label': title })
    : children

  return (
    <section id={id} className="novel-config-section p-4 rounded-xl bg-[var(--color-sidebar)] border border-[var(--color-border)]">
      <div className="novel-config-section__header mb-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">{title}</h3>
          {desc && <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{desc}</p>}
        </div>
        {(action || showAIButton) && (
          <div className="novel-config-section__actions">
            {action}
            {showAIButton && (
              <Button
                type="button"
                variant="ai"
                size="sm"
                onClick={() => onAIGenerate(aiFieldKey)}
                disabled={isAnyGenerating}
                title={isGenerating ? text('正在生成...', 'Generating...') : text(`AI 生成「${title}」`, `Generate “${title}” with AI`)}
              >
                {isGenerating
                  ? <Loader2 size={11} className="animate-spin" />
                  : <Sparkles size={11} />
                }
                {isGenerating ? text('生成中...', 'Generating...') : text('AI 生成', 'Generate with AI')}
              </Button>
            )}
          </div>
        )}
      </div>
      {labelledChildren}
    </section>
  )
}

/** 表单字段 */
function Field({
  label,
  htmlFor,
  tipItems,
  children,
}: {
  label: string
  htmlFor?: string
  tipItems?: string[]
  children: React.ReactNode
}) {
  const text = useLocaleStore(s => s.text)
  const [showTip, setShowTip] = useState(false)
  const generatedId = useId()
  const tipId = useId()
  const childId = isValidElement(children)
    ? (children.props as { id?: string }).id
    : undefined
  const controlId = htmlFor ?? childId ?? `novel-config-field-${generatedId}`
  const control = isValidElement(children)
    ? cloneElement(children as React.ReactElement<{ id?: string }>, { id: controlId })
    : children
  const helpLabel = text(`查看“${label}”说明`, `Help for ${label}`)

  return (
    <div>
      <div className="novel-config-field__label mb-1 flex items-center gap-1 text-xs font-medium text-[var(--color-text-muted)]">
        <label htmlFor={controlId}>{label}</label>
        {tipItems && tipItems.length > 0 && (
          <span
            className="novel-config-field__help"
            onMouseEnter={() => setShowTip(true)}
            onMouseLeave={() => setShowTip(false)}
          >
            <button
              type="button"
              aria-label={helpLabel}
              aria-expanded={showTip}
              aria-describedby={showTip ? tipId : undefined}
              onFocus={() => setShowTip(true)}
              onBlur={() => setShowTip(false)}
              onKeyDown={event => {
                if (event.key === 'Escape') setShowTip(false)
              }}
            >
              <Info size={12} aria-hidden="true" />
            </button>
            {showTip && (
              <div id={tipId} role="tooltip" className="novel-config-field__tooltip">
                {tipItems.map((item, i) => (
                  <div key={i} style={{ paddingLeft: 0 }}>
                    <span style={{ color: 'var(--color-accent)', fontWeight: 600 }}>{item.split(/：|: /)[0]}</span>
                    {item.includes('：') ? '：' + item.split('：').slice(1).join('：') : ': ' + item.split(': ').slice(1).join(': ')}
                  </div>
                ))}
              </div>
            )}
          </span>
        )}
      </div>
      {control}
    </div>
  )
}
