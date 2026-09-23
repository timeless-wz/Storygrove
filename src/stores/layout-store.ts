import { create } from 'zustand'

/** 左侧活动栏的视图类型 */
export type SidebarView = 'home' | 'project' | 'workspace' | 'knowledge' | 'characters' | 'documents' | 'settings'

/** 下方工具窗口 Tab */
export type BottomTab = 'tasks' | 'log' | 'models'

/** 右侧面板视图类型 */
export type RightView = 'agent' | 'ai-output'

/** 左侧主导航当前视觉激活项。二级内容始终归属其所在的一级视图。 */
export type LeftRailItem = SidebarView | BottomTab

/** 设置弹窗分类 */
export type SettingsSection = 'llm' | 'embedding' | 'proxy' | 'editor' | 'prompts' | 'skills' | 'logs' | 'about'

/** 章节创建对话框的预填参数 */
export type ChapterCreationPrefill = Record<string, unknown> | null

/** 角色档案页的内部视图；默认为概览，完整字段只出现在显式编辑模式里。 */
export type CharacterProfileView = 'overview' | 'edit' | 'graph'

/** 外部跳转对角色档案页的视图请求；requestId 递增以让重复请求也生效。 */
export interface CharacterViewRequest {
  view: CharacterProfileView
  requestId: number
}

interface LayoutState {
  // ===== 侧边栏 =====
  sidebarOpen: boolean
  sidebarView: SidebarView
  sidebarWidth: number
  activeRailItem: LeftRailItem
  /** 项目树各一级分组折叠状态（本次应用运行期间保持） */
  projectTreeGroupOpen: Record<string, boolean>
  setProjectTreeGroupOpen: (groupId: string, open: boolean) => void
  toggleProjectTreeGroup: (groupId: string) => void

  // ===== AI 对话面板 =====
  aiPanelOpen: boolean
  aiPanelWidth: number
  /** 右侧面板当前视图：Agent 对话 / AI 输出 */
  rightView: RightView
  /** 三栏工作台的项目参考栏。它与 AI 对话面板独立，窄窗口可单独收起。 */
  referencePanelOpen: boolean
  /** 专注模式仅收起工作台辅助栏，不卸载任何编辑器或数据流。 */
  focusMode: boolean

  // ===== 底部面板 =====
  bottomPanelOpen: boolean
  bottomTab: BottomTab
  bottomPanelHeight: number

  // ===== 全局弹窗状态（替代 window.dispatchEvent 事件总线）=====
  /** 设置弹窗是否打开 */
  settingsOpen: boolean
  /** 设置弹窗打开时默认定位的分类 */
  settingsSection: SettingsSection
  /** 新建项目对话框是否打开 */
  newProjectOpen: boolean
  /** 导出对话框是否打开 */
  exportOpen: boolean
  /** 导入小说对话框是否打开 */
  importNovelOpen: boolean
  /** 章节创建对话框是否打开 */
  chapterCreationOpen: boolean
  /** 章节创建对话框的预填参数 */
  chapterCreationPrefill: ChapterCreationPrefill
  /**
   * 角色档案页的视图请求。
   *
   * 角色图谱已不再是独立入口；旧标签页、旧路由或旧项目打开角色图谱时，
   * 统一改成“打开角色档案并切到关系图谱视图”，由这里传递请求。
   */
  characterViewRequest: CharacterViewRequest | null

  // ===== Actions =====
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setSidebarView: (view: SidebarView, activeRailItem?: LeftRailItem) => void
  setSidebarWidth: (width: number) => void
  toggleAIPanel: () => void
  setAIPanelOpen: (open: boolean) => void
  setAIPanelWidth: (width: number) => void
  setRightView: (view: RightView) => void
  /** 打开右侧面板并切换到指定视图 */
  openRightPanel: (view: RightView) => void
  toggleReferencePanel: () => void
  setReferencePanelOpen: (open: boolean) => void
  toggleFocusMode: () => void
  toggleBottomPanel: () => void
  setBottomTab: (tab: BottomTab) => void
  setBottomPanelHeight: (height: number) => void
  openBottomTab: (tab: BottomTab) => void

  // ===== 全局弹窗 Actions =====
  openSettings: (section?: SettingsSection, activeRailItem?: LeftRailItem) => void
  closeSettings: () => void
  openNewProject: () => void
  closeNewProject: () => void
  openExport: () => void
  closeExport: () => void
  openImportNovel: () => void
  closeImportNovel: () => void
  openChapterCreation: (prefill?: ChapterCreationPrefill) => void
  closeChapterCreation: () => void
  /** 打开角色档案并请求内部视图（概览 / 编辑 / 关系图谱）。 */
  openCharacterProfile: (view?: CharacterProfileView) => void
}

export const useLayoutStore = create<LayoutState>()((set) => ({
  // 默认值
  sidebarOpen: true,
  sidebarView: 'project',
  sidebarWidth: 260,
  activeRailItem: 'project',
  projectTreeGroupOpen: {
    plan: true,
    setting: true,
    library: true,
    management: true,
    manuscript: true,
  },

  // 参考栏是默认右侧信息架；AI 对话在用户需要时由右侧栏或快捷按钮打开。
  aiPanelOpen: false,
  aiPanelWidth: 320,
  rightView: 'agent',
  referencePanelOpen: true,
  focusMode: false,

  // 任务面板是状态栏触发的悬浮窗；默认关闭，绝不为它预留工作区。
  bottomPanelOpen: false,
  bottomTab: 'tasks',
  bottomPanelHeight: 200,

  // 全局弹窗默认关闭
  settingsOpen: false,
  settingsSection: 'llm',
  newProjectOpen: false,
  exportOpen: false,
  importNovelOpen: false,
  chapterCreationOpen: false,
  chapterCreationPrefill: null,
  characterViewRequest: null,

  // Actions
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSidebarView: (view, activeRailItem) =>
    set((s) => {
      const nextRailItem = activeRailItem ?? view
      const sameButton = s.sidebarView === view && s.activeRailItem === nextRailItem
      return {
        sidebarView: view,
        activeRailItem: nextRailItem,
        sidebarOpen: sameButton ? !s.sidebarOpen : true,
      }
    }),
  setSidebarWidth: (width) => set({ sidebarWidth: Math.max(200, Math.min(500, width)) }),
  setProjectTreeGroupOpen: (groupId, open) =>
    set((s) => ({
      projectTreeGroupOpen: { ...s.projectTreeGroupOpen, [groupId]: open },
    })),
  toggleProjectTreeGroup: (groupId) =>
    set((s) => ({
      projectTreeGroupOpen: {
        ...s.projectTreeGroupOpen,
        [groupId]: !(s.projectTreeGroupOpen[groupId] ?? true),
      },
    })),

  toggleAIPanel: () => set((s) => ({ aiPanelOpen: !s.aiPanelOpen })),
  setAIPanelOpen: (open) => set({ aiPanelOpen: open }),
  setAIPanelWidth: (width) => set({ aiPanelWidth: Math.max(260, Math.min(600, width)) }),
  setRightView: (view) => set({ rightView: view }),
  openRightPanel: (view) => set({ aiPanelOpen: true, rightView: view }),
  toggleReferencePanel: () => set((s) => ({ referencePanelOpen: !s.referencePanelOpen })),
  setReferencePanelOpen: (open) => set({ referencePanelOpen: open }),
  toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),

  toggleBottomPanel: () => set((s) => ({ bottomPanelOpen: !s.bottomPanelOpen })),
  setBottomTab: (tab) =>
    set((s) => {
      const sameButton = s.bottomTab === tab && s.activeRailItem === tab
      return {
        bottomTab: tab,
        activeRailItem: tab,
        bottomPanelOpen: sameButton ? !s.bottomPanelOpen : true,
      }
    }),
  setBottomPanelHeight: (height) => set({ bottomPanelHeight: Math.max(100, Math.min(500, height)) }),
  openBottomTab: (tab) => set({ bottomPanelOpen: true, bottomTab: tab, activeRailItem: tab }),

  // 全局弹窗 Actions
  openSettings: (section = 'llm', activeRailItem = 'settings') =>
    set({ settingsOpen: true, settingsSection: section, activeRailItem }),
  closeSettings: () => set({ settingsOpen: false }),
  openNewProject: () => set({ newProjectOpen: true }),
  closeNewProject: () => set({ newProjectOpen: false }),
  openExport: () => set({ exportOpen: true }),
  closeExport: () => set({ exportOpen: false }),
  openImportNovel: () => set({ importNovelOpen: true }),
  closeImportNovel: () => set({ importNovelOpen: false }),
  openChapterCreation: () => {
    // Disabled in Codex Creative Workbench: generation popups are deactivated
  },
  closeChapterCreation: () => set({ chapterCreationOpen: false, chapterCreationPrefill: null }),
  openCharacterProfile: (view = 'overview') =>
    set((s) => ({
      sidebarView: 'characters',
      activeRailItem: 'characters',
      sidebarOpen: true,
      characterViewRequest: {
        view,
        requestId: (s.characterViewRequest?.requestId ?? 0) + 1,
      },
    })),
}))
