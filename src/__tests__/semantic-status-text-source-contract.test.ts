import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const srcRoot = resolve(process.cwd(), 'src')

function productionStyleSources(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    if (name === '__tests__') return []
    if (statSync(path).isDirectory()) return productionStyleSources(path)
    return /\.(?:ts|tsx|css)$/.test(name) ? [path] : []
  })
}

describe('semantic status text source contract', () => {
  /**
   * 曾经只禁 text- 前缀，于是 bg-red-500/10、border-yellow-500/30、from-amber-500
   * 这类写法大量漏网——它们与 text- 一样绕过 14 套主题，在深色主题上会突兀甚至不可读
   * （例如 from-amber-500 渐变按钮配 text-white，白字压在 #f59e0b 上仅约 2.1:1）。
   * 现在覆盖全部颜色前缀；语义色请用 var(--color-*) 或
   * color-mix(in_srgb,var(--color-*)_N%,transparent)。
   */
  it('does not encode status or category colors with fixed Tailwind palette classes', () => {
    const prefixes = 'text|bg|border|divide|ring|outline|from|to|via|fill|stroke|shadow|accent|caret|decoration|placeholder'
    const palettes = 'red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'
    const paletteClassPattern = new RegExp(`(?<![\\w-])(?:${prefixes})-(?:${palettes})-\\d+(?:\\/\\d+)?`, 'g')

    const violations = productionStyleSources(srcRoot).flatMap((path) => {
      const source = readFileSync(path, 'utf8')
      return [...source.matchAll(paletteClassPattern)]
        .map((match) => `${relative(process.cwd(), path).replace(/\\/g, '/')}:${match[0]}`)
    })

    expect(violations).toEqual([])
  })

  it('keeps shared draft status labels on semantic theme text tokens', () => {
    const source = readFileSync(resolve(srcRoot, 'shared/draft-status.ts'), 'utf8')
    const colorMap = source.match(/export const DRAFT_STATUS_COLOR[^=]*=\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''

    expect(colorMap).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/)
    expect(colorMap).not.toMatch(/\brgb(?:a)?\(/)
  })

  it('limits decoration-only status colors to an explicit reviewed allowlist', () => {
    const allowed = new Set([
      'src/index.css:.ai-task-capsule--complete',
      'src/styles/agent-tools.css:.tool-call-status.completed',
      'src/styles/agent-tools.css:.tool-call-status.failed',
      'src/styles/agent-tools.css:.tool-call-status.waiting_confirm',
      'src/styles/agent-tools.css:.confirm-card-btn.approve',
    ])
    const violations = productionStyleSources(srcRoot).flatMap((path) => {
      const source = readFileSync(path, 'utf8')
      if (path.endsWith('index.css') || path.endsWith('agent-tools.css')) {
        return [...source.matchAll(/([^{}]+)\{[^{}]*color:\s*var\(--color-(?:success|error|warning)\);[^{}]*\}/g)]
          .map((match) => `${relative(process.cwd(), path).replace(/\\/g, '/')}:${match[1].trim()}`)
          .filter((entry) => !allowed.has(entry))
      }
      return []
    })

    expect(violations).toEqual([])
  })
})
