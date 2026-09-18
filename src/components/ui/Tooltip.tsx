/**
 * Vela Tooltip 组件
 *
 * 基于 @radix-ui/react-tooltip 封装，自动适配深浅主题。
 * 观感为扁平的 1px 细边框小气泡：无玻璃拟态、无大圆角、无辉光。
 *
 * 用法：
 *   import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/Tooltip'
 *
 *   <Tooltip>
 *     <TooltipTrigger asChild>
 *       <button aria-label="刷新">…</button>
 *     </TooltipTrigger>
 *     <TooltipContent>刷新</TooltipContent>
 *   </Tooltip>
 *
 * 注意：Provider 已在 App 根部统一挂载，业务组件无需自行包裹。
 */

import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '../../lib/utils'

/** 全局 Provider（App.tsx 包裹一次即可） */
const TooltipProvider = TooltipPrimitive.Provider

/** Tooltip 根 */
const Tooltip = TooltipPrimitive.Root

/** 触发元素 */
const TooltipTrigger = TooltipPrimitive.Trigger

/**
 * Tooltip 内容气泡
 * 使用 CSS 变量 --color-tooltip-bg / --color-tooltip-text 自动适配主题
 */
const TooltipContent = React.forwardRef<
  React.ComponentRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-[9999] max-w-[280px] px-2 py-1 text-[11px] font-medium leading-4',
        'rounded-[var(--radius-sm)] border border-[var(--color-border)]',
        'bg-[var(--color-tooltip-bg)] text-[var(--color-tooltip-text)]',
        'shadow-[var(--shadow-tooltip)]',
        /* 进出场只用不透明度，不做缩放位移 */
        'animate-in fade-in-0 duration-100',
        'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-75',
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

/** 带 Tooltip 的图标按钮：统一 aria-label，避免出现无标签的纯图标操作 */
export interface IconTooltipProps {
  /** 提示文字，同时作为可访问名称 */
  label: string
  /** 气泡朝向，默认底部 */
  side?: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>['side']
  /** tooltip 关闭（例如标题已经完整展示时不重复提示） */
  disabled?: boolean
  children: React.ReactElement
}

/** 图标按钮的标准包裹：Tooltip + 可访问名称。
 *
 *  自带 Provider（Radix 允许嵌套），因此这些组件在 App 之外的任何渲染环境
 *  —— 单元测试、Storybook、被单独复用的面板 —— 都不会依赖外层 Provider 而报错。 */
function IconTooltip({ label, side = 'bottom', disabled = false, children }: IconTooltipProps) {
  if (disabled) return children
  return (
    <TooltipProvider delayDuration={300} skipDelayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild aria-label={label}>
          {children}
        </TooltipTrigger>
        <TooltipContent side={side}>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, IconTooltip }
