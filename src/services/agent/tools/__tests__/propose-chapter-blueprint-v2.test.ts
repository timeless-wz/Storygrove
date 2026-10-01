import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { getBlueprintV2Scenes } from '../../../../shared/blueprint-v2'
import { parseChapterBlueprintMarkdown } from '../../../../shared/blueprint-v2-markdown'
import { buildChapterBlueprintProposal } from '../propose-chapter-blueprint.tool'

const fixture = readFileSync(path.join(__dirname, '../../../../../test/fixtures/blueprint-v2/chapter-01.md'), 'utf8')

describe('v2 chapter-blueprint proposal projection', () => {
  it('shows scene-body and unknown-section changes in field-level diffs without dropping v2 content', () => {
    const currentContent = parseChapterBlueprintMarkdown(fixture).content
    const currentDetail = { ...currentContent, revision: 3, contentHash: 'current-hash' }
    const proposedMarkdown = fixture
      .replace('许渡猛地从操作台板上弹坐而起', '许渡猛地从操作台板上站起')
      + '\n#### 【未识别的附加要求】\n不得删除该段自定义正文。\n'
    const proposal = buildChapterBlueprintProposal({
      chapter_number: 1,
      v2_markdown: proposedMarkdown,
    }, { chapterNumber: 1 }, undefined, currentDetail)

    expect(proposal.valid).toBe(true)
    if (!proposal.valid) return
    expect(proposal.v2Content?.sections.some(section => (
      section.kind === 'custom' && section.title === '【未识别的附加要求】'
        && section.body.includes('不得删除该段自定义正文。')
    ))).toBe(true)
    expect(getBlueprintV2Scenes(proposal.v2Content!).map(scene => scene.title)).toHaveLength(4)
    expect(proposal.v2Diffs?.some(diff => (
      diff.field.startsWith('v2:storyboard:')
        && String(diff.current).includes('许渡猛地从操作台板上弹坐而起')
        && String(diff.proposed).includes('许渡猛地从操作台板上站起')
    ))).toBe(true)
    expect(proposal.v2Diffs?.some(diff => (
      diff.field.startsWith('v2:custom-')
        && String(diff.proposed).includes('不得删除该段自定义正文。')
    ))).toBe(true)
  })
})
