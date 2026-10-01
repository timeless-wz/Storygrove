import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { normalizeSourceEol, readNormalizedSource, withoutDecorativeClipDefinitions } from './source-contract'

describe('decorative SVG source boundary', () => {
  const geometry = '<svg width="0" height="0" aria-hidden="true" focusable="false"><defs><clipPath id="shape" clipPathUnits="objectBoundingBox"><path d="M 0 0 H 1 V 1 Z" /></clipPath></defs></svg>'
  it('allows only inert layout clip definitions and retains visible or executable SVG for rejection', () => {
    expect(withoutDecorativeClipDefinitions(geometry)).toBe('')
    for (const unsafe of [geometry.replace('width="0"', 'width="20"'), geometry.replace('<defs>', '<defs><rect />'), geometry.replace('d="M 0 0 H 1 V 1 Z"', 'd={dynamicPath}')]) {
      expect(withoutDecorativeClipDefinitions(unsafe)).toBe(unsafe)
    }
  })
})

describe('source contract normalization', () => {
  it('treats LF, CRLF, and CR source text as the same source contract', () => {
    const lf = 'first line\nsecond line\nthird line\n'
    const crlf = 'first line\r\nsecond line\r\nthird line\r\n'
    const cr = 'first line\rsecond line\rthird line\r'

    expect(normalizeSourceEol(crlf)).toBe(lf)
    expect(normalizeSourceEol(cr)).toBe(lf)
    expect(createHash('sha256').update(normalizeSourceEol(crlf)).digest('hex'))
      .toBe(createHash('sha256').update(normalizeSourceEol(lf)).digest('hex'))
  })

  it('reads CRLF source files as their canonical LF source before hashing', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'ai-novel-source-contract-'))
    const sourcePath = join(fixtureRoot, 'monitor.ps1')
    const canonicalSource = 'first\nsecond\n'

    try {
      writeFileSync(sourcePath, 'first\r\nsecond\r\n', 'utf8')

      const source = readNormalizedSource(sourcePath)
      expect(source).toBe(canonicalSource)
      expect(createHash('sha256').update(source).digest('hex'))
        .toBe('dbea9325179efe46ea2add94f7b6b745ca983fabb208dc6d34aa064623d7ee23')
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true })
    }
  })
})
