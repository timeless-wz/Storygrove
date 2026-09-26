import { describe, expect, it, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  LITERARY_THEMES,
  BASE_THEMES,
  ALL_THEMES,
  THEME_GROUPS,
  isLiteraryTheme,
  isBaseTheme,
  isDarkLiteraryTheme,
} from '../../../shared/literary-themes'
import { ThemeGallery } from '../ThemeGallery'
import { useThemeStore } from '../../../stores/theme-store'
import { useLocaleStore } from '../../../stores/locale-store'

describe('Theme Gallery metadata & contracts (18 themes total)', () => {
  it('defines exactly 18 themes (14 literary + 4 base) with valid unique IDs', () => {
    expect(ALL_THEMES).toHaveLength(18)
    const uniqueIds = new Set(ALL_THEMES.map((t) => t.id))
    expect(uniqueIds.size).toBe(18)

    expect(LITERARY_THEMES).toHaveLength(14)
    expect(BASE_THEMES).toHaveLength(4)
    expect(BASE_THEMES.map((t) => t.id)).toEqual(['paper', 'light', 'galaxy', 'dark'])
  })

  it('correctly partitions all 18 themes into groups', () => {
    const all = ALL_THEMES
    const lightThemes = all.filter((t) => t.group === '浅色')
    const darkThemes = all.filter((t) => t.group === '深色')
    const mixedThemes = all.filter((t) => t.group === '混合')

    expect(lightThemes).toHaveLength(12) // 10 literary + 2 base (paper, light)
    expect(darkThemes).toHaveLength(5)   // 3 literary + 2 base (galaxy, dark)
    expect(mixedThemes).toHaveLength(1)  // 1 literary (starlight)
    expect(lightThemes.length + darkThemes.length + mixedThemes.length).toBe(18)
    expect(THEME_GROUPS).toEqual(['全部', '浅色', '深色', '混合'])
  })

  it('provides bilingual metadata for all 18 themes', () => {
    for (const item of ALL_THEMES) {
      expect(item.name.trim().length).toBeGreaterThan(0)
      expect(item.nameEn.trim().length).toBeGreaterThan(0)
      expect(item.description.trim().length).toBeGreaterThan(0)
      expect(item.descriptionEn.trim().length).toBeGreaterThan(0)
      // English fields must contain ASCII characters
      expect(/[A-Za-z]/.test(item.nameEn)).toBe(true)
      expect(/[A-Za-z]/.test(item.descriptionEn)).toBe(true)
    }
  })

  it('correctly identifies dark themes across all 18 themes', () => {
    expect(isDarkLiteraryTheme('ember')).toBe(true)
    expect(isDarkLiteraryTheme('starlight-dark')).toBe(true)
    expect(isDarkLiteraryTheme('cosmic-glass')).toBe(true)
    expect(isDarkLiteraryTheme('dark')).toBe(true)
    expect(isDarkLiteraryTheme('galaxy')).toBe(true)

    expect(isDarkLiteraryTheme('storyforge')).toBe(false)
    expect(isDarkLiteraryTheme('inkwash')).toBe(false)
    expect(isDarkLiteraryTheme('mist')).toBe(false)
    expect(isDarkLiteraryTheme('paper-ink')).toBe(false)
    expect(isDarkLiteraryTheme('starlight')).toBe(false)
    expect(isDarkLiteraryTheme('paper')).toBe(false)
    expect(isDarkLiteraryTheme('light')).toBe(false)
  })

  it('validates theme membership helpers', () => {
    expect(isLiteraryTheme('inkwash')).toBe(true)
    expect(isLiteraryTheme('apricot')).toBe(true)
    expect(isLiteraryTheme('paper')).toBe(false)
    expect(isBaseTheme('paper')).toBe(true)
    expect(isBaseTheme('dark')).toBe(true)
    expect(isBaseTheme('inkwash')).toBe(false)
  })
})

describe('ThemeGallery component rendering & interaction', () => {
  beforeEach(() => {
    useLocaleStore.setState({ locale: 'zh-CN' })
    useThemeStore.setState({ theme: 'paper', resolvedTheme: 'paper' })
  })

  it('renders theme gallery heading and category filter options', () => {
    const markup = renderToStaticMarkup(<ThemeGallery />)
    expect(markup).toContain('文学主题画廊')
    expect(markup).toContain('共 14 套')
    expect(markup).toContain('全部')
    expect(markup).toContain('浅色')
    expect(markup).toContain('深色')
    expect(markup).toContain('混合')
  })

  it('renders all 18 themes with swatch attributes and descriptions', () => {
    const markup = renderToStaticMarkup(<ThemeGallery />)
    for (const theme of ALL_THEMES) {
      expect(markup).toContain(`data-theme-option="${theme.id}"`)
      expect(markup).toContain(`data-theme-swatch="${theme.id}"`)
      expect(markup).toContain(theme.name)
    }
    expect(markup).toContain('文学典藏')
    expect(markup).toContain('经典基础')
  })

  it('displays the active theme indicator and updates upon switching', () => {
    useThemeStore.setState({ theme: 'inkwash', resolvedTheme: 'inkwash' })
    let markup = renderToStaticMarkup(<ThemeGallery />)
    expect(markup).toContain('水墨远山')
    expect(markup).toContain('当前主题：')

    useThemeStore.setState({ theme: 'starlight', resolvedTheme: 'starlight' })
    markup = renderToStaticMarkup(<ThemeGallery />)
    expect(markup).toContain('星夜萤黄')

    useThemeStore.setState({ theme: 'dark', resolvedTheme: 'dark' })
    markup = renderToStaticMarkup(<ThemeGallery />)
    expect(markup).toContain('深沉黑夜')
  })

  it('renders English metadata when locale is en-US', () => {
    useLocaleStore.setState({ locale: 'en-US' })
    useThemeStore.setState({ theme: 'paper', resolvedTheme: 'paper' })
    const markup = renderToStaticMarkup(<ThemeGallery />)

    expect(markup).toContain('Literary Theme Gallery')
    expect(markup).toContain('Literary Collection')
    expect(markup).toContain('Classic Base')
    expect(markup).toContain('Active Theme: ')
    expect(markup).toContain('Paper')
    expect(markup).toContain('StoryForge')
    expect(markup).toContain('Starlight Night')
    expect(markup).toContain('Galaxy')
    expect(markup).toContain('Dark')

    // No Chinese theme names or descriptions in en-US mode
    expect(markup).not.toContain('青绿山水')
    expect(markup).not.toContain('温润纸面')
    expect(markup).not.toContain('当前主题：')
  })

  it('persists selected theme across theme-store calls', () => {
    // Install minimal DOM stub for Node environment
    if (typeof document === 'undefined') {
      const classNames = new Set<string>()
      const attrs = new Map<string, string>()
      Object.defineProperty(globalThis, 'document', {
        value: {
          documentElement: {
            setAttribute: (k: string, v: string) => attrs.set(k, v),
            classList: {
              add: (name: string) => classNames.add(name),
              remove: (...names: string[]) => names.forEach((n) => classNames.delete(n)),
              contains: (name: string) => classNames.has(name),
            },
            style: { setProperty: () => {} },
          },
        },
        configurable: true,
      })
    }

    useThemeStore.getState().setTheme('galaxy')
    expect(useThemeStore.getState().theme).toBe('galaxy')

    useThemeStore.getState().setTheme('starlight')
    expect(useThemeStore.getState().theme).toBe('starlight')

    useThemeStore.getState().setTheme('paper')
    expect(useThemeStore.getState().theme).toBe('paper')
  })
})
