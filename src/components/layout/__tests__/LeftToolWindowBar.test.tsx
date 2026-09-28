import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { useLayoutStore } from '../../../stores/layout-store'

const appSource = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
const titleBarSource = readFileSync(resolve(process.cwd(), 'src/components/layout/TitleBar.tsx'), 'utf8')

describe('Codex-style workbench shell', () => {
  it('does not mount a fixed activity rail or a height-reserving bottom panel', () => {
    expect(appSource).not.toContain("from './components/layout/LeftToolWindowBar'")
    expect(appSource).not.toContain("from './components/layout/RightToolWindowBar'")
    expect(appSource).not.toContain("from './components/panels/BottomPanel'")
    expect(appSource).not.toContain('<StatusBar />')
    expect(titleBarSource).toContain('<StatusBar />')
    expect(titleBarSource).toContain("currentProject && sidebarView !== 'home'")
    expect(titleBarSource).toContain('writer-topbar-workspace')
  })

  it('keeps the task popover closed by default so the editor owns the available height', () => {
    expect(useLayoutStore.getState().bottomPanelOpen).toBe(false)
    expect(useLayoutStore.getState().bottomTab).toBe('tasks')
  })
})
