import { Bot, Layers3, Sparkles } from 'lucide-react'
import { useLayoutStore } from '../../stores/layout-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { useLocaleStore } from '../../stores/locale-store'
import { IconTooltip } from '../ui/Tooltip'

function RightBarButton({
  icon: Icon,
  label,
  active,
  onClick,
  showDot,
}: {
  icon: typeof Bot
  label: string
  active: boolean
  onClick: () => void
  showDot?: boolean
}) {
  return (
    <div className="relative w-full">
      <IconTooltip label={label} side="left">
        <button
          type="button"
          onClick={onClick}
          className={`tool-btn${active ? ' active' : ''}`}
          style={{ height: 30 }}
        >
          <Icon size={15} strokeWidth={active ? 2 : 1.6} />
        </button>
      </IconTooltip>
      {showDot && !active && (
        <span
          className="pointer-events-none absolute top-1 right-1 h-1.5 w-1.5 rounded-full animate-pulse"
          style={{ backgroundColor: 'var(--color-accent)' }}
        />
      )}
    </div>
  )
}

/**
 * 右侧工具窗口栏（RightToolWindowBar）
 * 紧凑图标栏：上下文检视器 / AI Agent / AI 输出，激活态为 2px 内嵌竖线。
 */
export default function RightToolWindowBar() {
  const text = useLocaleStore(s => s.text)
  const aiPanelOpen = useLayoutStore(s => s.aiPanelOpen)
  const rightView = useLayoutStore(s => s.rightView)
  const toggleAIPanel = useLayoutStore(s => s.toggleAIPanel)
  const openRightPanel = useLayoutStore(s => s.openRightPanel)
  const referencePanelOpen = useLayoutStore(s => s.referencePanelOpen)
  const toggleReferencePanel = useLayoutStore(s => s.toggleReferencePanel)
  const currentRun = useWorkflowStore((s) => s.currentRun)

  /** 工作流活跃时给 AI 输出按钮显示脉冲 */
  const showPulse = currentRun && (currentRun.status === 'running' || currentRun.status === 'waiting')

  /** 点击按钮逻辑：
   *  - 如果面板关闭 → 打开并切到对应视图
   *  - 如果面板已打开且已是此视图 → 关闭面板
   *  - 如果面板已打开但是另一个视图 → 切到此视图
   */
  const handleClick = (view: 'agent' | 'ai-output') => {
    if (!aiPanelOpen) {
      openRightPanel(view)
    } else if (rightView === view) {
      toggleAIPanel()
    } else {
      openRightPanel(view)
    }
  }

  const agentActive = aiPanelOpen && rightView === 'agent'
  const outputActive = aiPanelOpen && rightView === 'ai-output'

  return (
    <div
      className="no-select flex h-full flex-col items-center justify-start gap-0.5 py-1"
      style={{
        width: 'var(--width-right-bar)',
        backgroundColor: 'var(--color-activity-bar)',
        borderLeft: '1px solid var(--color-border)',
        flexShrink: 0,
      }}
    >
      <RightBarButton
        icon={Layers3}
        label={text(
          referencePanelOpen ? '收起上下文检视器' : '打开上下文检视器',
          referencePanelOpen ? 'Collapse context inspector' : 'Open context inspector',
        )}
        active={referencePanelOpen}
        onClick={toggleReferencePanel}
      />
      <RightBarButton
        icon={Bot}
        label={text('AI Agent 面板', 'AI agent panel')}
        active={agentActive}
        onClick={() => handleClick('agent')}
      />
      <RightBarButton
        icon={Sparkles}
        label={text('AI 输出', 'AI output')}
        active={outputActive}
        onClick={() => handleClick('ai-output')}
        showDot={!!showPulse}
      />
    </div>
  )
}
