import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Storygrove README language variants', () => {
  it('keeps both language entry points on the current repository and documents MCP', () => {
    for (const name of ['README.md', 'README_en.md']) {
      const readme = readFileSync(name, 'utf8')
      expect(readme).toContain('# Storygrove')
      expect(readme).toContain('https://github.com/timeless-wz/Storygrove')
      expect(readme).toContain('docs/mcp-server.md')
      expect(readme).toContain('UPSTREAM.md')
      expect(readme).not.toContain('https://github.com/EthanYoQ/')
    }
    expect(readFileSync('README.md', 'utf8')).toContain('[English](README_en.md)')
    expect(readFileSync('README_en.md', 'utf8')).toContain('[中文](README.md)')
  })
})
