import { useEffect, useRef } from 'react'
import { useLayoutStore } from '../stores/layout-store'

/**
 * 工作台窄屏策略。
 *
 * 1280px 是三栏（项目树 / 编辑区 / 上下文检视器）都能舒适使用的下限：
 *  - >= 1280（'wide'）：不干预作者的面板开关，恢复此前被自动收起的面板。
 *  - <  1280（'medium'）：优先收起右栏（上下文检视器、AI 面板），编辑区保持视觉中心。
 *  - <  1024（'narrow'）：再收起左侧项目树。
 *
 * 只在跨过档位时动作，避免作者在窄屏手动展开面板后被一次 resize 立刻关掉。
 */
export const WIDE_BREAKPOINT = 1280
export const NARROW_BREAKPOINT = 1024

type WidthBucket = 'narrow' | 'medium' | 'wide'

export function resolveWidthBucket(width: number): WidthBucket {
  if (width < NARROW_BREAKPOINT) return 'narrow'
  if (width < WIDE_BREAKPOINT) return 'medium'
  return 'wide'
}

export function useResponsiveWorkbenchLayout(): void {
  const bucketRef = useRef<WidthBucket | null>(null)
  // 记录哪些面板是被窄屏策略自动收起的，变宽后只恢复这些。
  const autoCollapsed = useRef({ reference: false, ai: false, sidebar: false })

  useEffect(() => {
    const apply = () => {
      const bucket = resolveWidthBucket(window.innerWidth)
      if (bucket === bucketRef.current) return
      const previous = bucketRef.current
      bucketRef.current = bucket

      const layout = useLayoutStore.getState()

      if (bucket === 'wide') {
        if (autoCollapsed.current.reference) layout.setReferencePanelOpen(true)
        if (autoCollapsed.current.ai) layout.setAIPanelOpen(true)
        if (autoCollapsed.current.sidebar) layout.setSidebarOpen(true)
        autoCollapsed.current = { reference: false, ai: false, sidebar: false }
        return
      }

      if (layout.referencePanelOpen) {
        autoCollapsed.current.reference = true
        layout.setReferencePanelOpen(false)
      }
      if (layout.aiPanelOpen) {
        autoCollapsed.current.ai = true
        layout.setAIPanelOpen(false)
      }

      if (bucket === 'narrow' && layout.sidebarOpen) {
        autoCollapsed.current.sidebar = true
        layout.setSidebarOpen(false)
      }

      // 从窄屏回到中档时，左侧项目树不再需要保持收起。
      if (bucket === 'medium' && previous === 'narrow' && autoCollapsed.current.sidebar) {
        autoCollapsed.current.sidebar = false
        layout.setSidebarOpen(true)
      }
    }

    apply()
    window.addEventListener('resize', apply)
    return () => window.removeEventListener('resize', apply)
  }, [])
}
