import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss, { type Container, type Declaration, type Document, type Rule } from 'postcss'
import { describe, expect, it } from 'vitest'

import { LITERARY_THEMES, isDarkLiteraryTheme } from '../shared/literary-themes'

/**
 * 主题令牌的对比度与解析契约。
 *
 * theme-text-contrast.test.ts 覆盖 :root/.paper/.light/.galaxy/.dark 的取色对比度，
 * 但两类问题落在它之外：
 *   1. 14 套文学主题从未纳入，`starlight` 的状态色曾在其深色外壳上低至 1.92:1；
 *   2. 只校验字面色值，不校验 var() 链是否收敛——`--color-surface` 等令牌曾被 45 处
 *      引用却从未定义，var() 无回退时整条声明在计算值阶段失效（背景退化为透明）。
 *
 * 主题的实际取值来自级联，不能只读主题块本身：
 *   1. index.css 的 @layer base 里的 :root（含全部语义状态色）
 *   2. index.css 的 .dark / .galaxy / .paper（theme-store 会按主题挂上对应类）
 *   3. literary-themes.css 的主题块（无 layer，胜过 @layer base）
 * 因此这里实现一个最小级联解析器，按 (layer, specificity, 源码顺序) 取胜出声明，
 * 再展开 var() 链。
 */

const cssFiles: readonly (readonly [string, number])[] = [
  [resolve(process.cwd(), 'src/index.css'), 1],
  [resolve(process.cwd(), 'src/styles/literary-themes.css'), 0],
]

/** 第二个元素为 1 表示该文件未包在 @layer 中——无 layer 的声明胜过任何 layer。 */
interface RankedDeclaration {
  readonly selector: string
  readonly prop: string
  readonly value: string
  readonly layerRank: number
  readonly order: number
}

const declarations: RankedDeclaration[] = []
let sourceOrder = 0

for (const [file, fileLayerRank] of cssFiles) {
  const parsed = postcss.parse(readFileSync(file, 'utf8'), { from: file })
  parsed.walkRules((rule: Rule) => {
    let layerRank = fileLayerRank
    let parent: Container | Document | undefined = rule.parent
    while (parent) {
      if (parent.type === 'atrule' && (parent as { name?: string }).name === 'layer') layerRank = 0
      parent = parent.parent
    }
    for (const selector of rule.selectors) {
      rule.walkDecls((declaration: Declaration) => {
        declarations.push({
          selector,
          prop: declaration.prop,
          value: declaration.value,
          layerRank,
          order: sourceOrder++,
        })
      })
    }
  })
}

/**
 * 一个主题在 DOM 上的样子：<html> 带 data-theme=<id>，并按 theme-store 的
 * applyTheme 决定是否再挂 dark/galaxy/paper 类。
 */
interface ThemeContext {
  readonly id: string
  readonly classes: readonly string[]
}

const baseThemeContexts: readonly ThemeContext[] = [
  { id: 'light', classes: [] },
  { id: 'paper', classes: ['paper'] },
  { id: 'galaxy', classes: ['galaxy'] },
  { id: 'dark', classes: ['dark'] },
]

const literaryThemeContexts: readonly ThemeContext[] = LITERARY_THEMES.map((theme) => ({
  id: theme.id,
  classes: isDarkLiteraryTheme(theme.id) ? ['dark'] : [],
}))

const literaryThemes = literaryThemeContexts.map((context) => context.id)

/**
 * 选择器在该上下文中的特异度；null 表示不匹配。只识别本仓库实际使用的几种形态，
 * 其余一律忽略，以免把 .theme-sample 预览色板或 .writer-* 组件样式误当主题令牌。
 */
function matchingSpecificity(selector: string, context: ThemeContext): number | null {
  const trimmed = selector.trim()

  if (trimmed.startsWith('.theme-sample')) return null

  const themeAttributes = [...trimmed.matchAll(/\[data-theme=(?:'([a-z-]+)'|"([a-z-]+)")\]/g)]
    .map((match) => match[1] ?? match[2])

  if (trimmed.includes(':is(') && themeAttributes.length > 0) {
    return themeAttributes.includes(context.id) ? 3 : null
  }

  if (themeAttributes.length > 0) {
    return trimmed.startsWith(':root[') && themeAttributes.includes(context.id) ? 2 : null
  }

  if (trimmed === ':root') return 1
  if (trimmed === '.paper' || trimmed === '.light' || trimmed === '.galaxy' || trimmed === '.dark') {
    return context.classes.includes(trimmed.slice(1)) ? 1 : null
  }
  return null
}

/** 解析该上下文下的有效自定义属性表（未展开 var()）。 */
function environmentFor(context: ThemeContext): Map<string, string> {
  const winners = new Map<string, { value: string; rank: readonly [number, number, number] }>()

  for (const declaration of declarations) {
    const specificity = matchingSpecificity(declaration.selector, context)
    if (specificity === null) continue
    const rank = [declaration.layerRank, specificity, declaration.order] as const
    const current = winners.get(declaration.prop)
    if (!current) {
      winners.set(declaration.prop, { value: declaration.value, rank })
      continue
    }
    for (let i = 0; i < rank.length; i += 1) {
      if (rank[i] === current.rank[i]) continue
      if (rank[i] > current.rank[i]) winners.set(declaration.prop, { value: declaration.value, rank })
      break
    }
  }

  const environment = new Map<string, string>()
  for (const [prop, winner] of winners) environment.set(prop, winner.value)
  return environment
}

const literaryEnvironments = new Map(
  literaryThemeContexts.map((context) => [context.id, environmentFor(context)]),
)

/**
 * 展开 var() 链。返回 undefined 表示引用悬空（变量未定义且无回退值）——
 * 这正是 --color-surface 曾经的状态：解析失败会让整条声明在计算值阶段失效，
 * 背景退化为透明。
 */
function resolveToken(prop: string, environment: Map<string, string>, depth = 0): string | undefined {
  const raw = environment.get(prop)
  if (raw === undefined) return undefined

  const reference = raw.match(/^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([\s\S]+))?\)$/)
  if (!reference) return raw

  if (depth < 10) {
    const inner = resolveToken(reference[1], environment, depth + 1)
    if (inner !== undefined) return inner
  }
  return reference[2]?.trim()
}

function token(theme: string, prop: string): string {
  const resolved = resolveToken(prop, literaryEnvironments.get(theme)!)
  expect(resolved, `${theme} ${prop} 应能解析出终值（悬空 var() 会让声明失效）`).toBeDefined()
  expect(resolved, `${theme} ${prop} 的 var() 链未收敛`).not.toMatch(/^var\(/)
  return resolved!
}

function hexToken(theme: string, prop: string): string {
  const resolved = token(theme, prop)
  expect(resolved, `${theme} ${prop} 需为字面 hex 才能计算对比度`).toMatch(/^#[0-9A-Fa-f]{6}$/)
  return resolved
}

/** 组件按名引用、且必须对每个主题都有确定取值的壳层令牌。 */
const shellTokens = [
  '--color-bg',
  '--color-raised',
  '--color-sidebar',
  '--color-panel',
  '--color-titlebar',
  '--color-activity-bar',
  '--color-hover',
  '--color-active',
  '--color-text',
  '--color-text-secondary',
  '--color-text-muted',
  '--color-border',
  '--color-accent',
  '--color-accent-text',
  '--color-accent-foreground',
  '--color-accent-subtle',
  '--color-surface',
  '--color-surface-raised',
  '--color-surface-subtle',
  '--color-bg-elevated',
  '--color-border-subtle',
  '--color-border-strong',
  '--color-danger',
  '--color-input',
  '--color-input-bg',
  '--color-error',
  '--color-error-text',
  '--color-error-foreground',
  '--color-success',
  '--color-success-text',
  '--color-success-foreground',
  '--color-warning',
  '--color-warning-text',
  '--color-info',
  '--color-editor-bg',
  '--color-editor-caret',
]

type Rgb = readonly [number, number, number]

function parseHex(value: string): Rgb {
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ]
}

function relativeLuminance(color: Rgb): number {
  const [red, green, blue] = color.map((channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(parseHex(foreground))
  const backgroundLuminance = relativeLuminance(parseHex(background))
  const lighter = Math.max(foregroundLuminance, backgroundLuminance)
  const darker = Math.min(foregroundLuminance, backgroundLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

/** 8 位 hex 按 alpha 合成到基底上，还原实际看到的颜色。 */
function flattenAlpha(value: string, base: string): string {
  if (value.length !== 9) return value
  const foreground = parseHex(value.slice(0, 7))
  const alpha = Number.parseInt(value.slice(7, 9), 16) / 255
  const background = parseHex(base)
  const composited = foreground.map((channel, index) =>
    Math.round(channel * alpha + background[index] * (1 - alpha)),
  )
  return `#${composited.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

const contentSurfaces = ['--bg-base', '--bg-surface', '--bg-elevated', '--bg-hover'] as const
const informationBearingText = [
  '--color-text',
  '--color-text-secondary',
  '--color-text-muted',
  '--color-error-text',
  '--color-success-text',
  '--color-warning-text',
] as const

describe('theme token resolution contract', () => {
  it.each([
    ...baseThemeContexts.map((context) => [context.id, context] as const),
    ...literaryThemeContexts.map((context) => [context.id, context] as const),
  ])('%s resolves every shell token to a terminal value', (id, context) => {
    const environment = environmentFor(context)
    for (const prop of shellTokens) {
      const resolved = resolveToken(prop, environment)
      expect(resolved, `${id} ${prop} 应能解析出终值`).toBeDefined()
      expect(resolved, `${id} ${prop} 的 var() 链未收敛`).not.toMatch(/^var\(/)
    }
  })

  /**
   * 强调色填充上的前景文字必须随主题走。组件曾硬编码 #fff：在 galaxy 的浅冰蓝
   * (#7EC8E3) 上仅 1.87:1，在 starlight 的萤黄 (#d5e64b) 上仅 1.38:1——
   * 而这几个主题早就各自定义了正确的 --accent-foreground。
   */
  it.each([
    ...baseThemeContexts.map((context) => [context.id, context] as const),
    ...literaryThemeContexts.map((context) => [context.id, context] as const),
  ])('%s keeps accent-filled control text readable', (id, context) => {
    const environment = environmentFor(context)
    const accent = resolveToken('--color-accent', environment)
    const accentForeground = resolveToken('--color-accent-foreground', environment)

    expect(accent, `${id} --color-accent`).toMatch(/^#[0-9A-Fa-f]{6}$/)
    expect(accentForeground, `${id} --color-accent-foreground 应能解析出终值`).toBeDefined()
    expect(accentForeground, `${id} --color-accent-foreground`).toMatch(/^#[0-9A-Fa-f]{6}$/)
    expect(
      contrastRatio(accentForeground!, accent!),
      `${id} --color-accent-foreground ${accentForeground} on --color-accent ${accent}`,
    ).toBeGreaterThanOrEqual(4.5)
  })
})

describe('literary theme contrast contract', () => {
  it('covers every literary theme the app can select', () => {
    expect(literaryThemes.length).toBe(14)
    expect(new Set(literaryThemes).size).toBe(literaryThemes.length)
  })

  it.each(literaryThemes)('%s keeps information-bearing text at WCAG AA on every content surface', (theme) => {
    for (const textToken of informationBearingText) {
      const foreground = hexToken(theme, textToken)
      for (const surfaceToken of contentSurfaces) {
        const surface = hexToken(theme, surfaceToken)
        expect(
          contrastRatio(foreground, surface),
          `${theme} ${textToken} ${foreground} on ${surfaceToken} ${surface}`,
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it.each(literaryThemes)('%s keeps status copy readable on its semantic fill', (theme) => {
    for (const [foregroundToken, fillToken] of [
      ['--color-error-foreground', '--color-error'],
      ['--color-success-foreground', '--color-success'],
    ] as const) {
      const foreground = hexToken(theme, foregroundToken)
      const fill = hexToken(theme, fillToken)
      expect(
        contrastRatio(foreground, fill),
        `${theme} ${foregroundToken} ${foreground} on ${fillToken} ${fill}`,
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each(literaryThemes)('%s keeps editor ink readable on its manuscript paper', (theme) => {
    const environment = literaryEnvironments.get(theme)!
    const base = hexToken(theme, '--bg-base')
    const pageSurface = resolveToken('--editor-solid-bg', environment)
      ?? resolveToken('--editor-page-bg', environment)
    expect(pageSurface, `${theme} --editor-solid-bg/--editor-page-bg`).toBeDefined()

    const paper = flattenAlpha(pageSurface!, base)
    expect(paper, `${theme} manuscript paper`).toMatch(/^#[0-9A-Fa-f]{6}$/)

    for (const inkToken of ['--editor-ink-primary', '--editor-ink-muted']) {
      const ink = hexToken(theme, inkToken)
      expect(
        contrastRatio(ink, paper),
        `${theme} ${inkToken} ${ink} on ${paper}`,
      ).toBeGreaterThanOrEqual(4.5)
    }
  })
})
