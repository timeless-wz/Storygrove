import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { isTypingInInput, PlotGraphToolbar } from '../PlotGraphToolbar'

describe('PlotGraphToolbar component', () => {
  it('renders all toolbar buttons with active states for interaction mode and grid', () => {
    const htmlPan = renderToStaticMarkup(
      <PlotGraphToolbar
        interactionMode="pan"
        onInteractionModeChange={vi.fn()}
        showGrid={true}
        onToggleGrid={vi.fn()}
        onFitView={vi.fn()}
        onCenterView={vi.fn()}
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onFocusSearch={vi.fn()}
      />
    )

    expect(htmlPan).toContain('plot-graph-toolbar')
    expect(htmlPan).toContain('平移/拖动画布模式')
    expect(htmlPan).toContain('框选/选择模式')
    expect(htmlPan).toContain('点阵网格开关')
    expect(htmlPan).toContain('适应画布/全部显示')
    expect(htmlPan).toContain('居中视角')
    expect(htmlPan).toContain('放大')
    expect(htmlPan).toContain('缩小')
    expect(htmlPan).toContain('搜索定位')

    const htmlSelect = renderToStaticMarkup(
      <PlotGraphToolbar
        interactionMode="select"
        onInteractionModeChange={vi.fn()}
        showGrid={false}
        onToggleGrid={vi.fn()}
      />
    )

    expect(htmlSelect).toContain('框选/选择模式')
  })

  describe('isTypingInInput helper (keyboard shortcut safety)', () => {
    let originalDocument: Document

    beforeEach(() => {
      originalDocument = globalThis.document
    })

    afterEach(() => {
      globalThis.document = originalDocument
    })

    it('returns false when document is undefined or activeElement is null/body', () => {
      // @ts-expect-error test mock
      globalThis.document = { activeElement: null }
      expect(isTypingInInput()).toBe(false)

      // @ts-expect-error test mock
      globalThis.document = { activeElement: { tagName: 'DIV' } }
      expect(isTypingInInput()).toBe(false)
    })

    it('returns true when activeElement is INPUT or TEXTAREA tag', () => {
      // @ts-expect-error test mock
      globalThis.document = { activeElement: { tagName: 'INPUT' } }
      expect(isTypingInInput()).toBe(true)

      // @ts-expect-error test mock
      globalThis.document = { activeElement: { tagName: 'textarea' } }
      expect(isTypingInInput()).toBe(true)
    })

    it('returns true when activeElement is contentEditable', () => {
      const mockDiv = { tagName: 'DIV', isContentEditable: true }
      // @ts-expect-error test mock
      globalThis.document = { activeElement: mockDiv }
      expect(isTypingInInput()).toBe(true)
    })
  })
})
