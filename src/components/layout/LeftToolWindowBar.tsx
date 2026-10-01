import {
  FolderOpen,
  Compass,
  BookOpen,
  Users,
  Home,
  ListChecks,
  Settings,
  ScrollText,
  Cpu,
} from 'lucide-react'
import { useLayoutStore, type SidebarView, type BottomTab } from '../../stores/layout-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { useLocaleStore } from '../../stores/locale-store'
import { IconTooltip } from '../ui/Tooltip'

/** 左侧侧边栏视图按钮配置（不含 Home，它单独渲染） */
const sidebarActivities: Array<{ id: SidebarView; icon: typeof FolderOpen; zh: string; en: string }> = [
  { id: 'project', icon: FolderOpen, zh: '创作', en: 'Writing' },
  { id: 'workspace', icon: Compass, zh: '资料', en: 'Sources' },
  { id: 'knowledge', icon: BookOpen, zh: '知识检索', en: 'Knowledge' },
  { id: 'characters', icon: Users, zh: '角色档案', en: 'Characters' },
]

/** 底部面板 Tab 按钮配置 */
const bottomTabs: Array<{ id: BottomTab; icon: typeof ListChecks; zh: string; en: string }> = [
  { id: 'tasks', icon: ListChecks, zh: '任务', en: 'Tasks' },
  { id: 'log', icon: ScrollText, zh: '日志', en: 'Logs' },
  { id: 'models', icon: Cpu, zh: '模型', en: 'Models' },
]

function LeftNavButton({
  icon: Icon,
  label,
  active,
  pulse,
  onClick,
  title,
}: {
  icon: typeof FolderOpen
  label: string
  active?: boolean
  pulse?: boolean
  onClick: () => void
  title?: string
}) {
  return (
    <div className="relative w-full px-1">
      <IconTooltip label={title ?? label} side="right">
        <button
          aria-label={label}
          onClick={onClick}
          className={`left-nav-button${active ? ' is-active' : ''}`}
        >
          <Icon size={20} strokeWidth={active ? 2 : 1.7} />
          <span className="left-nav-label">{label}</span>
        </button>
      </IconTooltip>
      {pulse && (
        <span
          className="absolute top-[5px] right-[5px] w-[5px] h-[5px] rounded-full animate-pulse pointer-events-none"
          style={{ backgroundColor: 'var(--color-accent)' }}
        />
      )}
    </div>
  )
}

/**
 * 左侧工具窗口栏（LeftToolWindowBar）
 * JetBrains 风格：带文字标签的左侧主导航，全高
 */
export default function LeftToolWindowBar() {
  const activeRailItem = useLayoutStore(s => s.activeRailItem)
  const setSidebarView = useLayoutStore(s => s.setSidebarView)
  const setBottomTab = useLayoutStore(s => s.setBottomTab)
  const openSettings = useLayoutStore(s => s.openSettings)
  const currentRun = useWorkflowStore(s => s.currentRun)
  const text = useLocaleStore(s => s.text)

  /** Home 按钮是否激活 */
  const homeActive = activeRailItem === 'home'

  return (
    <div
      className="writer-left-rail no-select flex flex-col h-full"
      style={{
        width: 'var(--width-left-bar)',
        flexShrink: 0,
      }}
    >
      {/* ===== 顶部：Home + 侧边栏视图切换 ===== */}
      <div className="flex flex-col items-center w-full pt-0.5">

        {/* Home 按钮 — 点击切换到主页视图 */}
        <LeftNavButton
          icon={Home}
          label={text('首页', 'Home')}
          active={homeActive}
          onClick={() => setSidebarView('home')}
          title={text('欢迎页', 'Welcome')}
        />

        {/* 分割线 */}
        <div className="writer-nav-divider w-8 my-1" style={{ height: 1 }} />

        {/* 侧边栏视图按钮 */}
        {sidebarActivities.map(({ id, icon: Icon, zh, en }) => {
          const label = text(zh, en)
          const isActive = activeRailItem === id
          return (
            <LeftNavButton
              key={id}
              icon={Icon}
              label={label}
              active={isActive}
              title={label}
              onClick={() => setSidebarView(id)}
            />
          )
        })}

      </div>

      {/* 弹性间隔 */}
      <div className="flex-1" />

      {/* ===== 底部：底部面板 Tab 控制 ===== */}
      <div className="flex flex-col items-center w-full pb-1">
        <div className="writer-nav-divider w-8 mb-1" style={{ height: 1 }} />

        {bottomTabs.map(({ id, icon: Icon, zh, en }) => {
          const label = text(zh, en)
          const isActive = activeRailItem === id
          const showPulse = id === 'tasks' && currentRun &&
            (currentRun.status === 'running' || currentRun.status === 'waiting')

          return (
            <LeftNavButton
              key={id}
              icon={Icon}
              label={label}
              active={isActive}
              title={label}
              pulse={!!showPulse}
              onClick={() => setBottomTab(id)}
            />
          )
        })}

        <div className="writer-nav-divider w-8 my-1" style={{ height: 1 }} />

        <LeftNavButton
          icon={Settings}
          label={text('设置', 'Settings')}
          active={activeRailItem === 'settings'}
          onClick={openSettings}
        />
      </div>
    </div>
  )
}
