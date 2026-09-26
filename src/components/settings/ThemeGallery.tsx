import { useState, useMemo } from 'react'
import { Check, Palette } from 'lucide-react'
import { useLocaleStore } from '../../stores/locale-store'
import { useThemeStore } from '../../stores/theme-store'
import {
  LITERARY_THEMES,
  BASE_THEMES,
  ALL_THEMES,
  THEME_GROUPS,
  type ThemeGroup,
  type ThemeItem,
} from '../../shared/literary-themes'
import { cn } from '../../lib/utils'

export function ThemeGallery() {
  const { theme, setTheme } = useThemeStore()
  const { text } = useLocaleStore()
  const [selectedGroup, setSelectedGroup] = useState<ThemeGroup>('全部')

  const filteredLiterary = useMemo(() => {
    if (selectedGroup === '全部') return LITERARY_THEMES
    return LITERARY_THEMES.filter((item) => item.group === selectedGroup)
  }, [selectedGroup])

  const filteredBase = useMemo(() => {
    if (selectedGroup === '全部') return BASE_THEMES
    return BASE_THEMES.filter((item) => item.group === selectedGroup)
  }, [selectedGroup])

  const activeThemeName = useMemo(() => {
    const found = ALL_THEMES.find((item) => item.id === theme)
    if (found) return text(found.name, found.nameEn)
    if (theme === 'light') return text('亮色白昼', 'Light')
    if (theme === 'paper') return text('温润纸面', 'Paper')
    if (theme === 'dark') return text('深沉黑夜', 'Dark')
    if (theme === 'galaxy') return text('星辰暗夜', 'Galaxy')
    return theme
  }, [theme, text])

  const renderThemeCard = (item: ThemeItem) => {
    const isCurrent = theme === item.id
    const displayName = text(item.name, item.nameEn)
    const displayDesc = text(item.description, item.descriptionEn)
    return (
      <button
        key={item.id}
        type="button"
        data-theme={item.id}
        data-theme-option={item.id}
        aria-pressed={isCurrent}
        onClick={() => setTheme(item.id)}
        className={cn(
          'group relative text-left rounded-xl p-2.5 border transition-all duration-150 flex flex-col gap-2',
          isCurrent
            ? 'ring-2 shadow-sm'
            : 'hover:border-[var(--color-accent)] hover:shadow-xs'
        )}
        style={{
          borderColor: isCurrent ? 'var(--color-accent)' : 'var(--color-border)',
          background: 'var(--color-panel)',
          ...(isCurrent ? { '--tw-ring-color': 'var(--color-accent)' } : {}),
        }}
      >
        {/* 微型实时样本渲染：同时呈现外壳、纸面、文字和强调按钮 */}
        <span
          className="theme-sample w-full"
          data-theme-swatch={item.id}
          aria-hidden="true"
        >
          <span className="theme-sample-nav">
            <i />
            <i />
            <i />
          </span>
          <span className="theme-sample-paper">
            <b>{displayName}</b>
            <i />
            <i />
            <i />
            <em className="theme-sample-btn">
              {item.isDark ? text('暗夜', 'Night') : text('试读', 'Read')}
            </em>
          </span>
        </span>

        {/* 标题与描述 */}
        <div className="px-1 pb-0.5 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 truncate">
              <span
                className="font-medium text-xs truncate"
                style={{ color: 'var(--color-text)' }}
              >
                {displayName}
              </span>
              {'isBase' in item && item.isBase && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded font-normal"
                  style={{ background: 'var(--color-hover)', color: 'var(--color-text-muted)' }}
                >
                  {text('基础', 'Base')}
                </span>
              )}
            </div>
            {isCurrent && (
              <span
                className="inline-flex items-center justify-center w-4 h-4 rounded-full flex-shrink-0"
                style={{ background: 'var(--color-accent)', color: 'var(--color-accent-foreground)' }}
                aria-label={text('当前使用', 'Active')}
              >
                <Check size={11} strokeWidth={2.5} />
              </span>
            )}
          </div>
          <span
            className="block text-2xs truncate mt-0.5"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {displayDesc}
          </span>
        </div>
      </button>
    )
  }

  return (
    <div className="space-y-4" aria-labelledby="theme-gallery-heading">
      {/* 头部与分类筛选 */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <div className="flex items-center gap-2">
          <Palette size={16} aria-hidden="true" style={{ color: 'var(--color-accent)' }} />
          <h3 id="theme-gallery-heading" className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            {text('文学主题画廊', 'Literary Theme Gallery')}
          </h3>
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--color-badge-bg)', color: 'var(--color-badge-text)' }}>
            {text('共 14 套文学 · 4 套基础', '14 Literary · 4 Base Themes')}
          </span>
        </div>

        {/* 分类切换按钮组 */}
        <div className="flex items-center gap-1 p-0.5 rounded-lg border text-xs" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
          {THEME_GROUPS.map((grp) => {
            const isGroupActive = selectedGroup === grp
            return (
              <button
                key={grp}
                type="button"
                className={cn(
                  'px-2.5 py-1 rounded-md font-medium transition-colors',
                  isGroupActive
                    ? 'shadow-xs'
                    : 'hover:text-[var(--color-text)]'
                )}
                style={
                  isGroupActive
                    ? { background: 'var(--color-raised)', color: 'var(--color-accent)', fontWeight: 600 }
                    : { color: 'var(--color-text-secondary)' }
                }
                onClick={() => setSelectedGroup(grp)}
              >
                {grp === '全部'
                  ? text('全部', 'All')
                  : grp === '浅色'
                  ? text('浅色', 'Light')
                  : grp === '深色'
                  ? text('深色', 'Dark')
                  : text('混合', 'Mixed')}
              </button>
            )
          })}
        </div>
      </div>

      <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
        {text(
          '即选即换，针对长篇沉浸阅读排版设计。正文保持高对比度与纸面质感，不干扰手稿文字。',
          'Instant switching, designed for immersive long-form reading. Manuscript maintains high contrast and paper texture.'
        )}
      </p>

      {/* 主题卡片网格 */}
      <div
        className="max-h-[460px] overflow-y-auto pr-1 pb-1 space-y-4"
        role="group"
        aria-label={text('主题选择', 'Theme Selection')}
        style={{ scrollbarWidth: 'thin' }}
      >
        {/* 文学主题分组 */}
        {filteredLiterary.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
                {text('文学典藏', 'Literary Collection')}
              </span>
              <span className="text-2xs" style={{ color: 'var(--color-text-muted)' }}>
                {text(`共 ${filteredLiterary.length} 套`, `${filteredLiterary.length} themes`)}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {filteredLiterary.map(renderThemeCard)}
            </div>
          </div>
        )}

        {/* 基础主题分组 */}
        {filteredBase.length > 0 && (
          <div className="space-y-2 pt-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
                {text('经典基础', 'Classic Base')}
              </span>
              <span className="text-2xs" style={{ color: 'var(--color-text-muted)' }}>
                {text(`纯色基底 (${filteredBase.length} 套)`, `Monochrome (${filteredBase.length} themes)`)}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {filteredBase.map(renderThemeCard)}
            </div>
          </div>
        )}
      </div>

      {/* 当前主题提示 */}
      <div
        className="flex items-center justify-between text-xs px-3 py-2 rounded-lg border"
        style={{
          borderColor: 'var(--color-border)',
          background: 'var(--color-bg)',
          color: 'var(--color-text-secondary)',
        }}
      >
        <span>
          {text('当前主题：', 'Active Theme: ')}
          <strong className="font-semibold" style={{ color: 'var(--color-accent)' }}>
            {activeThemeName}
          </strong>
        </span>
        <span className="text-2xs" style={{ color: 'var(--color-text-muted)' }}>
          {text('本地独立生效', 'Applied locally')}
        </span>
      </div>
    </div>
  )
}
