import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import '../../../index.css'
import '../../../styles/literary-themes.css'
import '../../../styles/literary-workbench.css'
import '../../editor/vditor-prose.css'

import { ALL_THEMES, isDarkLiteraryTheme } from '../../../shared/literary-themes'
import { ThemeGallery } from '../ThemeGallery'
import { useThemeStore, type Theme } from '../../../stores/theme-store'
import { useLocaleStore } from '../../../stores/locale-store'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Rgb = readonly [number, number, number]

function parseRgb(color: string): Rgb {
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (!match) {
    throw new Error(`Unable to parse rgb from: "${color}"`)
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function relativeLuminance([r, g, b]: Rgb): number {
  const [sR, sG, sB] = [r, g, b].map((channel) => {
    const val = channel / 255
    return val <= 0.04045 ? val / 12.92 : ((val + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * sR + 0.7152 * sG + 0.0722 * sB
}

function contrastRatio(fgRgb: Rgb, bgRgb: Rgb): number {
  const l1 = relativeLuminance(fgRgb)
  const l2 = relativeLuminance(bgRgb)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

function rgbaPixels(color: string): readonly [number, number, number, number] {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const context = canvas.getContext('2d')!
  context.clearRect(0, 0, 1, 1)
  context.fillStyle = color
  context.fillRect(0, 0, 1, 1)
  const pixel = context.getImageData(0, 0, 1, 1).data
  return [pixel[0], pixel[1], pixel[2], pixel[3] / 255]
}

function applyThemeToDom(themeId: Theme) {
  const rootEl = document.documentElement
  rootEl.setAttribute('data-theme', themeId)
  rootEl.classList.remove('galaxy', 'paper', 'dark')
  if (themeId === 'galaxy') {
    rootEl.classList.add('galaxy')
  } else if (themeId === 'paper') {
    rootEl.classList.add('paper')
  } else if (themeId === 'dark' || isDarkLiteraryTheme(themeId)) {
    rootEl.classList.add('dark')
  }
}

let container: HTMLDivElement | undefined
let reactRoot: Root | undefined

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  reactRoot = createRoot(container)
  useLocaleStore.setState({ locale: 'zh-CN' })
})

afterEach(async () => {
  if (reactRoot && container) {
    await act(async () => {
      reactRoot?.unmount()
    })
    container.remove()
  }
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.classList.remove('galaxy', 'paper', 'dark')
})

describe('Browser computed styles: Primary button contrast across all 18 themes', () => {
  it.each(ALL_THEMES.flatMap(theme => (['classic', 'anime', 'custom'] as const).map(skin => [theme.id, skin] as const)))(
    'theme "%s" with "%s" skin retains readable shell, button and paper ink',
    (themeId, skin) => {
      applyThemeToDom(themeId as Theme)
      const skinRoot = document.createElement('div')
      skinRoot.className = 'app-skin-root'
      skinRoot.dataset.theme = themeId
      skinRoot.dataset.skin = skin
      skinRoot.dataset.skinReadability = skin === 'classic' ? 'theme-default' : 'high-contrast'
      skinRoot.innerHTML = '<div class="writer-shell-surface">Welcome text</div><div class="skin-workspace-panel">Workspace text</div><div class="writer-panel-card">Panel text</div><div class="literary-hero"><div class="literary-hero-actions"><button class="border bg-transparent text-[var(--color-text)]">More options</button></div></div><button class="btn-primary">Write</button><div class="vditor-prose-host"><div class="vditor"><div class="vditor-content"><div class="vditor-ir"><pre class="vditor-reset" contenteditable="true">正文</pre></div></div></div></div>'
      document.body.appendChild(skinRoot)
      try {
        const panel = skinRoot.querySelector<HTMLElement>('.writer-panel-card')!
        const button = skinRoot.querySelector<HTMLElement>('.btn-primary')!
        const paper = skinRoot.querySelector<HTMLElement>('pre.vditor-reset')!
        const panelStyle = getComputedStyle(panel)
        const buttonStyle = getComputedStyle(button)
        const paperStyle = getComputedStyle(paper)
        const label = `${themeId}/${skin}`
        expect(panelStyle.color, `${label} panel text`).toMatch(/^rgb/)
        expect(contrastRatio(parseRgb(buttonStyle.color), parseRgb(buttonStyle.backgroundColor)), `${label} button contrast`).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(parseRgb(paperStyle.color), parseRgb(paperStyle.backgroundColor)), `${label} paper ink contrast`).toBeGreaterThanOrEqual(4.5)
        const heroButton = skinRoot.querySelector<HTMLElement>('.literary-hero-actions button')!
        const heroStyle = getComputedStyle(heroButton)
        const [heroR, heroG, heroB, heroAlpha] = rgbaPixels(heroStyle.backgroundColor)
        for (const backdrop of [0, 255]) {
          const blended = [heroR, heroG, heroB].map(channel => Math.round(channel * heroAlpha + backdrop * (1 - heroAlpha))) as unknown as Rgb
          expect(contrastRatio(parseRgb(heroStyle.color), blended), `${label} hero action on ${backdrop === 0 ? 'dark' : 'light'} artwork`).toBeGreaterThanOrEqual(4.5)
        }
        if (skin !== 'classic') {
          for (const selector of ['.writer-shell-surface', '.skin-workspace-panel', '.writer-panel-card']) {
            const surface = skinRoot.querySelector<HTMLElement>(selector)!
            const style = getComputedStyle(surface)
            const [r, g, b, alpha] = rgbaPixels(style.backgroundColor)
            const foreground = parseRgb(style.color)
            for (const backdrop of [0, 255]) {
              const blended = [r, g, b].map(channel => Math.round(channel * alpha + backdrop * (1 - alpha))) as unknown as Rgb
              expect(contrastRatio(foreground, blended), `${label} ${selector} on ${backdrop === 0 ? 'dark' : 'light'} artwork`).toBeGreaterThanOrEqual(4.5)
            }
          }
        }
      } finally {
        skinRoot.remove()
      }
    },
  )

  it.each(ALL_THEMES)('theme "%s" satisfies WCAG AA (>= 4.5:1) for primary button computed style', async (themeItem) => {
    applyThemeToDom(themeItem.id as Theme)

    const btn = document.createElement('button')
    btn.className = 'btn-primary'
    btn.textContent = '主行动按钮'
    document.body.appendChild(btn)

    const computed = window.getComputedStyle(btn)
    const fg = parseRgb(computed.color)
    const bg = parseRgb(computed.backgroundColor)
    const ratio = contrastRatio(fg, bg)

    document.body.removeChild(btn)

    expect(
      ratio,
      `Theme "${themeItem.id}" primary button contrast ${ratio.toFixed(2)}:1 must be >= 4.5:1 (fg: ${computed.color}, bg: ${computed.backgroundColor})`
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('specifically validates paper, starlight, and galaxy primary button colors and contrast', () => {
    // 1. paper
    applyThemeToDom('paper')
    const paperBtn = document.createElement('button')
    paperBtn.className = 'btn-primary'
    document.body.appendChild(paperBtn)
    const paperStyle = window.getComputedStyle(paperBtn)
    const paperFg = parseRgb(paperStyle.color)
    const paperBg = parseRgb(paperStyle.backgroundColor)
    document.body.removeChild(paperBtn)

    expect(paperBg).toEqual([37, 99, 235]) // #2563EB
    expect(paperFg).toEqual([255, 255, 255]) // #FFFFFF
    expect(contrastRatio(paperFg, paperBg)).toBeGreaterThanOrEqual(4.5)

    // 2. starlight (mixed theme: chartreuse accent with dark text, NOT white)
    applyThemeToDom('starlight')
    const starlightBtn = document.createElement('button')
    starlightBtn.className = 'btn-primary'
    document.body.appendChild(starlightBtn)
    const starlightStyle = window.getComputedStyle(starlightBtn)
    const starlightFg = parseRgb(starlightStyle.color)
    const starlightBg = parseRgb(starlightStyle.backgroundColor)
    document.body.removeChild(starlightBtn)

    expect(starlightBg).toEqual([213, 230, 75]) // #D5E64B
    expect(starlightFg).toEqual([17, 21, 27]) // #11151B
    expect(starlightFg).not.toEqual([255, 255, 255]) // must NOT be washed-out white
    expect(contrastRatio(starlightFg, starlightBg)).toBeGreaterThanOrEqual(12.0)

    // 3. galaxy (dark theme: ice blue accent with deep text, NOT white)
    applyThemeToDom('galaxy')
    const galaxyBtn = document.createElement('button')
    galaxyBtn.className = 'btn-primary'
    document.body.appendChild(galaxyBtn)
    const galaxyStyle = window.getComputedStyle(galaxyBtn)
    const galaxyFg = parseRgb(galaxyStyle.color)
    const galaxyBg = parseRgb(galaxyStyle.backgroundColor)
    document.body.removeChild(galaxyBtn)

    expect(galaxyBg).toEqual([126, 200, 227]) // #7EC8E3
    expect(galaxyFg).toEqual([10, 22, 40]) // #0A1628
    expect(galaxyFg).not.toEqual([255, 255, 255]) // must NOT be washed-out white
    expect(contrastRatio(galaxyFg, galaxyBg)).toBeGreaterThanOrEqual(8.0)
  })

  it('validates starlight theme CSS tokens: dark shell, ivory paper, deep ink', () => {
    applyThemeToDom('starlight')
    const rootStyle = window.getComputedStyle(document.documentElement)

    const bgBase = rootStyle.getPropertyValue('--bg-base').trim()
    const pageBg = rootStyle.getPropertyValue('--editor-page-bg').trim()
    const inkPrimary = rootStyle.getPropertyValue('--editor-ink-primary').trim()
    const inkStrong = rootStyle.getPropertyValue('--editor-ink-strong').trim()
    const accentFg = rootStyle.getPropertyValue('--accent-foreground').trim()

    expect(bgBase.toLowerCase()).toBe('#101722')       // Dark shell
    expect(pageBg.toLowerCase()).toBe('#f7f4eb')       // Ivory paper
    expect(inkPrimary.toLowerCase()).toBe('#20252b')   // Deep ink text
    expect(inkStrong.toLowerCase()).toBe('#20252b')    // Heading ink
    expect(accentFg.toLowerCase()).toBe('#11151b')     // Accent text foreground
  })

  it('renders the starlight editor desk and paper with their actual computed colors', () => {
    applyThemeToDom('starlight')
    const host = document.createElement('div')
    host.className = 'vditor-prose-host'
    host.innerHTML = '<div class="vditor"><div class="vditor-content"><div class="vditor-ir"><pre class="vditor-reset" contenteditable="true">正文</pre></div></div></div>'
    document.body.appendChild(host)
    try {
      const desk = host.querySelector<HTMLElement>('.vditor-content')!
      const paper = host.querySelector<HTMLElement>('pre.vditor-reset')!
      expect(parseRgb(window.getComputedStyle(desk).backgroundColor)).toEqual([16, 23, 34])
      expect(parseRgb(window.getComputedStyle(paper).backgroundColor)).toEqual([247, 244, 235])
      expect(parseRgb(window.getComputedStyle(paper).color)).toEqual([32, 37, 43])
      expect(parseRgb(window.getComputedStyle(paper).caretColor)).toEqual([32, 37, 43])
    } finally {
      host.remove()
    }
  })
})

describe('Browser DOM: ThemeGallery interactive filtering and selection', () => {
  it('renders exactly 18 theme cards in the DOM', async () => {
    await act(async () => {
      reactRoot?.render(<ThemeGallery />)
    })

    const buttons = container?.querySelectorAll<HTMLButtonElement>('button[data-theme-option]')
    expect(buttons?.length).toBe(18)
  })

  it('filters themes correctly when clicking category buttons', async () => {
    await act(async () => {
      reactRoot?.render(<ThemeGallery />)
    })

    // 1. Click "浅色"
    const lightFilter = Array.from(container?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent?.trim() === '浅色'
    )
    expect(lightFilter).toBeDefined()
    await act(async () => {
      lightFilter?.click()
    })
    const lightButtons = container?.querySelectorAll<HTMLButtonElement>('button[data-theme-option]')
    expect(lightButtons?.length).toBe(12) // 10 literary + 2 base

    // 2. Click "深色"
    const darkFilter = Array.from(container?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent?.trim() === '深色'
    )
    expect(darkFilter).toBeDefined()
    await act(async () => {
      darkFilter?.click()
    })
    const darkButtons = container?.querySelectorAll<HTMLButtonElement>('button[data-theme-option]')
    expect(darkButtons?.length).toBe(5) // 3 literary + 2 base

    // 3. Click "混合"
    const mixedFilter = Array.from(container?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent?.trim() === '混合'
    )
    expect(mixedFilter).toBeDefined()
    await act(async () => {
      mixedFilter?.click()
    })
    const mixedButtons = container?.querySelectorAll<HTMLButtonElement>('button[data-theme-option]')
    expect(mixedButtons?.length).toBe(1)
    expect(mixedButtons?.[0]?.getAttribute('data-theme-option')).toBe('starlight')

    // 4. Click "全部"
    const allFilter = Array.from(container?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent?.trim() === '全部'
    )
    expect(allFilter).toBeDefined()
    await act(async () => {
      allFilter?.click()
    })
    const allButtons = container?.querySelectorAll<HTMLButtonElement>('button[data-theme-option]')
    expect(allButtons?.length).toBe(18)
  })

  it('switches theme and updates store when clicking a base theme card', async () => {
    await act(async () => {
      reactRoot?.render(<ThemeGallery />)
    })

    const galaxyCard = container?.querySelector<HTMLButtonElement>('button[data-theme-option="galaxy"]')
    expect(galaxyCard).toBeDefined()

    await act(async () => {
      galaxyCard?.click()
    })

    expect(useThemeStore.getState().theme).toBe('galaxy')
  })
})
