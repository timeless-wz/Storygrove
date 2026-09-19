import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('language controls', () => {
  it('keeps the language switch only in the status bar', () => {
    const titleBar = readFileSync('src/components/layout/TitleBar.tsx', 'utf8')
    const statusBar = readFileSync('src/components/layout/StatusBar.tsx', 'utf8')

    expect(titleBar).not.toContain('Languages')
    expect(titleBar).not.toContain('toggleLocale')
    expect(statusBar).toMatch(/import[\s\S]*Languages[\s\S]*from 'lucide-react'/)
    expect(statusBar).toContain('toggleLocale')
  })

  it('keeps model configuration inside settings instead of the status bar', () => {
    const source = readFileSync('src/components/layout/StatusBar.tsx', 'utf8')

    expect(source).not.toContain("openSettings('llm')")
    expect(source).not.toContain('模型设置')
    expect(source).toContain("openSettings('editor')")
  })

  it('provides explicit locale choices in settings', () => {
    const source = readFileSync('src/components/settings/SettingsModal.tsx', 'utf8')

    expect(source).toContain('setLocale')
    expect(source).toContain('<option value="zh-CN">')
    expect(source).toContain('<option value="en-US">')
  })
})
