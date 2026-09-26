/**
 * Literary Theme definitions inspired by StoryForge.
 * Device appearance only: never rewrite manuscripts or saved editor formatting.
 */

export type LiteraryThemeId =
  | 'storyforge'
  | 'inkwash'
  | 'mist'
  | 'paper-ink'
  | 'apricot'
  | 'vellum'
  | 'gilded'
  | 'verdant'
  | 'silver-blue'
  | 'dusk'
  | 'ember'
  | 'starlight-dark'
  | 'cosmic-glass'
  | 'starlight'

export interface LiteraryThemeDefinition {
  readonly id: LiteraryThemeId
  readonly name: string
  readonly nameEn: string
  readonly description: string
  readonly descriptionEn: string
  readonly group: '浅色' | '深色' | '混合'
  readonly isDark: boolean
}

export const LITERARY_THEMES = [
  {
    id: 'storyforge',
    name: '青绿山水',
    nameEn: 'StoryForge',
    description: '青绿山景，奶油纸面。',
    descriptionEn: 'Verdant green mountains with creamy manuscript paper.',
    group: '浅色',
    isDark: false,
  },
  {
    id: 'inkwash',
    name: '水墨远山',
    nameEn: 'Ink Wash',
    description: '淡墨远山，暖宣纸面，朱砂点睛。',
    descriptionEn: 'Misty distant mountains, warm rice paper, and cinnabar accent.',
    group: '浅色',
    isDark: false,
  },
  {
    id: 'mist',
    name: '雾青桃陶',
    nameEn: 'Peach Mist',
    description: '浅雾青与桃陶按钮',
    descriptionEn: 'Pale misty green with terracotta accents.',
    group: '浅色',
    isDark: false,
  },
  {
    id: 'paper-ink',
    name: '纸与墨',
    nameEn: 'Paper & Ink',
    description: '暖灰与素纸',
    descriptionEn: 'Warm gray tones and natural raw manuscript paper.',
    group: '浅色',
    isDark: false,
  },
  {
    id: 'apricot',
    name: '暖杏书笺',
    nameEn: 'Warm Apricot',
    description: '奶油杏纸 / 淡陶粉 / 赤陶按钮',
    descriptionEn: 'Cream apricot paper with soft terracotta buttons.',
    group: '浅色',
    isDark: false,
  },
  {
    id: 'vellum',
    name: '羊皮古卷',
    nameEn: 'Vellum Scroll',
    description: '蜂蜜色羊皮纹理 / 棕墨正文 / 旧铜点缀',
    descriptionEn: 'Honeyed parchment texture, brown ink, and antique bronze accents.',
    group: '浅色',
    isDark: false,
  },
  {
    id: 'gilded',
    name: '古卷鎏金',
    nameEn: 'Gilded Manuscript',
    description: '泛黄纸面与铁胆墨',
    descriptionEn: 'Aged parchment surface with iron gall ink.',
    group: '浅色',
    isDark: false,
  },
  {
    id: 'verdant',
    name: '青绿金笺',
    nameEn: 'Verdant Gold',
    description: '金色绢底 / 石青石绿山峦 / 深青按钮',
    descriptionEn: 'Golden silk ground, mineral landscape, and deep teal accents.',
    group: '浅色',
    isDark: false,
  },
  {
    id: 'silver-blue',
    name: '银蓝书房',
    nameEn: 'Silver Blue Study',
    description: '冷灰、银蓝与淡白纸面',
    descriptionEn: 'Cool gray, silver-blue tones, and crisp pale paper.',
    group: '浅色',
    isDark: false,
  },
  {
    id: 'dusk',
    name: '暮紫星灯',
    nameEn: 'Twilight Dusk',
    description: '淡紫暮色、暖白纸面与星灯金点缀。',
    descriptionEn: 'Lavender twilight, warm white paper, and starlight gold.',
    group: '浅色',
    isDark: false,
  },
  {
    id: 'ember',
    name: '熔炉余烬',
    nameEn: 'Forge Ember',
    description: '深褐、余烬橙、暗金',
    descriptionEn: 'Deep umber, ember glow, and dark gold accents.',
    group: '深色',
    isDark: true,
  },
  {
    id: 'starlight-dark',
    name: '星夜萤黄 · 全暗版',
    nameEn: 'Starlight Dark',
    description: '深蓝灰正文 / 柔灰文字 / 低亮萤黄',
    descriptionEn: 'Deep navy slate, gentle gray text, and muted chartreuse.',
    group: '深色',
    isDark: true,
  },
  {
    id: 'cosmic-glass',
    name: '星穹 · 透光版',
    nameEn: 'Cosmic Glass',
    description: '整体星空 / 透光导航与辅助面板 / 稳定深色正文',
    descriptionEn: 'Cosmic deep space, frosted navigation, and focused dark editor.',
    group: '深色',
    isDark: true,
  },
  {
    id: 'starlight',
    name: '星夜萤黄',
    nameEn: 'Starlight Night',
    description: '深蓝黑外框 / 象牙白纸面 / 萤黄点睛',
    descriptionEn: 'Deep navy-black shell, ivory paper sheet, and vibrant chartreuse.',
    group: '混合',
    isDark: false,
  },
] as const satisfies readonly LiteraryThemeDefinition[]

export const THEME_GROUPS = ['全部', '浅色', '深色', '混合'] as const
export type ThemeGroup = typeof THEME_GROUPS[number]

export const LITERARY_THEME_IDS: ReadonlySet<string> = new Set(
  LITERARY_THEMES.map((theme) => theme.id)
)

export type LegacyTheme = 'paper' | 'light' | 'galaxy' | 'dark'

export interface BaseThemeDefinition {
  readonly id: LegacyTheme
  readonly name: string
  readonly nameEn: string
  readonly description: string
  readonly descriptionEn: string
  readonly group: '浅色' | '深色'
  readonly isDark: boolean
  readonly isBase: true
}

export const BASE_THEMES: readonly BaseThemeDefinition[] = [
  {
    id: 'paper',
    name: '温润纸面',
    nameEn: 'Paper',
    description: '素雅宣纸底色与暖灰边框，纯粹沉浸书写。',
    descriptionEn: 'Subtle paper tones and neutral borders for pure focus.',
    group: '浅色',
    isDark: false,
    isBase: true,
  },
  {
    id: 'light',
    name: '亮色白昼',
    nameEn: 'Light',
    description: '现代极简纯白底面，克制经典蓝点缀。',
    descriptionEn: 'Modern minimalist white surface with restrained classic blue.',
    group: '浅色',
    isDark: false,
    isBase: true,
  },
  {
    id: 'galaxy',
    name: '星辰暗夜',
    nameEn: 'Galaxy',
    description: '深邃星空底色，清爽冰蓝高对比点睛。',
    descriptionEn: 'Deep cosmic canvas with high-contrast ice blue accents.',
    group: '深色',
    isDark: true,
    isBase: true,
  },
  {
    id: 'dark',
    name: '深沉黑夜',
    nameEn: 'Dark',
    description: '极客深灰夜间模式，专注舒适不刺眼。',
    descriptionEn: 'Classic developer dark slate mode, comfortable and glare-free.',
    group: '深色',
    isDark: true,
    isBase: true,
  },
] as const

export type ThemeItem = LiteraryThemeDefinition | BaseThemeDefinition
export const ALL_THEMES: readonly ThemeItem[] = [...LITERARY_THEMES, ...BASE_THEMES]

export const BASE_THEME_IDS: ReadonlySet<string> = new Set(
  BASE_THEMES.map((theme) => theme.id)
)

export function isLiteraryTheme(themeId: string): themeId is LiteraryThemeId {
  return LITERARY_THEME_IDS.has(themeId)
}

export function isBaseTheme(themeId: string): themeId is LegacyTheme {
  return BASE_THEME_IDS.has(themeId)
}

export function isDarkLiteraryTheme(themeId: string): boolean {
  const theme = ALL_THEMES.find((t) => t.id === themeId)
  return theme ? theme.isDark : false
}
