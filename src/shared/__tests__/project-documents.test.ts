import { describe, expect, it } from 'vitest'

import {
  PROJECT_DOCUMENTS_DIRECTORY,
  analyzeProjectDocumentMarkdown,
  documentPathFromRelativePath,
  documentTitleFromPath,
  extractMarkdownHeadings,
  isMarkdownDocumentFileName,
  normalizeManagedDocumentsPath,
  normalizeProjectDocumentPath,
  projectDocumentKnowledgeName,
  resolveProjectDocumentAssetReference,
  sanitizeProjectDocumentFileName,
  toProjectDocumentRelativePath,
} from '../project-documents'

describe('project document path boundary', () => {
  it('accepts only relative Markdown paths inside the managed directory', () => {
    expect(normalizeProjectDocumentPath('卷纲.md')).toBe('卷纲.md')
    expect(normalizeProjectDocumentPath('notes/卷一.markdown')).toBe('notes/卷一.markdown')
    expect(PROJECT_DOCUMENTS_DIRECTORY).toBe('.vela/documents')
  })

  it('rejects absolute, escaping, non-Markdown and reserved paths', () => {
    const rejected = [
      '/etc/passwd.md',
      'C:/novels/a.md',
      'c:\\novels\\a.md',
      '\\\\server\\share\\a.md',
      '../outside.md',
      'notes/../../outside.md',
      './notes/a.md',
      'notes//a.md',
      'notes/a.txt',
      'notes/a.md.exe',
      'assets/notes.md',
      'con.md',
      'notes/trailing. ',
      'notes/a:b.md',
      '',
      '   ',
    ]
    for (const candidate of rejected) {
      expect(normalizeProjectDocumentPath(candidate), candidate).toBeNull()
    }
  })

  it('rejects control characters without needing a control-character regex', () => {
    expect(normalizeManagedDocumentsPath('notes/\u0000evil.md')).toBeNull()
    expect(normalizeProjectDocumentPath('notes/\u001b.md')).toBeNull()
    expect(normalizeManagedDocumentsPath('notes/ok.md')).toBe('notes/ok.md')
  })

  it('maps between project-relative and managed-directory paths', () => {
    expect(toProjectDocumentRelativePath('notes/卷一.md'))
      .toBe('.vela/documents/notes/卷一.md')
    expect(documentPathFromRelativePath('.vela/documents/notes/卷一.md'))
      .toBe('notes/卷一.md')
    expect(documentPathFromRelativePath('.vela/project.json')).toBeNull()
    expect(documentPathFromRelativePath('.vela/documents/../project.json')).toBeNull()
    expect(toProjectDocumentRelativePath('../escape.md')).toBeNull()
  })

  it('builds safe, de-duplicated file names from author titles', () => {
    expect(sanitizeProjectDocumentFileName('卷一 卷纲')).toBe('卷一 卷纲.md')
    expect(sanitizeProjectDocumentFileName('a/b:c*?')).toBe('a-b-c.md')
    expect(sanitizeProjectDocumentFileName('笔记///')).toBe('笔记.md')
    expect(sanitizeProjectDocumentFileName('  目录.  ')).toBe('目录.md')
    expect(sanitizeProjectDocumentFileName('')).toBe('untitled.md')
    expect(sanitizeProjectDocumentFileName('CON')).toBe('_CON.md')
    expect(sanitizeProjectDocumentFileName('想法.md')).toBe('想法.md')
    const taken = ['卷一.md', '卷一 2.md']
    expect(sanitizeProjectDocumentFileName('卷一', taken)).toBe('卷一 3.md')
    expect(sanitizeProjectDocumentFileName('卷一', ['卷一.MD'])).toBe('卷一 2.md')
  })

  it('derives titles from file paths', () => {
    expect(documentTitleFromPath('notes/卷一.markdown')).toBe('卷一')
    expect(isMarkdownDocumentFileName('a.MARKDOWN')).toBe(true)
    expect(isMarkdownDocumentFileName('a.txt')).toBe(false)
  })

  it('gives same-named documents in different folders distinct knowledge names', () => {
    expect(projectDocumentKnowledgeName('卷一/设定.md')).toBe('卷一/设定.md')
    expect(projectDocumentKnowledgeName('卷二/设定.md')).toBe('卷二/设定.md')
    expect(projectDocumentKnowledgeName('卷一/设定.md'))
      .not.toBe(projectDocumentKnowledgeName('卷二/设定.md'))
    expect(projectDocumentKnowledgeName('设定.md')).toBe('设定.md')
    // 非法或不相关的名称不得被当成项目文档索引。
    expect(projectDocumentKnowledgeName('../escape.md')).toBeNull()
    expect(projectDocumentKnowledgeName('C:/x/设定.md')).toBeNull()
    expect(projectDocumentKnowledgeName('已导入.txt')).toBeNull()
  })
})

describe('project document asset references', () => {
  it('resolves managed relative image references', () => {
    expect(resolveProjectDocumentAssetReference('卷一.md', 'assets/地图.png'))
      .toBe('assets/地图.png')
    expect(resolveProjectDocumentAssetReference('notes/卷一.md', 'assets/地图.png'))
      .toBe('notes/assets/地图.png')
    expect(resolveProjectDocumentAssetReference('notes/卷一.md', '../assets/地图.png'))
      .toBe('assets/地图.png')
  })

  it('rejects external, absolute and escaping image references', () => {
    const rejected = [
      'https://example.com/x.png',
      'http://example.com/x.png',
      'data:image/png;base64,AAAA',
      'file:///C:/secret.png',
      'javascript:alert(1)',
      '//example.com/x.png',
      '/absolute/x.png',
      'C:/secret.png',
      '../../../secret.png',
      'notes/%2e%2e/%2e%2e/secret.png',
      'assets/%252e%252e/secret.png',
      'images/x.png',
      'assets/x.txt',
      '',
      '   ',
    ]
    for (const candidate of rejected) {
      expect(resolveProjectDocumentAssetReference('卷一.md', candidate), candidate).toBeNull()
    }
    expect(resolveProjectDocumentAssetReference('bad/../x.md', 'assets/x.png')).toBeNull()
  })

  it('accepts the optional Markdown title suffix and angle brackets', () => {
    expect(resolveProjectDocumentAssetReference('卷一.md', 'assets/地图.png "封面"'))
      .toBe('assets/地图.png')
    expect(resolveProjectDocumentAssetReference('卷一.md', '<assets/地图.png>'))
      .toBe('assets/地图.png')
  })
})

describe('project document markdown analysis', () => {
  it('builds an outline for heading levels 1 through 6', () => {
    const markdown = [
      '# 第一卷',
      '## 第一节',
      '### 场景',
      '#### 细节',
      '##### 备注',
      '###### 最小标题',
      '####### 不是标题',
    ].join('\n')
    const headings = extractMarkdownHeadings(markdown)
    expect(headings.map(heading => heading.level)).toEqual([1, 2, 3, 4, 5, 6])
    expect(headings[0]).toMatchObject({ text: '第一卷', line: 0, id: '第一卷' })
    expect(headings[5]).toMatchObject({ level: 6, text: '最小标题', line: 5 })
  })

  it('ignores headings inside fenced code blocks and reports unclosed fences', () => {
    const markdown = [
      '# 真标题',
      '```markdown',
      '# 代码里的标题',
      '```',
      '~~~',
      '## 也是代码',
      '~~~',
    ].join('\n')
    expect(extractMarkdownHeadings(markdown).map(heading => heading.text)).toEqual(['真标题'])

    const analysis = analyzeProjectDocumentMarkdown('```\n# 未闭合\n')
    expect(analysis.headings).toEqual([])
    expect(analysis.issues).toHaveLength(1)
    expect(analysis.issues[0].kind).toBe('unclosed-code-fence')
    expect(analysis.issues[0].line).toBe(1)
  })

  it('de-duplicates heading anchors and strips inline markup', () => {
    const headings = extractMarkdownHeadings([
      '## 重复',
      '## 重复',
      '## 带 **粗体** 与 [链接](https://example.com) 的标题',
    ].join('\n'))
    expect(headings.map(heading => heading.id)).toEqual(['重复', '重复-2', '带-粗体-与-链接-的标题'])
    expect(headings[2].text).toBe('带 粗体 与 链接 的标题')
  })

  it('never rewrites the source markdown', () => {
    const markdown = '# 标题\n\n正文 **加粗**\n'
    analyzeProjectDocumentMarkdown(markdown)
    expect(markdown).toBe('# 标题\n\n正文 **加粗**\n')
  })
})
