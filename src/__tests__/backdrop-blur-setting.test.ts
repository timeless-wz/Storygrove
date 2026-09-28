import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 「背景雾化」设置契约。
 *
 * 经典皮肤的外壳磨砂原本是硬编码的（backdrop-filter: blur(12px/16px) + 40~82% 不透明度），
 * 主题里为此准备的 --surface-blur / --navigation-blur 从未被引用。此处守住三条：
 *   1. 模糊与不透明度都必须经令牌，且四档能覆盖整窗背景；
 *   2. 不得再出现硬编码的固定模糊值；
 *   3. 「标准」档不写变量，使用主题定义的默认观感。
 */

const themeCss = readFileSync(resolve(process.cwd(), 'src/styles/literary-themes.css'), 'utf8')
const literaryWorkbenchCss = readFileSync(resolve(process.cwd(), 'src/styles/literary-workbench.css'), 'utf8')
const storeSource = readFileSync(resolve(process.cwd(), 'src/stores/theme-store.ts'), 'utf8')

describe('background frost setting contract', () => {
  it('routes every classic-skin chrome blur through a token with its original fallback', () => {
    // 顶栏与状态栏用 --navigation-blur，左右边栏用 --surface-blur。
    // 注意 -webkit-backdrop-filter 含 backdrop-filter 子串，故用负向后行断言只数标准属性。
    const standard = (token: string, px: number) =>
      new RegExp(`(?<!-webkit-)backdrop-filter: var\\(--${token}, blur\\(${px}px\\)\\)`, 'g')
    const webkit = (token: string, px: number) =>
      new RegExp(`-webkit-backdrop-filter: var\\(--${token}, blur\\(${px}px\\)\\)`, 'g')

    expect(themeCss.match(standard('navigation-blur', 12))).toHaveLength(2)
    expect(themeCss.match(webkit('navigation-blur', 12))).toHaveLength(2)
    expect(themeCss.match(standard('surface-blur', 16))).toHaveLength(1)
    expect(themeCss.match(webkit('surface-blur', 16))).toHaveLength(1)

    // 不允许再出现固定模糊值
    expect(themeCss).not.toMatch(/(?<!-webkit-)backdrop-filter: blur\(\d+px\)/)
  })

  it('routes all four translucent chrome surfaces through the opacity token', () => {
    const expected = [
      'color-mix(in srgb, var(--color-titlebar) var(--chrome-surface-opacity, 66%), transparent)',
      'color-mix(in srgb, var(--color-statusbar) var(--chrome-surface-opacity, 85%), transparent)',
      'color-mix(in srgb, var(--color-sidebar) var(--chrome-surface-opacity, 66%), transparent)',
      'color-mix(in srgb, var(--color-sidebar) var(--chrome-surface-opacity, 66%), transparent)',
    ]
    for (const declaration of expected) {
      expect(themeCss, declaration).toContain(declaration)
    }
    // 这四处不得再有写死的百分比
    expect(themeCss).not.toMatch(/color-mix\(in srgb, var\(--color-(?:titlebar|statusbar|sidebar)\)\s+\d+%, transparent\)/)
  })

  it('exposes four levels and makes off clear without hiding the wallpaper', () => {
    expect(storeSource).toContain("export type BackdropBlurLevel = 'off' | 'light' | 'standard' | 'strong'")
    expect(storeSource).toContain(
      "export const BACKDROP_BLUR_LEVELS: readonly BackdropBlurLevel[] = ['off', 'light', 'standard', 'strong']",
    )
    // standard 为 null ⇒ 移除覆盖、走 CSS 回退值
    expect(storeSource).toContain('standard: null')
    // 关闭档必须同时处理外壳与薄纱，否则仍会留下雾感
    expect(storeSource).toContain(
      "off: { navigationBlur: 'none', surfaceBlur: 'none', surfaceOpacity: '32%', washScale: '0%' }",
    )
  })

  it('controls the page veil but never the wallpaper image from the frost level', () => {
    // 整窗壁纸只绘在底层；首页与项目总览不能再重复绘制或覆盖它。
    expect(literaryWorkbenchCss).toMatch(/\.literary-home\s*\{\s*background: transparent;/)
    expect(literaryWorkbenchCss).toMatch(/\.literary-overview\s*\{\s*background: transparent;/)
    expect(themeCss).toContain("[data-page-wallpaper='visible'] .app-skin-root[data-skin='classic'][data-theme] .app-skin-background")
    expect(themeCss).toContain('background: var(--shell-art, none) center top / cover no-repeat var(--color-bg) !important;')
    expect(themeCss).toContain('background: var(--shell-wash-effective, transparent);')
    // effective 值由桥接层统一定义，四档只调节它的强度。
    expect(themeCss).toContain(
      '--shell-wash-effective: color-mix(in srgb, var(--shell-wash, transparent) var(--shell-wash-scale), transparent);',
    )
    expect(themeCss).toContain('--shell-wash-scale: 40%;')
    // 洗色经缩放令牌，关闭时为 0%
    expect(storeSource).toContain("style.setProperty('--shell-wash-scale', tokens.washScale)")
    expect(storeSource).toContain("style.removeProperty('--shell-wash-scale')")
    // 关键回归点：雾化档位不得再改写 --shell-background，否则「关闭雾化」会把壁纸图一起抹掉
    const blurTokenNames = storeSource.match(/const BACKDROP_BLUR_TOKEN_NAMES = \[([\s\S]*?)\] as const/)?.[1] ?? ''
    expect(blurTokenNames).not.toContain('--shell-background')
    expect(storeSource).not.toContain('flattenWallpaper')
    expect(storeSource).toContain("washScale: '20%'")
    expect(storeSource).toContain("washScale: '80%'")
    expect(storeSource).toContain("root?.setAttribute?.('data-backdrop-blur', level)")
  })

  it('keeps the wallpaper image on its own switch', () => {
    expect(storeSource).toContain("export type PageWallpaperMode = 'visible' | 'hidden'")
    expect(storeSource).toContain("if (mode === 'hidden') style.setProperty('--shell-background', 'var(--color-bg)')")
    expect(storeSource).toContain('else style.removeProperty(\'--shell-background\')')
    expect(storeSource).toContain('pageWallpaper: state.pageWallpaper')
    expect(storeSource).toContain('applyPageWallpaper(pageWallpaper)')
    // 默认必须保留壁纸，避免升级后背景图凭空消失
    expect(storeSource).toContain("pageWallpaper: 'visible',")
  })

  it('applies the level to all three tokens and persists the choice', () => {
    for (const name of [
      '--navigation-blur',
      '--surface-blur',
      '--chrome-surface-opacity',
      '--shell-wash-scale',
      '--shell-background',
    ]) {
      expect(storeSource, name).toContain(`'${name}',`)
    }
    expect(storeSource).toContain("style.setProperty('--navigation-blur', tokens.navigationBlur)")
    expect(storeSource).toContain("style.setProperty('--surface-blur', tokens.surfaceBlur)")
    expect(storeSource).toContain("style.setProperty('--chrome-surface-opacity', tokens.surfaceOpacity)")
    // 逐个判方法可用性：测试桩可能只有 setProperty 而没有 removeProperty
    expect(storeSource).toContain("typeof style?.removeProperty !== 'function'")
    expect(storeSource).toContain('backdropBlur: state.backdropBlur')
    expect(storeSource).toContain('applyBackdropBlur(backdropBlur)')
  })
})
