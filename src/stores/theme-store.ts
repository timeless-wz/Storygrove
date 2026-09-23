import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { ipc } from '../services/ipc-client'
import { type LiteraryThemeId, isDarkLiteraryTheme } from '../shared/literary-themes'

export type LegacyTheme = 'light' | 'galaxy' | 'paper' | 'dark'
export type Theme = LegacyTheme | LiteraryThemeId

// ─── 共享字体库 ─────────────────────────────────────────────────────────────

/** 内置字体 ID（界面字体和写作字体共享同一张清单） */
export type FontId = 'inter' | 'noto-sans-sc' | 'lxgw-wenkai' | 'noto-serif-sc' | 'system'

export interface FontOption {
  id: FontId
  label: string
  labelEn: string
  desc: string
  descEn: string
  /** 实际 CSS font-family 字符串 */
  family: string
  /** 预览文字（用该字体渲染，展示中英文效果） */
  preview: string
  previewEn: string
}

/** 所有内置字体（界面 + 写作共用） */
export const FONT_OPTIONS: FontOption[] = [
  {
    id: 'inter',
    label: 'Inter',
    labelEn: 'Inter',
    desc: '精心设计的现代 UI 字体，英文排版优秀，界面首选',
    descEn: 'A modern UI font designed for clear English interfaces',
    family: "'Inter', system-ui, sans-serif",
    preview: 'Aa Bb 文字 123',
    previewEn: 'Aa Bb Text 123',
  },
  {
    id: 'noto-sans-sc',
    label: '思源黑体',
    labelEn: 'Noto Sans SC',
    desc: '黑体风格，中英文兼顾，简洁现代，科幻都市题材适用',
    descEn: 'A clean modern sans serif for Chinese and English text',
    family: "'Noto Sans SC', sans-serif",
    preview: '思源黑体 Sans',
    previewEn: 'Noto Sans',
  },
  {
    id: 'lxgw-wenkai',
    label: '霞鹜文楷',
    labelEn: 'LXGW WenKai',
    desc: '楷体风格，温润典雅，最适合中文小说写作',
    descEn: 'A warm, elegant typeface suited to literary writing',
    family: "'LXGW WenKai', serif",
    preview: '春花秋月何时了',
    previewEn: 'Once upon a time',
  },
  {
    id: 'noto-serif-sc',
    label: '思源宋体',
    labelEn: 'Noto Serif SC',
    desc: '宋体风格，字形端正，印刷质感强，正式文稿首选',
    descEn: 'A formal serif with a print-like reading experience',
    family: "'Noto Serif SC', serif",
    preview: '往事如云烟，归零',
    previewEn: 'A story in print',
  },
  {
    id: 'system',
    label: '系统默认',
    labelEn: 'System UI',
    desc: 'macOS 使用苹方/SF Pro，原生手感，无需字体文件',
    descEn: 'Uses the operating system interface font with no extra files',
    family: 'system-ui, -apple-system, sans-serif',
    preview: 'Aa Bb 苹方 123',
    previewEn: 'Aa Bb System 123',
  },
]

// ─── 向后兼容：旧版 WRITING_FONT_OPTIONS 别名 ──────────────────────────────
/** @deprecated 请使用 FONT_OPTIONS */
export const WRITING_FONT_OPTIONS = FONT_OPTIONS
/** @deprecated 请使用 FontId */
export type WritingFont = FontId

// ─── 缩放常量 ─────────────────────────────────────────────────────────────

const ZOOM_STEP = 0.05
const ZOOM_MIN = 0.7
const ZOOM_MAX = 1.5
/** 基准 font-size（未缩放时 html 的字号，px） */
const BASE_FONT_SIZE = 14 as const

// ─── 背景雾化（外壳磨砂强度） ─────────────────────────────────────────────
//
// 经典皮肤的外壳用「半透明背景 + backdrop-filter」做磨砂：顶栏与状态栏读
// --navigation-blur，左右边栏读 --surface-blur，半透明度读 --chrome-surface-opacity
// （见 literary-themes.css）。三个令牌在样式表里都保留了原始值作回退，
// 因此 standard 档不写任何变量，观感与接入本设置前完全一致。
export type BackdropBlurLevel = 'off' | 'light' | 'standard' | 'strong'

export const BACKDROP_BLUR_LEVELS: readonly BackdropBlurLevel[] = ['off', 'light', 'standard', 'strong']

interface BackdropBlurTokens {
  readonly navigationBlur: string
  readonly surfaceBlur: string
  readonly surfaceOpacity: string
  /** 洗色缩放：null 表示不覆盖，沿用该主题的原始洗色 */
  readonly washScale: string | null
}

/**
 * standard 记为 null：移除覆盖，回到样式表的原始取值。
 *
 * 档位只控制「雾感」——外壳磨砂 + 页面背景的洗色薄纱，**不动壁纸图本身**。
 * 壁纸的取舍由独立的 PageWallpaperMode 决定，两者可自由组合
 * （例如「关闭雾化 + 保留壁纸」= 背景图清晰可见且没有薄纱）。
 */
export const BACKDROP_BLUR_TOKENS: Record<BackdropBlurLevel, BackdropBlurTokens | null> = {
  off: { navigationBlur: 'none', surfaceBlur: 'none', surfaceOpacity: '100%', washScale: '0%' },
  light: { navigationBlur: 'blur(6px)', surfaceBlur: 'blur(8px)', surfaceOpacity: '92%', washScale: '50%' },
  standard: null,
  strong: { navigationBlur: 'blur(20px)', surfaceBlur: 'blur(26px)', surfaceOpacity: '74%', washScale: null },
}

/** 页面背景壁纸。与雾化档位解耦，单独控制 --shell-background。 */
export type PageWallpaperMode = 'visible' | 'hidden'

export const PAGE_WALLPAPER_MODES: readonly PageWallpaperMode[] = ['visible', 'hidden']

// ─── Store 类型 ──────────────────────────────────────────────────────────

interface ThemeState {
  /** 用户选择的主题 */
  theme: Theme
  /** 实际应用的主题（解析 system 后） */
  resolvedTheme: Theme
  /** 当前缩放级别（1.0 = 100%） */
  zoom: number
  /** 当前写作字体（正文编辑区 → --font-writing） */
  writingFont: FontId
  /** 当前界面字体（UI 全局 → --font-sans） */
  uiFont: FontId
  /** 外壳磨砂（背景雾化）强度 */
  backdropBlur: BackdropBlurLevel
  /** 页面背景壁纸是否显示 */
  pageWallpaper: PageWallpaperMode
  /** 设置主题 */
  setTheme: (theme: Theme) => void
  /** 初始化主题监听 */
  initTheme: () => void
  /** 放大 */
  zoomIn: () => void
  /** 缩小 */
  zoomOut: () => void
  /** 重置缩放到 100% */
  zoomReset: () => void
  /** 直接设置缩放级别 */
  setZoom: (zoom: number) => void
  /** 设置写作字体 */
  setWritingFont: (font: FontId) => void
  /** 设置界面字体 */
  setUiFont: (font: FontId) => void
  /** 设置外壳磨砂强度 */
  setBackdropBlur: (level: BackdropBlurLevel) => void
  /** 设置页面背景壁纸显隐 */
  setPageWallpaper: (mode: PageWallpaperMode) => void
}

type PersistedThemeState = Pick<
  ThemeState,
  'theme' | 'zoom' | 'writingFont' | 'uiFont' | 'backdropBlur' | 'pageWallpaper'
>

// ─── Store ───────────────────────────────────────────────────────────────

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'paper',
      resolvedTheme: 'paper',
      zoom: 1.0,
      writingFont: 'lxgw-wenkai',
      uiFont: 'noto-sans-sc',
      backdropBlur: 'standard',
      pageWallpaper: 'visible',

      setTheme: (theme: Theme) => {
        const resolved = resolveTheme(theme)
        set({ theme, resolvedTheme: resolved })
        applyTheme(resolved)
      },

      initTheme: () => {
        const { zoom, writingFont, uiFont, backdropBlur, pageWallpaper } = get()
        let { theme } = get()

        // --- 迁移并兼容历史数据版本 ---
        // 兼容旧版系统设定的 localStorage
        if ((theme as string) === 'system') {
          theme = resolveTheme(theme)
          set({ theme })
        }
        // Zustand v5 不会为缺失 version 的历史记录调用 migrate；首次初始化时
        // 将唯一明确的旧值 night 迁移并按当前持久化版本写回。
        if ((theme as string) === 'night') {
          theme = 'dark'
          set({ theme })
        }
        const resolved = resolveTheme(theme)
        set({ resolvedTheme: resolved })
        applyTheme(resolved)
        applyZoom(zoom)
        applyWritingFont(writingFont)
        applyUiFont(uiFont)
        applyBackdropBlur(backdropBlur)
        applyPageWallpaper(pageWallpaper)
      },

      zoomIn: () => {
        const next = Math.min(ZOOM_MAX, +(get().zoom + ZOOM_STEP).toFixed(2))
        set({ zoom: next })
        applyZoom(next)
      },

      zoomOut: () => {
        const next = Math.max(ZOOM_MIN, +(get().zoom - ZOOM_STEP).toFixed(2))
        set({ zoom: next })
        applyZoom(next)
      },

      zoomReset: () => {
        set({ zoom: 1.0 })
        applyZoom(1.0)
      },

      setZoom: (zoom: number) => {
        const clamped = +Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom)).toFixed(2)
        set({ zoom: clamped })
        applyZoom(clamped)
      },

      setWritingFont: (font: FontId) => {
        set({ writingFont: font })
        applyWritingFont(font)
      },

      setUiFont: (font: FontId) => {
        set({ uiFont: font })
        applyUiFont(font)
      },

      setBackdropBlur: (level: BackdropBlurLevel) => {
        set({ backdropBlur: level })
        applyBackdropBlur(level)
      },

      setPageWallpaper: (mode: PageWallpaperMode) => {
        set({ pageWallpaper: mode })
        applyPageWallpaper(mode)
      },
    }),
    {
      name: 'ai-novel-writer-theme',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        theme: state.theme,
        zoom: state.zoom,
        writingFont: state.writingFont,
        uiFont: state.uiFont,
        backdropBlur: state.backdropBlur,
        pageWallpaper: state.pageWallpaper,
      }),
      version: 1,
      migrate: (persistedState, version) => {
        const state = persistedState as { theme?: string }
        if (version < 1 && state.theme === 'night') {
          return { ...state, theme: 'dark' } as PersistedThemeState
        }
        return persistedState as PersistedThemeState
      },
    }
  )
)

// ─── 内部工具函数 ─────────────────────────────────────────────────────────

/** 解析主题：直接返回实际值，保留对 localStorage 旧版 system 设定的向下兼容 */
function resolveTheme(theme: Theme): Theme {
  if ((theme as string) === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return theme
}

/** 应用主题到 DOM — 支持互斥的主题并同步 data-theme 与暗色模式 */
function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (typeof root.setAttribute === 'function') {
    root.setAttribute('data-theme', theme)
  }
  root.classList.remove('galaxy', 'paper', 'dark')
  if (theme === 'galaxy') {
    root.classList.add('galaxy')
  } else if (theme === 'paper') {
    root.classList.add('paper')
  } else if (theme === 'dark' || isDarkLiteraryTheme(theme)) {
    root.classList.add('dark')
  }
}

/**
 * 将缩放比例应用到整个窗口。
 * Electron 环境使用 native zoomFactor；否则降级到 html root font-size。
 */
function applyZoom(zoom: number) {
  if (ipc.isElectron) {
    ipc.setZoomFactor(zoom)
  } else {
    document.documentElement.style.fontSize = `${(BASE_FONT_SIZE * zoom).toFixed(2)}px`
  }
}

/** 将写作字体应用到 --font-writing，正文编辑器通过 CSS 变量引用 */
function applyWritingFont(font: FontId) {
  const opt = FONT_OPTIONS.find((o) => o.id === font)
  if (opt) {
    document.documentElement.style.setProperty('--font-writing', opt.family)
  }
}

/** 将界面字体应用到 --font-sans，body/html 通过 font-family: var(--font-sans) 引用 */
function applyUiFont(font: FontId) {
  const opt = FONT_OPTIONS.find((o) => o.id === font)
  if (opt) {
    document.documentElement.style.setProperty('--font-sans', opt.family)
  }
}

const BACKDROP_BLUR_TOKEN_NAMES = [
  '--navigation-blur',
  '--surface-blur',
  '--chrome-surface-opacity',
  '--shell-wash-scale',
] as const

/**
 * 将雾化档位写入 CSS 令牌：外壳磨砂（模糊 + 不透明度）与页面洗色。
 * 不涉及壁纸图——壁纸由 applyPageWallpaper 单独控制。
 * standard 档移除覆盖而非写入固定值，这样样式表里的原始取值继续生效。
 */
function applyBackdropBlur(level: BackdropBlurLevel) {
  const root = document.documentElement
  const style = root?.style
  // 与 applyTheme 一致：逐个方法判可用性，避免非浏览器环境（测试桩）缺少某个方法时抛出。
  if (typeof style?.setProperty !== 'function' || typeof style?.removeProperty !== 'function') return

  const tokens = BACKDROP_BLUR_TOKENS[level]
  if (tokens === null) {
    for (const name of BACKDROP_BLUR_TOKEN_NAMES) style.removeProperty(name)
    return
  }
  style.setProperty('--navigation-blur', tokens.navigationBlur)
  style.setProperty('--surface-blur', tokens.surfaceBlur)
  style.setProperty('--chrome-surface-opacity', tokens.surfaceOpacity)
  if (tokens.washScale === null) style.removeProperty('--shell-wash-scale')
  else style.setProperty('--shell-wash-scale', tokens.washScale)
}

/**
 * 页面背景壁纸显隐。隐藏时把整窗与页面两处的 --shell-background 压平为纯主题色底；
 * 显示时移除覆盖，回到各主题原始的壁纸定义。
 */
function applyPageWallpaper(mode: PageWallpaperMode) {
  const style = document.documentElement?.style
  if (typeof style?.setProperty !== 'function' || typeof style?.removeProperty !== 'function') return

  if (mode === 'hidden') style.setProperty('--shell-background', 'var(--color-bg)')
  else style.removeProperty('--shell-background')
}
