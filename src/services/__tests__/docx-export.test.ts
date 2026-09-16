import { describe, expect, it } from 'vitest'
import { createDocxBase64 } from '../docx-export'

describe('createDocxBase64', () => {
  it('creates a real OOXML ZIP package instead of renamed HTML', () => {
    const base64 = createDocxBase64('测试书', 'zh-CN', [{
      chapterNumber: 31,
      title: '归来',
      content: '第一段\n第二段',
    }])
    const bytes = Buffer.from(base64, 'base64')
    expect(bytes.subarray(0, 4).toString('hex')).toBe('504b0304')
    const packageText = bytes.toString('utf8')
    expect(packageText).toContain('[Content_Types].xml')
    expect(packageText).toContain('word/document.xml')
    expect(packageText).toContain('第31章 归来')
    expect(packageText).not.toContain('<html>')
  })
})
