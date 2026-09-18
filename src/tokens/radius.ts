/**
 * Vela Radius Scale — Codex / shadcn 语汇
 *
 * 工作台统一使用克制的圆角：全部收在 4~8px 区间。
 * 不使用胶囊（rounded-full）或 >8px 的大圆角，也不用阴影表达层级——
 * 层级由 1px 细边框 + 背景色阶承担。
 *
 * 这里只暴露 CSS 变量引用，颜色/尺寸的唯一权威仍是 src/index.css。
 *
 * Usage:
 *   import { radius } from '@/tokens/radius'
 *   <div style={{ borderRadius: radius.md }} />
 */

export const radiusVar = {
  sm: 'var(--radius-sm)', // 4px  — 行内小控件、标签
  md: 'var(--radius-md)', // 6px  — 按钮与输入框默认
  lg: 'var(--radius-lg)', // 8px  — 面板、弹窗
  xl: 'var(--radius-xl)', // 8px  — 大容器（与 lg 同档，保持克制）
  '2xl': 'var(--radius-2xl)', // 8px  — 上限
} as const

/** Tailwind 任意值写法：rounded-[var(--radius-md)] */
export const radiusClass: Record<keyof typeof radiusVar, string> = {
  sm: 'rounded-[var(--radius-sm)]',
  md: 'rounded-[var(--radius-md)]',
  lg: 'rounded-[var(--radius-lg)]',
  xl: 'rounded-[var(--radius-xl)]',
  '2xl': 'rounded-[var(--radius-2xl)]',
}

/** 语义化别名：按用途而不是尺寸命名 */
export const radius = {
  control: 'var(--radius-md)', // 按钮、输入框、下拉项
  inline: 'var(--radius-sm)', // 行内小元素、徽标
  surface: 'var(--radius-lg)', // 面板、弹窗、菜单
} as const
