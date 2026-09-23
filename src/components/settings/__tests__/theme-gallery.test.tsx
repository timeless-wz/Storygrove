import { describe, expect, it, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  LITERARY_THEMES,
  THEME_GROUPS,
  isLiteraryTheme,
  isDarkLiteraryTheme,
} from '../../../shared/literary-themes'
import { ThemeGallery } from '../ThemeGallery'
import { useThemeStore } from '../../../stores/theme-store'

describe('StoryForge 14 Literary Themes metadata & contracts', () => {
  it('defines exactly 14 themes with valid groups and attributes', () => {
    expect(LITERARY_THEMES).toHaveLength(14)
    const lightThemes = LITERARY_THEMES.filter((t) => t.group === '浅色')
    const darkThemes = LITERARY_THEMES.filter((t) => t.group === '深色')
    const mixedThemes = LITERARY_THEMES.filter((t) => t.group === '混合')

    expect(lightThemes).toHaveLength(10)
    expect(darkThemes).toHaveLength(3)
    expect(mixedThemes).toHaveLength(1)
    expect(THEME_GROUPS).toEqual(['全部', '浅色', '深色', '混合'])
  })

  it('correctly identifies dark themes', () => {
    expect(isDarkLiteraryTheme('ember')).toBe(true)
    expect(isDarkLiteraryTheme('starlight-dark')).toBe(true)
    expect(isDarkLiteraryTheme('cosmic-glass')).toBe(true)

    expect(isDarkLiteraryTheme('storyforge')).toBe(false)
    expect(isDarkLiteraryTheme('inkwash')).toBe(false)
    expect(isDarkLiteraryTheme('mist')).toBe(false)
    expect(isDarkLiteraryTheme('paper-ink')).toBe(false)
    expect(isDarkLiteraryTheme('starlight')).toBe(false)
  })

  it('validates theme membership helper', () => {
    expect(isLiteraryTheme('inkwash')).toBe(true)
    expect(isLiteraryTheme('apricot')).toBe(true)
    expect(isLiteraryTheme('non-existent')).toBe(false)
  })
})

describe('ThemeGallery component rendering', () => {
  beforeEach(() => {
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

  it('renders all 14 themes with swatch attributes and descriptions', () => {
    const markup = renderToStaticMarkup(<ThemeGallery />)
    for (const theme of LITERARY_THEMES) {
      expect(markup).toContain(`data-theme-option="${theme.id}"`)
      expect(markup).toContain(`data-theme-swatch="${theme.id}"`)
      expect(markup).toContain(theme.name)
    }
  })

  it('displays the active theme indicator', () => {
    useThemeStore.setState({ theme: 'inkwash', resolvedTheme: 'inkwash' })
    const markup = renderToStaticMarkup(<ThemeGallery />)
    expect(markup).toContain('水墨远山')
    expect(markup).toContain('当前主题：')
  })
})
