import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { useLayoutStore } from '../../../stores/layout-store'

const appSource = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')

describe('Codex-style workbench shell', () => {
  it('does not mount a fixed activity rail or a height-reserving bottom panel', () => {
    expect(appSource).not.toContain("from './components/layout/LeftToolWindowBar'")
    expect(appSource).not.toContain("from './components/layout/RightToolWindowBar'")
    expect(appSource).not.toContain("from './components/panels/BottomPanel'")
    expect(appSource).toContain('<StatusBar />')
  })

  it('keeps the task popover closed by default so the editor owns the available height', () => {
    expect(useLayoutStore.getState().bottomPanelOpen).toBe(false)
    expect(useLayoutStore.getState().bottomTab).toBe('tasks')
  })
})
