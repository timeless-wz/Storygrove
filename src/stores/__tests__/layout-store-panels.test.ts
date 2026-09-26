import { describe, expect, it, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { useLayoutStore } from '../layout-store'

describe('layout-store workbench panels', () => {
  beforeEach(() => {
    useLayoutStore.setState({
      referencePanelOpen: false,
      aiPanelOpen: false,
      rightView: 'agent',
    })
  })

  it('keeps referencePanelOpen false by default so right bar is hidden on project open', () => {
    expect(useLayoutStore.getState().referencePanelOpen).toBe(false)
    expect(useLayoutStore.getState().aiPanelOpen).toBe(false)
  })

  it('closes aiPanelOpen when opening reference panel via toggleReferencePanel', () => {
    useLayoutStore.setState({ aiPanelOpen: true, referencePanelOpen: false })
    useLayoutStore.getState().toggleReferencePanel()
    expect(useLayoutStore.getState().referencePanelOpen).toBe(true)
    expect(useLayoutStore.getState().aiPanelOpen).toBe(false)
  })

  it('closes aiPanelOpen when opening reference panel via setReferencePanelOpen(true)', () => {
    useLayoutStore.setState({ aiPanelOpen: true, referencePanelOpen: false })
    useLayoutStore.getState().setReferencePanelOpen(true)
    expect(useLayoutStore.getState().referencePanelOpen).toBe(true)
    expect(useLayoutStore.getState().aiPanelOpen).toBe(false)
  })

  it('toggles reference panel closed without re-opening AI panel', () => {
    useLayoutStore.setState({ referencePanelOpen: true, aiPanelOpen: false })
    useLayoutStore.getState().toggleReferencePanel()
    expect(useLayoutStore.getState().referencePanelOpen).toBe(false)
    expect(useLayoutStore.getState().aiPanelOpen).toBe(false)
  })

  it('enforces pixel units and mutual exclusivity in App.tsx to prevent panel overlapping and squishing', () => {
    const appSource = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')

    // reference panel must be guarded against aiPanelOpen
    expect(appSource).toContain('referencePanelOpen && !aiPanelOpen')

    // project-reference must not use numeric 22 (which caused 22px squishing)
    expect(appSource).not.toMatch(/id="project-reference"\s+defaultSize=\{22\}/)
    expect(appSource).toContain('id="project-reference" defaultSize="280px" minSize="220px"')

    // ai-panel must not use numeric 20 (which caused 20px squishing)
    expect(appSource).not.toMatch(/id="ai-panel"\s+defaultSize=\{20\}/)
    expect(appSource).toContain('id="ai-panel" defaultSize="340px" minSize="260px"')
  })
})
