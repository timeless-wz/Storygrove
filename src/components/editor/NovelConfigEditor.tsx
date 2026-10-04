import { cloneElement, isValidElement, useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, Save, Sparkles, Info } from 'lucide-react'
import { useProjectStore } from '../../stores/project-store'
import { registerEditorExitSaveHandler } from '../../stores/editor-store'
import { useLLMStore } from '../../stores/llm-store'
import { useWorkflowStore, workflowResourceKey } from '../../stores/workflow-store'
import type { NovelConfig } from '../../shared/ipc-channels'
import { sameProjectSessionContext } from '../../shared/project-session-context'
import {
  resolveWritingLanguage,
  type WritingLanguage,
} from '../../shared/writing-language'
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
import { openCreativeMaterialsView } from '../panels/sidebar/sidebar-file-openers'
import VditorProseEditor from './VditorProseEditor'
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
  const text = useLocaleStore(s => s.text)
  const [generateSession, setGenerateSession] = useState<ReturnType<typeof captureProjectSession>>(null)

  const activeConfigWorkflow = useWorkflowStore(s => s.activeRuns.find(run => (
    currentProjectSession != null
    && sameProjectSessionContext(currentProjectSession, run.projectSession)
    && run.resourceKeys?.includes(workflowResourceKey('novel-config')) === true
  )) ?? null)
  const configWorkflowRunning = activeConfigWorkflow != null

  // 直接从 Store 读取配置 — 单一数据源，无需 local state 镜像
  const projectMatches = currentProject?.path === projectKey
  const config = projectMatches ? currentProject.novelConfig : null
  const exitSaveRef = useRef<() => Promise<void>>(async () => undefined)
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

  const genres = ['玄幻', '仙侠', '都市', '科幻', '历史', '军事', '游戏', '末世', '悬疑', '灵异', '言情', '古言', '现言', '奇幻', '武侠', '轻小说', '同人', '职场']

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
                '这里维护作品定位、目标读者、阅读体验、创作原则和写作参数。故事事实、人物档案、世界规则与剧情计划分别在对应入口维护。旧配置原文可在“待整理旧内容”查看。',
                'Maintain positioning, audience, reading experience, creative principles, and writing parameters here. Story facts, characters, world rules, and plot plans live in their dedicated pages. Legacy configuration remains available under Unorganized legacy content.',
              )}
            </p>
          </div>
          <div className="novel-config-page__header-actions">
            <Button type="button" variant="ai" onClick={handleAIGenerate} disabled={configWorkflowRunning}>
              <Sparkles size={13} /> {text('生成初始构想', 'Generate initial ideas')}
            </Button>
            <Button type="button" variant="outline" onClick={() => void handleSave()} disabled={saving}>
              <Save size={13} /> {saving ? text('保存中...', 'Saving...') : text('保存', 'Save')}
            </Button>
          </div>
        </header>

        <nav className="novel-config-page__section-nav" aria-label={text('创作方向分区', 'Creative direction sections')}>
          <a className="novel-config-page__section-link" href="#novel-config-basic">
            {text('定位与参数', 'Positioning and parameters')}
          </a>
          <a className="novel-config-page__section-link" href="#novel-config-ideas">
            {text('创作原则', 'Creative principles')}
          </a>
          <a className="novel-config-page__section-link" href="#novel-config-writing">
            {text('写作规范', 'Writing rules')}
          </a>
          <a className="novel-config-page__section-link" href="#novel-config-legacy">{text('待整理旧内容', 'Legacy content')}</a>
        </nav>

        {/* 配置表单 */}
        <fieldset className="novel-config-page__fields">
          <legend className="sr-only">{text('创作方向配置字段', 'Creative direction configuration fields')}</legend>
          <div className="novel-config-page__form space-y-6">
          {/* 基本信息 */}
          <Section id="novel-config-basic" title={text('作品定位与写作参数', 'Positioning and writing parameters')}>
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



          {/* 创作方向：阅读体验与原则 */}
          <section id="novel-config-ideas" className="novel-config-page__group space-y-4" aria-labelledby="novel-config-ideas-heading">
            <div className="novel-config-page__group-heading">
              <h3 id="novel-config-ideas-heading">{text('创作方向', 'Creative direction')}</h3>
              <p>{text('上方维护类型、细分类型与目标读者；这里说明核心阅读体验和创作原则。不要在这里展开剧情、世界规则或人物档案。', 'The fields above capture genre and audience. Describe the intended reading experience and creative principles here, keeping plot, world rules, and character profiles in their dedicated pages.')}</p>
            </div>
            <Section title={text('核心阅读体验与创作原则', 'Reading experience and creative principles')} desc={text('回答希望读者获得什么体验、作品追求什么，以及具体的参考边界。', 'Explain what readers should experience, what the work values, and where references stop.')}>
              <div className="h-[360px] min-h-[280px] rounded-lg border border-[var(--color-border)] overflow-hidden">
                <VditorProseEditor content={config.creativeDirectionMarkdown ?? ''} onChange={markdown => update('creativeDirectionMarkdown', markdown)} placeholder={text('粘贴或编写 Markdown 创作方向；支持标题、列表、引用和表格。', 'Write or paste Markdown for the creative direction, including headings, lists, quotes, and tables.')} />
              </div>
            </Section>
            <Section title={text('参考作品与借鉴边界', 'Reference works and borrowing boundaries')} desc={text('说明参考作品、借鉴的具体方面，以及明确不采用的部分。', 'Name references, the elements you draw from, and what you will not reuse.')}>
              <div className="h-[240px] min-h-[200px] rounded-lg border border-[var(--color-border)] overflow-hidden">
                <VditorProseEditor content={config.referenceWorks ?? ''} onChange={markdown => update('referenceWorks', markdown)} placeholder={text('参考哪些作品？借鉴哪些方面？哪些元素不采用？', 'Which works inform this project, which aspects, and what is out of scope?')} />
              </div>
            </Section>
          </section>

          {/* 正文表达规范 */}
          <section id="novel-config-writing" className="novel-config-page__group space-y-4" aria-labelledby="novel-config-writing-heading">
            <div className="novel-config-page__group-heading">
              <h3 id="novel-config-writing-heading">{text('写作规范', 'Writing rules')}</h3>
              <p>{text('规定正文如何表达：叙述视角、文风、语言、对话与描写、节奏、禁忌和自检要求。故事事实请维护在正式设定入口。', 'Specify how prose is written: viewpoint, style, language, dialogue, description, pacing, restrictions, and self-checks. Keep story facts in formal settings.')}</p>
            </div>
            <Field label={text('叙述视角', 'Narrative viewpoint')} tipItems={[
              '第一人称：“我”视角叙事，代入感强，信息受限',
              '第三人称有限视角：跟随角色视角，兼顾代入感和灵活性',
              '第三人称全知视角：可进入不同角色内心',
              '多视角轮换：由多名角色交替叙事',
            ].map((item, index) => text(item, [
              'First person: immersive with intentionally limited information',
              'Third-person limited: follows a character viewpoint',
              'Third-person omniscient: can enter different characters’ minds',
              'Multiple POV: alternates among characters',
            ][index]))}>
              <NativeSelect value={config.narrativePOV || 'third_limited'} onChange={event => update('narrativePOV', event.target.value as NovelConfig['narrativePOV'])}>
                <option value="first_person">{text('第一人称', 'First person')}</option>
                <option value="third_limited">{text('第三人称有限视角', 'Third-person limited')}</option>
                <option value="third_omniscient">{text('第三人称全知视角', 'Third-person omniscient')}</option>
                <option value="multi_pov">{text('多视角轮换', 'Multiple POV')}</option>
              </NativeSelect>
            </Field>
            <Section title={text('正文执行规则', 'Prose rules')} desc={text('这里是正式写作规范；保存后由正文生成、续写与修稿工作流读取。', 'These are the authoritative rules read by drafting, continuation, and revision workflows.')}>
              <div className="h-[380px] min-h-[300px] rounded-lg border border-[var(--color-border)] overflow-hidden">
                <VditorProseEditor content={config.writingRulesMarkdown ?? ''} onChange={markdown => update('writingRulesMarkdown', markdown)} placeholder={text('填写文风、语言表达、对话和描写要求、节奏、禁忌及自检规则。', 'Describe style, language, dialogue, description, pacing, restrictions, and self-checks.')} />
              </div>
            </Section>
          </section>

          <details id="novel-config-legacy" className="novel-config-page__advanced">
            <summary>
              <ChevronDown size={16} aria-hidden="true" />
              <span>
                <strong>{text('初始构想与待整理旧内容', 'Initial ideas and legacy content')}</strong>
                <span>{text('旧字段保留用于追溯；正式内容建立后，先整理并确认再退出 AI 参考。', 'Legacy fields remain available for provenance; organize and confirm them after creating formal sources.')}</span>
              </span>
            </summary>
            <div className="novel-config-page__advanced-content space-y-3">
              <p className="text-xs leading-5 text-[var(--color-text-secondary)]">{text('旧故事构想、背景构想、主角优势、主角构想、全局要求与文风配置不会自动搬入正式内容。请按语义拆分归位并在目标页保存、回读，再到“待整理旧内容”确认。待整理副本会清楚标记为参考；正式资料建立后以正式资料为准。', 'Old story concepts, background, protagonist advantage/profile, global guidance, and style are not moved automatically. Organize them by meaning, save and reload the destinations, then confirm in Unorganized legacy content. Pending legacy text is reference-only; formal sources take precedence.')}</p>
              <Button type="button" variant="outline" onClick={() => openCreativeMaterialsView('legacy', text('待整理旧内容', 'Unorganized legacy content'))}>{text('查看待整理旧内容', 'Review unorganized legacy content')}</Button>
              <p className="text-xs text-[var(--color-text-secondary)]">{text('旧字段原文继续保留在项目配置中；本页不再用它们承担长期正式资料维护。', 'The original legacy fields remain in project configuration; this page no longer treats them as long-term authoritative content.')}</p>
            </div>
          </details>
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

/** 表单分组 */
function Section({
  id,
  title,
  desc,
  children,
  action,
}: {
  id?: string
  title: string
  desc?: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
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
        {action && <div className="novel-config-section__actions">{action}</div>}
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
