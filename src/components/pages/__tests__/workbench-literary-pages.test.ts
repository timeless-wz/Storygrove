import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('AI Novel Writer 首页、项目总览与新项目创作路径规范', () => {
  const welcomeSource = readSource('src/components/pages/WelcomePage.tsx')
  const overviewSource = readSource('src/components/pages/ProjectOverviewPage.tsx')
  const dialogSource = readSource('src/components/dialogs/NewProjectDialog.tsx')
  const cssSource = readSource('src/styles/literary-workbench.css')

  describe('WelcomePage (书斋首页)', () => {
    it('保留品牌与真实回调，支持新建、打开与拆解仿写', () => {
      expect(welcomeSource).toContain('APP_BRAND')
      expect(welcomeSource).toContain('onNewProject')
      expect(welcomeSource).toContain('onOpenProject')
      expect(welcomeSource).toContain('onImportNovel')
      expect(welcomeSource).toContain('拆解仿写')
      expect(welcomeSource).toContain('useProjectStore')
      expect(welcomeSource).toContain('recentProjects')
      expect(welcomeSource).toContain('openProject')
    })

    it('强化“继续创作”层级，不展示等权的三个巨大重复操作卡片', () => {
      expect(welcomeSource).toContain('literary-hero-primary-btn')
      expect(welcomeSource).toContain('继续创作')
      expect(welcomeSource).not.toContain('literary-quick-actions')
      expect(welcomeSource).not.toContain('literary-action-card')
    })

    it('书架具备拟物书册封面、新书立项插槽与真实资料检索提示', () => {
      expect(welcomeSource).toContain('literary-book-cover')
      expect(welcomeSource).toContain('literary-new-book-slot')
      expect(welcomeSource).toContain('新书立项')
      expect(welcomeSource).toContain('项目资料检索')
      expect(welcomeSource).toContain('已明确加入知识库的资料')
      expect(welcomeSource).not.toContain('Ctrl + F')
    })

    it('符合代码保洁约定：无直接 SVG/Path、无伪字符图标', () => {
      expect(welcomeSource).not.toMatch(/<svg\b|<path\b/)
      expect(welcomeSource).not.toMatch(/[\u2600-\u27BF]|[\u{1F300}-\u{1FAFF}]/u)
    })
  })

  describe('ProjectOverviewPage (项目总览)', () => {
    it('以真实进度与“继续写正文”为主，杜绝虚构统计数据', () => {
      expect(overviewSource).toContain('handleResumeDrafting')
      expect(overviewSource).toContain('继续写正文')
      expect(overviewSource).toContain('draftedChaptersCount')
      expect(overviewSource).toContain('totalDraftedWords')
      expect(overviewSource).toContain('blueprints.length')
      expect(overviewSource).toContain('characters.length')
      expect(overviewSource).toContain('nodes.length')

      // 不展示虚构的每日时长、AI 消耗或写作习惯数据
      expect(overviewSource).not.toContain('今日时长')
      expect(overviewSource).not.toContain('今日字数')
      expect(overviewSource).not.toContain('AI 消耗')
      expect(overviewSource).not.toContain('AI 积分')
      expect(overviewSource).not.toContain('AI 介入占比')
      expect(overviewSource).not.toContain('连续写作')
    })

    it('提供可跳过的 4 步创作路径全景阶梯（定方向→建设定→做章节规划→写正文）', () => {
      expect(overviewSource).toContain('定方向')
      expect(overviewSource).toContain('建设定')
      expect(overviewSource).toContain('做章节规划')
      expect(overviewSource).toContain('写正文')

      // 包含展开/收起能力，确保完全可跳过、非强制
      expect(overviewSource).toContain('stepperExpanded')
      expect(overviewSource).toContain('收起导航')
      expect(overviewSource).toContain('展开全景导航')

      // 各步骤直达真实功能
      expect(overviewSource).toContain('handleOpenConfig')
      expect(overviewSource).toContain('handleOpenWorldBuilding')
      expect(overviewSource).toContain('handleOpenCharacterProfile')
      expect(overviewSource).toContain('handleOpenBlueprints')
      expect(overviewSource).toContain('handleOpenPlotTree')
    })

    it('功能按三个创作阶段清晰分组', () => {
      expect(overviewSource).toContain('阶段一')
      expect(overviewSource).toContain('世界与时空')
      expect(overviewSource).toContain('阶段二')
      expect(overviewSource).toContain('大纲与叙事脉络')
      expect(overviewSource).toContain('阶段三')
      expect(overviewSource).toContain('正文执笔与质量审核')

      // 各工作区卡片
      expect(overviewSource).toContain('多地图地图册')
      expect(overviewSource).toContain('故事时间线')
      expect(overviewSource).toContain('世界观与规则设定')
      expect(overviewSource).toContain('章节蓝图细纲')
      expect(overviewSource).toContain('章节脉络')
      expect(overviewSource).toContain('正文直接写作')
      expect(overviewSource).toContain('只读一致性审核')
    })

    it('长书名与空项目状态安全保护', () => {
      expect(overviewSource).toContain("overflowWrap: 'anywhere'")
      expect(overviewSource).toContain("wordBreak: 'break-word'")
      expect(cssSource).toContain('overflow-wrap: anywhere')
      expect(overviewSource).toContain('totalChapters ?? 58')
      expect(overviewSource).toContain('wordsPerChapter ?? 3000')
    })

    it('所有按钮与可点击卡片保留真实动作并具备无障碍支持', () => {
      expect(overviewSource).toContain('activateCardOnKey')
      expect(overviewSource).toContain('role="button"')
      expect(overviewSource).toContain('tabIndex={0}')
    })
  })

  describe('NewProjectDialog (新建项目对话框)', () => {
    it('仍然只需作品名称和保存位置两项基本输入', () => {
      expect(dialogSource).toContain('作品名称')
      expect(dialogSource).toContain('保存位置')
      expect(dialogSource).toContain('ipc.invoke(\'dialog:select-folder\')')
      expect(dialogSource).toContain('createProject')
      expect(dialogSource).toContain('新书立项')
      expect(dialogSource).toContain('立项创作')
    })

    it('告知用户创建后可在总览中使用创作路径随时配置或直接起草', () => {
      expect(dialogSource).toContain('定方向')
      expect(dialogSource).toContain('建设定')
      expect(dialogSource).toContain('做章节规划')
      expect(dialogSource).toContain('写正文')
    })
  })

  describe('literary-workbench.css (语义色规范与样式支持)', () => {
    it('使用现有语义变量，绝不写死参考项目的金色、紫色或粉色', () => {
      // 严禁写死参考图的特定 HEX：如 #b08d55 金、#4f46e5 靛紫、#b3382e 朱红等
      expect(cssSource).not.toMatch(/#b08d55/i)
      expect(cssSource).not.toMatch(/#4f46e5/i)
      expect(cssSource).not.toMatch(/#b3382e/i)

      expect(cssSource).toContain('var(--color-bg)')
      expect(cssSource).toContain('var(--color-panel)')
      expect(cssSource).toContain('var(--color-accent)')
      expect(cssSource).toContain('var(--color-border)')
      expect(cssSource).toContain('var(--color-text)')
      expect(cssSource).toContain('var(--color-text-secondary)')
      expect(cssSource).toContain('var(--color-text-muted)')
    })

    it('具备书脊、新书插槽、阶梯导航与工作站卡片样式', () => {
      expect(cssSource).toContain('.literary-book-cover')
      expect(cssSource).toContain('.literary-new-book-slot')
      expect(cssSource).toContain('.literary-stepper-card')
      expect(cssSource).toContain('.literary-stage-section')
      expect(cssSource).toContain('.literary-workstation-card')
    })

    it('包含小屏与窄容器响应式适配', () => {
      expect(cssSource).toContain('@container (max-width: 768px)')
      expect(cssSource).toContain('@container (max-width: 540px)')
    })
  })
})
