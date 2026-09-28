import { useState, type ReactNode } from 'react'
import {
  Check,
  Image,
  Trash2,
  Upload,
  Waves,
} from 'lucide-react'

import { cn } from '../../lib/utils'
import { useLocaleStore } from '../../stores/locale-store'
import { useSkinStore } from '../../stores/skin-store'
import {
  useThemeStore,
  type BackdropBlurLevel,
  type PageWallpaperMode,
} from '../../stores/theme-store'
import type { SkinId } from '../../shared/skin-types'
import { ThemeGallery } from './ThemeGallery'

/**
 * Vite's base is deliberately relative for BrowserWindow.loadFile().  This
 * keeps the public asset rooted at dist/ both in development and in a
 * packaged file:// renderer.
 */
const skinAssetBase = import.meta.env.BASE_URL === '/' ? './' : import.meta.env.BASE_URL
export const ANIME_SKIN_URL = `${skinAssetBase}skins/anime-night.webp`

/** Native picker validation is authoritative; this copy makes its limits visible first. */
export const CUSTOM_SKIN_REQUIREMENTS = {
  acceptedMimeTypes: ['image/png', 'image/jpeg'],
  maxBytes: 20 * 1024 * 1024,
  recommendedAspectRatio: '16:10',
} as const

type WorkingAction = 'classic' | 'anime' | 'choose' | 'change' | 'remove' | null

/**
 * 外壳磨砂档位。「标准」复用样式表原始取值，所以它是接入本设置前的观感。
 */
const BACKDROP_BLUR_OPTIONS: Array<{ id: BackdropBlurLevel; zh: string; en: string }> = [
  { id: 'off', zh: '关闭', en: 'Off' },
  { id: 'light', zh: '轻', en: 'Light' },
  { id: 'standard', zh: '标准', en: 'Standard' },
  { id: 'strong', zh: '强', en: 'Strong' },
]

/** 壁纸显隐独立于雾化档位，便于「无薄纱但保留背景图」这类组合。 */
const PAGE_WALLPAPER_OPTIONS: Array<{ id: PageWallpaperMode; zh: string; en: string }> = [
  { id: 'visible', zh: '显示', en: 'Shown' },
  { id: 'hidden', zh: '隐藏', en: 'Hidden' },
]

// eslint-disable-next-line react-refresh/only-export-components
export function getCustomSkinActionIds(customAvailable: boolean): Array<'choose' | 'change' | 'remove'> {
  return customAvailable ? ['change', 'remove'] : ['choose']
}

/** Theme owns the window wallpaper; image skins add a decorative layer above it. */
export default function AppearanceSettings() {
  const backdropBlur = useThemeStore((state) => state.backdropBlur)
  const setBackdropBlur = useThemeStore((state) => state.setBackdropBlur)
  const pageWallpaper = useThemeStore((state) => state.pageWallpaper)
  const setPageWallpaper = useThemeStore((state) => state.setPageWallpaper)
  const { text, t } = useLocaleStore()
  const skinState = useSkinStore((state) => state.skinState)
  const backgroundUrl = useSkinStore((state) => state.backgroundUrl)
  const notice = useSkinStore((state) => state.notice)
  const activateSkin = useSkinStore((state) => state.activateSkin)
  const importCustomSkin = useSkinStore((state) => state.importCustomSkin)
  const removeCustomSkin = useSkinStore((state) => state.removeCustomSkin)
  const dismissNotice = useSkinStore((state) => state.dismissNotice)
  const [working, setWorking] = useState<WorkingAction>(null)

  const run = async (action: Exclude<WorkingAction, null>, operation: () => Promise<boolean>) => {
    setWorking(action)
    try {
      await operation()
    } finally {
      setWorking(null)
    }
  }

  const selectSkin = (skinId: Exclude<SkinId, 'custom'>) => {
    void run(skinId, () => activateSkin(skinId))
  }

  const chooseCustomSkin = (action: 'choose' | 'change') => {
    void run(action, importCustomSkin)
  }

  const selectCustomSkin = () => {
    if (skinState.customSkin) {
      void run('change', () => activateSkin('custom'))
      return
    }
    chooseCustomSkin('choose')
  }

  const isCustomAvailable = skinState.customSkin !== null
  const customActionIds = getCustomSkinActionIds(isCustomAvailable)
  const customPreview = backgroundUrl ?? undefined

  return (
    <section className="appearance-settings max-w-3xl space-y-7" aria-label={t('appearance.section')}>
      {/* 主题画廊（统一包含 14 套文学主题与 4 套经典基础主题） */}
      <ThemeGallery />

      {/* 背景雾化：外壳磨砂 + 页面薄纱强度；壁纸显隐是独立开关 */}
      <div className="space-y-1.5 pt-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            {text('背景雾化', 'Background Frost')}
          </span>
          <span className="text-2xs" style={{ color: 'var(--color-text-muted)' }}>
            {text('外壳磨砂与页面薄纱强度；不影响背景壁纸', 'Chrome frost and page veil strength; the wallpaper is separate')}
          </span>
        </div>
        <div
          className="appearance-theme-grid"
          role="group"
          aria-label={text('背景雾化', 'Background Frost')}
        >
          {BACKDROP_BLUR_OPTIONS.map(({ id, zh, en }) => (
            <button
              key={id}
              type="button"
              aria-pressed={backdropBlur === id}
              onClick={() => setBackdropBlur(id)}
              className={cn('appearance-theme-option', backdropBlur === id && 'appearance-theme-option--active')}
            >
              <Waves size={15} aria-hidden="true" />
              <span>{text(zh, en)}</span>
              {backdropBlur === id && <Check size={14} aria-hidden="true" />}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between pt-2">
          <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            {text('背景壁纸', 'Background Wallpaper')}
          </span>
          <span className="text-2xs" style={{ color: 'var(--color-text-muted)' }}>
            {text('主题自带的整窗背景图', 'The theme-wide background image')}
          </span>
        </div>
        <div
          className="appearance-theme-grid"
          role="group"
          aria-label={text('背景壁纸', 'Background Wallpaper')}
        >
          {PAGE_WALLPAPER_OPTIONS.map(({ id, zh, en }) => (
            <button
              key={id}
              type="button"
              aria-pressed={pageWallpaper === id}
              onClick={() => setPageWallpaper(id)}
              className={cn('appearance-theme-option', pageWallpaper === id && 'appearance-theme-option--active')}
            >
              <Image size={15} aria-hidden="true" />
              <span>{text(zh, en)}</span>
              {pageWallpaper === id && <Check size={14} aria-hidden="true" />}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Image size={16} aria-hidden="true" style={{ color: 'var(--color-accent)' }} />
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{t('appearance.skins')}</h3>
          </div>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('appearance.skinsDescription')}</p>
        </div>

        <div className="appearance-skin-grid">
          <SkinCard
            skinId="classic"
            active={skinState.activeSkin === 'classic'}
            title={t('appearance.classic')}
            description={t('appearance.classicDescription')}
            previewClassName="appearance-skin-preview--classic"
            busy={working === 'classic'}
            onSelect={() => selectSkin('classic')}
          />
          <SkinCard
            skinId="anime"
            active={skinState.activeSkin === 'anime'}
            title={t('appearance.anime')}
            description={t('appearance.animeDescription')}
            previewClassName="appearance-skin-preview--anime"
            previewUrl={ANIME_SKIN_URL}
            busy={working === 'anime'}
            onSelect={() => selectSkin('anime')}
          />
          <SkinCard
            skinId="custom"
            active={skinState.activeSkin === 'custom'}
            title={t('appearance.custom')}
            description={isCustomAvailable ? t('appearance.customAvailable') : t('appearance.customUnavailable')}
            previewClassName="appearance-skin-preview--custom"
            previewUrl={customPreview}
            busy={working === 'choose' || working === 'change'}
            onSelect={selectCustomSkin}
          >
            <p className="appearance-skin-hint">{t('appearance.customHint')}</p>
            <div className="appearance-skin-actions">
              {customActionIds.includes('change') ? (
                <>
                  <button
                    type="button"
                    data-skin-action="change"
                    className="appearance-action-button"
                    disabled={working !== null}
                    onClick={() => chooseCustomSkin('change')}
                  >
                    <Upload size={14} aria-hidden="true" />
                    {t('appearance.change')}
                  </button>
                  <button
                    type="button"
                    data-skin-action="remove"
                    className="appearance-action-button appearance-action-button--danger"
                    disabled={working !== null}
                    onClick={() => void run('remove', removeCustomSkin)}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    {t('appearance.remove')}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  data-skin-action="choose"
                  className="appearance-action-button"
                  disabled={working !== null}
                  onClick={() => chooseCustomSkin('choose')}
                >
                  <Upload size={14} aria-hidden="true" />
                  {t('appearance.choose')}
                </button>
              )}
            </div>
          </SkinCard>
        </div>
      </div>

      {notice && (
        <div className="appearance-notice" role="status" aria-live="polite">
          <span>{text(notice.zh, notice.en)}</span>
          <button type="button" onClick={dismissNotice} className="appearance-notice-dismiss">
            {t('common.close')}
          </button>
        </div>
      )}
    </section>
  )
}

function SkinCard({
  skinId,
  active,
  title,
  description,
  previewClassName,
  previewUrl,
  busy,
  onSelect,
  children,
}: {
  skinId: SkinId
  active: boolean
  title: string
  description: string
  previewClassName: string
  previewUrl?: string
  busy: boolean
  onSelect: () => void
  children?: ReactNode
}) {
  const text = useLocaleStore((state) => state.text)

  return (
    <article
      data-skin-card={skinId}
      className={cn('appearance-skin-card', active && 'appearance-skin-card--active')}
    >
      <button
        type="button"
        className="appearance-skin-select"
        aria-pressed={active}
        disabled={busy}
        onClick={onSelect}
      >
        <span
          className={cn('appearance-skin-preview', previewClassName)}
          style={previewUrl ? { backgroundImage: `url("${previewUrl}")` } : undefined}
          aria-hidden="true"
        />
        <span className="appearance-skin-copy">
          <span className="flex items-center gap-1.5">
            <strong>{title}</strong>
            {active && <Check size={14} aria-label={text('当前使用', 'Selected')} />}
          </span>
          <span>{description}</span>
        </span>
      </button>
      {children}
    </article>
  )
}
