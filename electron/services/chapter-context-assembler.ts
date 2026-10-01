import { CultivationRepository } from '../repositories/cultivation-repository'
import { createHash } from 'node:crypto'
import { getProjectDb } from '../database'
import { CharacterRosterRepository } from '../repositories/character-roster-repository'
import { NarrativeThreadRepository } from '../repositories/narrative-thread-repository'
import { DraftRepository } from '../repositories/draft-repository'
import { WorkspaceHubRepository } from '../repositories/workspace-hub-repository'
import { extractChapterRange, isChapterInRange } from './workspace-scanner-service'
import type {
  ChapterContextBundle,
  ChapterContextBlock,
  ChapterContextOmission,
  ChapterContextSourceRef,
  SettingRule,
} from '../../src/shared/workspace-hub'

declare module '../../src/shared/workspace-hub' {
  interface ChapterContextSourceRef {
    projectId?: string
    sourceId?: string | null
    approvedSnapshotId?: string | null
    sourceSnapshotFragmentId?: string | null
    filePath?: string
    titlePath?: string
    provenanceStatus?: 'found' | 'provenance-missing'
    provenanceError?: string
  }
}

function hashString(str: string): string {
  return createHash('sha256').update(str, 'utf8').digest('hex')
}

function formatFragmentSourceRef(
  f: {
    sourceId?: string
    approvedSnapshotId?: string | null
    fragmentId: string
    sourcePath: string
    headingPath: string
    fragmentHash: string
    startLine: number
    endLine: number
  },
  projectId = 'main',
): ChapterContextSourceRef {
  const isMissing = !f.fragmentId || !f.approvedSnapshotId
  return {
    projectId,
    sourceId: f.sourceId || null,
    approvedSnapshotId: f.approvedSnapshotId || null,
    snapshotId: f.approvedSnapshotId || null,
    sourceSnapshotFragmentId: f.fragmentId,
    fragmentId: f.fragmentId,
    relativePath: f.sourcePath,
    filePath: f.sourcePath,
    headingPath: f.headingPath,
    titlePath: f.headingPath,
    contentHash: f.fragmentHash,
    lineRange: `${f.startLine}-${f.endLine}`,
    provenanceStatus: isMissing ? 'provenance-missing' : 'found',
  }
}

function resolveRuleSourceRef(
  db: ReturnType<typeof getProjectDb>,
  r: SettingRule,
  projectId = 'main',
): ChapterContextSourceRef {
  // 1. 禁止跨项目读取来源：若规则显式属于其他项目，立即失败关闭并标记 provenance-missing
  if (r.projectId && r.projectId !== projectId) {
    return {
      projectId,
      sourceId: null,
      approvedSnapshotId: null,
      snapshotId: null,
      sourceSnapshotFragmentId: undefined,
      fragmentId: undefined,
      relativePath: r.sourceFile || 'setting_rules',
      filePath: r.sourceFile || 'setting_rules',
      headingPath: r.sourceHeadingPath || r.title,
      titlePath: r.sourceHeadingPath || r.title,
      lineRange: r.sourceLineRange,
      contentHash: '',
      provenanceStatus: 'provenance-missing',
      provenanceError: `跨项目读取已禁止：规则所属项目 [${r.projectId}] 与当前装配项目 [${projectId}] 不匹配`,
    }
  }

  let fragRow: {
    id: string
    snapshot_id: string
    source_id: string
    project_id: string
    fragment_hash: string
    heading_path: string
  } | undefined

  const fragId = r.sourceSnapshotFragmentId || r.sourceFragmentId
  const snapId = r.sourceSnapshotId
  const srcId = r.sourceId

  // 2. 来源回查：若规则具备快照片段 ID，SQL 查询必须同时严格校验 project_id, source_id, snapshot_id, fragment_id 四要素
  if (db && fragId) {
    if (snapId && srcId) {
      fragRow = db.prepare(`
        SELECT id, snapshot_id, source_id, project_id, fragment_hash, heading_path
        FROM workspace_source_snapshot_fragments
        WHERE id = ? AND snapshot_id = ? AND source_id = ? AND project_id = ?
      `).get(fragId, snapId, srcId, projectId) as typeof fragRow
    } else {
      // 容错：若 snapId 或 srcId 缺失，仍必须限制 project_id 与 id，并进一步校验一致性
      const candidate = db.prepare(`
        SELECT id, snapshot_id, source_id, project_id, fragment_hash, heading_path
        FROM workspace_source_snapshot_fragments
        WHERE id = ? AND project_id = ?
      `).get(fragId, projectId) as typeof fragRow

      if (candidate) {
        const snapMatches = !snapId || candidate.snapshot_id === snapId
        const srcMatches = !srcId || candidate.source_id === srcId
        if (snapMatches && srcMatches) {
          fragRow = candidate
        }
      }
    }

    // 关键收口：若指定了 fragId 但 4 要素校验未通过，绝不允许回退猜测或兜底，必须失败关闭
    if (!fragRow) {
      return {
        projectId,
        sourceId: srcId || null,
        approvedSnapshotId: snapId || null,
        snapshotId: snapId || null,
        sourceSnapshotFragmentId: undefined,
        fragmentId: undefined,
        relativePath: r.sourceFile || 'setting_rules',
        filePath: r.sourceFile || 'setting_rules',
        headingPath: r.sourceHeadingPath || r.title,
        titlePath: r.sourceHeadingPath || r.title,
        lineRange: r.sourceLineRange,
        contentHash: '',
        provenanceStatus: 'provenance-missing',
        provenanceError: `规则来源与快照片段不一致：在项目 [${projectId}] 中未找到同时满足 fragment_id=[${fragId}], snapshot_id=[${snapId}], source_id=[${srcId}] 的快照片段凭据（已失败关闭）`,
      }
    }
  }

  // 3. 自愈容错路径：仅当未提供 fragId 时，若具备快照 ID、来源 ID 与标题路径，在同一 project_id 下严格按标题路径反查片段 ID
  if (db && !fragRow && !fragId && snapId && srcId && r.sourceHeadingPath) {
    const candidate = db.prepare(`
      SELECT id, snapshot_id, source_id, project_id, fragment_hash, heading_path
      FROM workspace_source_snapshot_fragments
      WHERE snapshot_id = ? AND source_id = ? AND project_id = ? AND heading_path = ?
      LIMIT 1
    `).get(snapId, srcId, projectId, r.sourceHeadingPath) as typeof fragRow

    if (candidate) {
      fragRow = candidate
    }
  }

  // 4. 严格禁止静默回退到“该快照的第一个片段”！若未找到精确来源，返回明确的 provenance-missing 状态与失败关闭错误
  const isFound = Boolean(fragRow)
  const isCandidateOrigin = r.originType !== 'scan'
  const provenanceStatus: 'found' | 'provenance-missing' = (isFound || isCandidateOrigin) ? 'found' : 'provenance-missing'

  const resolvedFragId = fragRow?.id || (isFound ? (r.sourceSnapshotFragmentId || r.sourceFragmentId) : undefined)
  const resolvedSnapId = fragRow?.snapshot_id || snapId || null
  const resolvedSourceId = fragRow?.source_id || srcId || null
  const resolvedHash = fragRow?.fragment_hash || (isFound ? hashString(r.content) : '')
  const provenanceError = provenanceStatus === 'provenance-missing'
    ? `规则来源快照片段未找到或凭据缺失（project: ${projectId}, rule: ${r.ruleId}）`
    : undefined

  return {
    projectId,
    sourceId: resolvedSourceId,
    approvedSnapshotId: resolvedSnapId,
    snapshotId: resolvedSnapId,
    sourceSnapshotFragmentId: resolvedFragId || undefined,
    fragmentId: resolvedFragId || undefined,
    relativePath: r.sourceFile || 'setting_rules',
    filePath: r.sourceFile || 'setting_rules',
    headingPath: fragRow?.heading_path || r.sourceHeadingPath || r.title,
    titlePath: fragRow?.heading_path || r.sourceHeadingPath || r.title,
    lineRange: r.sourceLineRange,
    contentHash: resolvedHash,
    provenanceStatus,
    provenanceError,
  }
}

export interface AssembleChapterContextOptions {
  projectId?: string
  chapterNumber: number
  budgetChars?: number
  includeCandidates?: boolean
  includeBackgroundLore?: boolean
}

const DEFAULT_BUDGET_CHARS = 16_000

export class ChapterContextAssembler {
  /**
   * 按照确定性 13 阶段装配目标章节上下文包
   */
  static assemble(options: AssembleChapterContextOptions): ChapterContextBundle {
    const db = getProjectDb()
    if (!db) throw new Error('项目数据库未打开')

    const projectId = options.projectId ?? 'main'
    const chapterNumber = options.chapterNumber
    const budgetLimit = options.budgetChars ?? DEFAULT_BUDGET_CHARS
    let remainingBudget = budgetLimit

    const blocks: ChapterContextBlock[] = []
    const omissions: ChapterContextOmission[] = []
    const staleWarnings: string[] = []
    const candidateWarnings: string[] = []

    // 预先统计废案，为 Stage 13 废案排除保留最低安全预算，确保可选/素材阶段（Stage 3-12）不会挤占安全负向约束
    const deprecatedRules = WorkspaceHubRepository.listRules(projectId, 'deprecated')
    const deprecatedFragments = WorkspaceHubRepository.queryFragments({
      projectId,
      categories: ['deprecated'],
      excludeDeprecated: false,
    })
    const excludedDeprecatedCount = deprecatedRules.length + deprecatedFragments.length
    const STAGE13_MIN_RESERVED_BUDGET = excludedDeprecatedCount > 0
      ? Math.min(400, Math.max(120, excludedDeprecatedCount * 30 + 80))
      : 0

    const tryAddBlock = (block: ChapterContextBlock, isProtected = false): boolean => {
      const len = block.content.length
      // 非受保护块必须尊重 Stage 13 的最低保留预算，防止素材阶段耗尽额度导致负向安全约束无法加入
      const availableBudget = (isProtected || block.stage === 13)
        ? remainingBudget
        : Math.max(0, remainingBudget - STAGE13_MIN_RESERVED_BUDGET)

      if (!isProtected && len > availableBudget) {
        omissions.push({
          stage: block.stage,
          stageName: block.stageName,
          title: block.title,
          reason: 'budget',
          sourceInfo: block.sourceFile ?? block.sourceType,
        })
        return false
      }
      blocks.push(block)
      remainingBudget = Math.max(0, remainingBudget - len)
      if (block.isStale && block.sourceFile) {
        staleWarnings.push(`${block.sourceFile}: 索引可能已过期，请重新扫描`)
      }
      if (block.isCandidate) {
        candidateWarnings.push(`${block.title}: 候选内容，不得当作已确认事实`)
      }
      return true
    }

    // stale 只表示“观察快照尚未批准”，与历史片段自身状态分离。
    const allSources = WorkspaceHubRepository.listSources(projectId)
    const staleSources = allSources.filter(s => (
      Boolean(s.approvedSnapshotId)
      && Boolean(s.observedSnapshotId)
      && s.approvedSnapshotId !== s.observedSnapshotId
    ))
    for (const s of staleSources) {
      const snapInfo = s.approvedSnapshotId ? `（当前继续使用已批准快照: ${s.approvedSnapshotId}）` : '（尚无已批准快照）'
      staleWarnings.push(`${s.relativePath}: 文件在外部已变更，新版本尚未批准${snapInfo}`)
    }

    // =========================================================================
    // 阶段 1: 00_创作方向 核心创作原则 (最高优先级，受保护)
    // =========================================================================
    const stage1Fragments = WorkspaceHubRepository.queryFragments({
      projectId,
      categories: ['creation_principles'],
      excludeDeprecated: true,
    })
    if (stage1Fragments.length > 0) {
      const combined = stage1Fragments.map(f => f.content).join('\n\n')
      const sources: ChapterContextSourceRef[] = stage1Fragments.map(f => formatFragmentSourceRef(f, projectId))
      tryAddBlock({
        id: 'stage-1-creation-principles',
        stage: 1,
        stageName: '核心创作总则',
        title: '00_创作方向 · 核心创作原则',
        content: `【最高创作原则】\n${combined}`,
        sourceType: 'file',
        sourceFile: stage1Fragments[0].sourcePath,
        sourceHeadingPath: stage1Fragments[0].headingPath,
        sources,
        authorityStatus: 'confirmed',
        isCandidate: false,
        isStale: stage1Fragments.some(f => f.status === 'stale'),
        charCount: combined.length,
      }, true)
    }

    // =========================================================================
    // 阶段 2: 已确认且适用于当前章节的设定规则
    // =========================================================================
    const allConfirmedRules = WorkspaceHubRepository.listRules(projectId, 'confirmed')
    const ruleMatchesChapter = (scope: string) => {
      if (!scope || scope === 'global') return true
      const range = extractChapterRange(scope)
      if (range.start !== null || range.end !== null) {
        return isChapterInRange(chapterNumber, range.start, range.end)
      }
      return scope.includes(`第${chapterNumber}章`)
    }

    const applicableRules = allConfirmedRules.filter(r => ruleMatchesChapter(r.scope))
    const validConfirmedRules: SettingRule[] = []
    const verifiedConfirmedSources: ChapterContextSourceRef[] = []

    for (const r of applicableRules) {
      // 1. 禁止跨项目规则侵入
      if (r.projectId && r.projectId !== projectId) {
        omissions.push({
          stage: 2,
          stageName: '已确认设定规则',
          title: r.title,
          reason: 'provenance-mismatch',
          sourceInfo: `跨项目规则拒绝：规则所属项目 [${r.projectId}] 与当前装配项目 [${projectId}] 不符（已失败关闭）`,
        })
        staleWarnings.push(`规则【${r.title}】归属跨项目 [${r.projectId}]，已执行安全拦截`)
        continue
      }

      const sourceRef = resolveRuleSourceRef(db, r, projectId)
      // 2. 规则来源与快照片段不一致时必须失败关闭：严禁注入正文上下文
      if (
        sourceRef.provenanceStatus === 'provenance-missing' &&
        (r.originType === 'scan' || r.sourceSnapshotFragmentId || r.sourceSnapshotId || r.sourceId)
      ) {
        omissions.push({
          stage: 2,
          stageName: '已确认设定规则',
          title: r.title,
          reason: 'provenance-mismatch',
          sourceInfo: sourceRef.provenanceError || `${r.sourceFile || 'setting_rules'} (规则来源与快照片段不一致，已失败关闭)`,
        })
        staleWarnings.push(`规则【${r.title}】来源凭据不一致或已失效，已执行失败关闭拦截`)
      } else {
        validConfirmedRules.push(r)
        verifiedConfirmedSources.push(sourceRef)
      }
    }

    if (validConfirmedRules.length > 0) {
      const ruleTexts = validConfirmedRules.map(
        r => `### 【${r.constraintType === 'hard' ? '硬约束' : '软约束'}】${r.title}\n${r.content}（来源：${r.sourceFile || '已确认设定'}）`
      ).join('\n\n')
      tryAddBlock({
        id: 'stage-2-confirmed-rules',
        stage: 2,
        stageName: '已确认设定规则',
        title: `已确认世界规则与硬约束 (${validConfirmedRules.length} 条)`,
        content: `【已确认设定规则与硬约束】\n${ruleTexts}`,
        sourceType: 'database',
        sourceFile: 'setting_rules',
        sources: verifiedConfirmedSources,
        authorityStatus: 'confirmed',
        isCandidate: false,
        isStale: false,
        charCount: ruleTexts.length,
      }, true)
    }

    const includeCandidates = options.includeCandidates === true
    const candidateRules = includeCandidates
      ? WorkspaceHubRepository.listRules(projectId, 'candidate').filter(r => ruleMatchesChapter(r.scope))
      : []

    const validCandidateRules: SettingRule[] = []
    const verifiedCandidateSources: ChapterContextSourceRef[] = []

    for (const r of candidateRules) {
      if (r.projectId && r.projectId !== projectId) {
        omissions.push({
          stage: 2,
          stageName: '候选设定参考',
          title: r.title,
          reason: 'provenance-mismatch',
          sourceInfo: `跨项目候选规则拒绝：所属项目 [${r.projectId}] 与当前装配项目 [${projectId}] 不符（已失败关闭）`,
        })
        continue
      }
      const sourceRef = resolveRuleSourceRef(db, r, projectId)
      if (
        sourceRef.provenanceStatus === 'provenance-missing' &&
        (r.originType === 'scan' || r.sourceSnapshotFragmentId || r.sourceSnapshotId || r.sourceId)
      ) {
        omissions.push({
          stage: 2,
          stageName: '候选设定参考',
          title: r.title,
          reason: 'provenance-mismatch',
          sourceInfo: sourceRef.provenanceError || '候选规则来源快照片段校验失败（已失败关闭）',
        })
      } else {
        validCandidateRules.push(r)
        verifiedCandidateSources.push(sourceRef)
      }
    }

    if (validCandidateRules.length > 0) {
      const candidateTexts = validCandidateRules.map(
        r => `### 【待确认/候选】${r.title}\n${r.content}（警示：未经作者确认，不得作为硬约束）`
      ).join('\n\n')
      tryAddBlock({
        id: 'stage-2-candidate-rules',
        stage: 2,
        stageName: '候选设定参考',
        title: `候选世界设定 [待确认/候选] (${validCandidateRules.length} 条)`,
        content: `【候选世界设定（待确认/软参考）】\n${candidateTexts}`,
        sourceType: 'database',
        sourceFile: 'setting_rules',
        sources: verifiedCandidateSources,
        authorityStatus: 'candidate',
        isCandidate: true,
        isStale: false,
        charCount: candidateTexts.length,
      })
    }

    // =========================================================================
    // 阶段 3: 02_剧情总纲 相关卷或阶段
    // =========================================================================
    const stage3Fragments = WorkspaceHubRepository.queryFragments({
      projectId,
      categories: ['master_plot'],
      chapterNumber,
      excludeDeprecated: true,
    })
    if (stage3Fragments.length > 0) {
      const text = stage3Fragments.map(f => `### ${f.headingPath}\n${f.content}`).join('\n\n')
      const sources: ChapterContextSourceRef[] = stage3Fragments.map(f => formatFragmentSourceRef(f, projectId))
      tryAddBlock({
        id: 'stage-3-master-plot',
        stage: 3,
        stageName: '全书规划总纲',
        title: '02_剧情总纲 · 相关规划',
        content: `【全书规划与阶段目标】\n${text}`,
        sourceType: 'file',
        sourceFile: stage3Fragments[0].sourcePath,
        sourceHeadingPath: stage3Fragments[0].headingPath,
        sources,
        authorityStatus: 'confirmed',
        isCandidate: false,
        isStale: stage3Fragments.some(f => f.status === 'stale'),
        charCount: text.length,
      })
    }

    // =========================================================================
    // 阶段 4: 10_第一卷剧情大纲 对应章节
    // =========================================================================
    const stage4Fragments = WorkspaceHubRepository.queryFragments({
      projectId,
      categories: ['volume_outline'],
      chapterNumber,
      excludeDeprecated: true,
    })
    if (stage4Fragments.length > 0) {
      const text = stage4Fragments.map(f => `### ${f.headingPath}\n${f.content}`).join('\n\n')
      const sources: ChapterContextSourceRef[] = stage4Fragments.map(f => formatFragmentSourceRef(f, projectId))
      tryAddBlock({
        id: 'stage-4-volume-outline',
        stage: 4,
        stageName: '卷级剧情大纲',
        title: `第一卷剧情大纲 · 第${chapterNumber}章相关`,
        content: `【卷级大纲定位】\n${text}`,
        sourceType: 'file',
        sourceFile: stage4Fragments[0].sourcePath,
        sourceHeadingPath: stage4Fragments[0].headingPath,
        sources,
        authorityStatus: 'confirmed',
        isCandidate: false,
        isStale: stage4Fragments.some(f => f.status === 'stale'),
        charCount: text.length,
      })
    }

    // =========================================================================
    // 阶段 5: 11_第一卷逐章细纲 第 N 章完整细纲 (核心，受保护)
    // =========================================================================
    const stage5Fragments = WorkspaceHubRepository.queryFragments({
      projectId,
      categories: ['chapter_outline'],
      chapterNumber,
      excludeDeprecated: true,
    })
    if (stage5Fragments.length > 0) {
      const text = stage5Fragments.map(f => `### ${f.headingPath}\n${f.content}`).join('\n\n')
      const sources: ChapterContextSourceRef[] = stage5Fragments.map(f => formatFragmentSourceRef(f, projectId))
      tryAddBlock({
        id: 'stage-5-chapter-outline',
        stage: 5,
        stageName: '逐章细纲',
        title: `11_逐章细纲 · 第${chapterNumber}章`,
        content: `【本章完整逐章细纲】\n${text}`,
        sourceType: 'file',
        sourceFile: stage5Fragments[0].sourcePath,
        sourceHeadingPath: stage5Fragments[0].headingPath,
        sources,
        authorityStatus: 'confirmed',
        isCandidate: false,
        isStale: stage5Fragments.some(f => f.status === 'stale'),
        charCount: text.length,
      }, true)
    }

    // =========================================================================
    // 阶段 6: 结构化角色名单中本章相关人物
    // =========================================================================
    let relevantCharacters: Array<{
      name: string
      role: string
      personality: string
      background: string
      abilities: string
      motivation: string
      cultivationLevelId?: string | null
      notes?: string
    }> = []

    try {
      const rosterSnapshot = CharacterRosterRepository.read()
      const outlineCombinedText = [
        ...stage4Fragments.map(f => f.content),
        ...stage5Fragments.map(f => f.content),
        ...stage5Fragments.map(f => f.headingPath),
      ].join(' ')

      relevantCharacters = rosterSnapshot.entries.filter(e => {
        if (e.role === 'protagonist') return true
        return outlineCombinedText.includes(e.name)
      })

      if (relevantCharacters.length > 0) {
        const text = relevantCharacters.map(c => (
          `### ${c.name} (${c.role})\n`
          + `- 性格与特质: ${c.personality}\n`
          + `- 身份与背景: ${c.background}\n`
          + `- 能力与动机: ${c.abilities}；${c.motivation}\n`
          + (c.cultivationLevelId ? `- Cultivation: ${CultivationRepository.resolveName(c.cultivationLevelId)}\n` : '')
          + (c.notes ? `- 备忘: ${c.notes}\n` : '')
        )).join('\n')
        const sources: ChapterContextSourceRef[] = relevantCharacters.map(c => ({
          relativePath: 'characters',
          headingPath: c.name,
        }))
        tryAddBlock({
          id: 'stage-6-character-roster',
          stage: 6,
          stageName: '结构化角色名单',
          title: `出场角色事实 (${relevantCharacters.length} 人)`,
          content: `【结构化角色档案】\n${text}`,
          sourceType: 'database',
          sourceFile: 'characters',
          sources,
          authorityStatus: 'confirmed',
          isCandidate: false,
          isStale: false,
          charCount: text.length,
        })
      }
    } catch {
      // 数据库角色未初始化时安全跳过
    }

    // =========================================================================
    // 阶段 7: 截至 N-1 章有效的角色动态状态和定稿连续性事实
    // =========================================================================
    try {
      const rosterSnapshot = CharacterRosterRepository.read()
      const states = rosterSnapshot.entries
        .filter(c => c.currentState && c.currentState.updatedAtChapter < chapterNumber)
        .map(c => {
          const s = c.currentState!
          return {
            name: c.name,
            text: `### ${c.name}（更新于第${s.updatedAtChapter}章）: 位置=${s.location || '未知'}, 状态=${s.physicalState || '正常'}, 心理=${s.mentalState || '稳定'}, 近况=${s.recentEvents || '无'}`,
          }
        })
      if (states.length > 0) {
        const text = states.map(s => s.text).join('\n')
        const sources: ChapterContextSourceRef[] = states.map(s => ({
          relativePath: 'characters.currentState',
          headingPath: s.name,
        }))
        tryAddBlock({
          id: 'stage-7-character-states',
          stage: 7,
          stageName: '角色动态状态',
          title: `角色近期动态事实 (截至第${chapterNumber - 1}章)`,
          content: `【角色动态状态（时点有效，非永久约束）】\n${text}`,
          sourceType: 'database',
          sourceFile: 'characters.currentState',
          sources,
          authorityStatus: 'confirmed',
          isCandidate: false,
          isStale: false,
          charCount: text.length,
        })
      }
    } catch {
      // ignore
    }

    // =========================================================================
    // 阶段 8: 现有叙事线索中尚未解决、且与本章相关的伏笔（复用 NarrativeThreadRepository.list()）
    // =========================================================================
    try {
      const allThreads = NarrativeThreadRepository.list()
      const activeThreads = allThreads.filter(t => {
        if (t.status === 'resolved' || t.status === 'abandoned') return false
        return chapterNumber >= t.targetStartChapter && chapterNumber <= t.targetEndChapter
      })

      if (activeThreads.length > 0) {
        const text = activeThreads.map(
          t => `### 【${t.type}】${t.title}（第${t.targetStartChapter}-${t.targetEndChapter}章）\n意图: ${t.authorIntent}`
        ).join('\n')
        const sources: ChapterContextSourceRef[] = activeThreads.map(t => ({
          relativePath: 'narrative_thread_plans',
          headingPath: t.title,
        }))
        tryAddBlock({
          id: 'stage-8-narrative-threads',
          stage: 8,
          stageName: '叙事线索与伏笔',
          title: `本章活动伏笔 (${activeThreads.length} 条)`,
          content: `【活动叙事线索与伏笔】\n${text}`,
          sourceType: 'database',
          sourceFile: 'narrative_thread_plans',
          sources,
          authorityStatus: 'confirmed',
          isCandidate: false,
          isStale: false,
          charCount: text.length,
        })
      }
    } catch {
      // ignore
    }

    // =========================================================================
    // 阶段 9: 前一章 (N-1) 的定稿结尾和近期定稿证据 (复用 DraftRepository，无定稿正文时不插入虚假空白)
    // =========================================================================
    if (chapterNumber > 1) {
      try {
        const prevFinalizedMeta = DraftRepository.getFinalizedByChapter(chapterNumber - 1)
        if (prevFinalizedMeta) {
          const prevDraftFull = DraftRepository.getFull(prevFinalizedMeta.id)
          if (prevDraftFull && prevDraftFull.content && prevDraftFull.content.trim().length > 0) {
            const ending = prevDraftFull.content.slice(-1000).trim()
            const sources: ChapterContextSourceRef[] = [{
              relativePath: 'drafts',
              headingPath: `第${chapterNumber - 1}章`,
              lineRange: `v${prevDraftFull.version}`,
            }]
            tryAddBlock({
              id: 'stage-9-previous-chapter-ending',
              stage: 9,
              stageName: '前章定稿结尾',
              title: `第${chapterNumber - 1}章 定稿收尾衔接`,
              content: `【前章定稿结尾 · 第${chapterNumber - 1}章】\n……${ending}`,
              sourceType: 'database',
              sourceFile: 'drafts',
              sources,
              authorityStatus: 'confirmed',
              isCandidate: false,
              isStale: false,
              charCount: ending.length,
            })
          }
        }
      } catch {
        // ignore
      }
    }

    // =========================================================================
    // 阶段 10: 与本章事件相关的世界观、遗境或事件库片段 (基于相关性加权排序)
    // =========================================================================
    const stage10Categories: Array<'world_data' | 'event_materials' | 'background_settings'> = [
      'world_data',
      'event_materials',
    ]
    if (options.includeBackgroundLore) {
      stage10Categories.push('background_settings')
    }

    const stage10CandidateFragments = WorkspaceHubRepository.queryFragments({
      projectId,
      categories: stage10Categories,
      excludeDeprecated: true,
    })

    if (stage10CandidateFragments.length > 0) {
      // 提取章节细纲中的出场人物与核心词汇
      const characterNames = relevantCharacters.map(c => c.name).filter(Boolean)
      const outlineText = [
        ...stage4Fragments.map(f => f.headingPath + ' ' + f.content),
        ...stage5Fragments.map(f => f.headingPath + ' ' + f.content),
      ].join(' ')

      const outlineWords = new Set<string>()
      for (const name of characterNames) outlineWords.add(name)
      const matchedKeywords = outlineText.match(/[\u4e00-\u9fa5]{2,6}/g) || []
      for (const word of matchedKeywords) {
        if (word.length >= 2 && !/^(我们|他们|这个|那个|如果|因为|所以|开始|进行|之后|之前|第[0-9一二三四五六七八九十]+章)$/.test(word)) {
          outlineWords.add(word)
        }
      }

      // 综合加权评分：显式章节范围 > 人物出现 > 细纲核心词重叠
      const scoredFragments = stage10CandidateFragments.map(frag => {
        let score = 0

        if (frag.chapterStart !== null || frag.chapterEnd !== null) {
          if (isChapterInRange(chapterNumber, frag.chapterStart, frag.chapterEnd)) {
            score += 30
          } else {
            score -= 25
          }
        }

        for (const name of characterNames) {
          if (frag.headingPath.includes(name)) score += 15
          if (frag.content.includes(name)) score += 8
        }

        let wordMatches = 0
        for (const word of outlineWords) {
          if (frag.headingPath.includes(word)) {
            score += 6
            wordMatches++
          } else if (frag.content.includes(word)) {
            score += 1
            wordMatches++
          }
          if (wordMatches >= 10) break
        }

        return { frag, score }
      })

      scoredFragments.sort((a, b) => b.score - a.score)
      const topFragments = scoredFragments.filter(s => s.score > 0).slice(0, 5).map(s => s.frag)

      if (topFragments.length > 0) {
        const text = topFragments.map(f => `### ${f.headingPath}\n${f.content}`).join('\n\n')
        const sources: ChapterContextSourceRef[] = topFragments.map(f => formatFragmentSourceRef(f, projectId))
        tryAddBlock({
          id: 'stage-10-world-events',
          stage: 10,
          stageName: '世界观与事件素材',
          title: `相关世界观与事件片段 (${topFragments.length} 项)`,
          content: `【世界观与事件素材】\n${text}`,
          sourceType: 'file',
          sourceFile: topFragments[0].sourcePath,
          sourceHeadingPath: topFragments[0].headingPath,
          sources,
          authorityStatus: 'material',
          isCandidate: false,
          isStale: topFragments.some(f => f.status === 'stale'),
          charCount: text.length,
        })
      }
    }

    // =========================================================================
    // 阶段 11: 09_爆点设计与情绪兑现 相关目标
    // =========================================================================
    const stage11Fragments = WorkspaceHubRepository.queryFragments({
      projectId,
      categories: ['narrative_goals'],
      chapterNumber,
      excludeDeprecated: true,
    })
    if (stage11Fragments.length > 0) {
      const text = stage11Fragments.map(f => `### ${f.headingPath}\n${f.content}`).join('\n\n')
      const sources: ChapterContextSourceRef[] = stage11Fragments.map(f => formatFragmentSourceRef(f, projectId))
      tryAddBlock({
        id: 'stage-11-narrative-goals',
        stage: 11,
        stageName: '叙事爆点与情绪目标',
        title: '09_爆点设计与情绪兑现 · 相关目标',
        content: `【叙事目标与情绪兑现】\n${text}`,
        sourceType: 'file',
        sourceFile: stage11Fragments[0].sourcePath,
        sourceHeadingPath: stage11Fragments[0].headingPath,
        sources,
        authorityStatus: 'confirmed',
        isCandidate: false,
        isStale: stage11Fragments.some(f => f.status === 'stale'),
        charCount: text.length,
      })
    }

    // =========================================================================
    // 阶段 12: 12_叙述风格与正文规范 中的写作约束 (受保护)
    // =========================================================================
    const stage12Fragments = WorkspaceHubRepository.queryFragments({
      projectId,
      categories: ['style_guide'],
      excludeDeprecated: true,
    })
    if (stage12Fragments.length > 0) {
      const text = stage12Fragments.map(f => f.content).join('\n\n')
      const sources: ChapterContextSourceRef[] = stage12Fragments.map(f => formatFragmentSourceRef(f, projectId))
      tryAddBlock({
        id: 'stage-12-style-guide',
        stage: 12,
        stageName: '叙述风格与正文规范',
        title: '12_叙述风格与正文规范 · 写作约束',
        content: `【正文写作与风格规范】\n${text}`,
        sourceType: 'file',
        sourceFile: stage12Fragments[0].sourcePath,
        sourceHeadingPath: stage12Fragments[0].headingPath,
        sources,
        authorityStatus: 'confirmed',
        isCandidate: false,
        isStale: stage12Fragments.some(f => f.status === 'stale'),
        charCount: text.length,
      })
    }

    // =========================================================================
    // 阶段 13: 明确的废案排除清单 (纯负向约束条目，严禁注入废案正文全文，受保护)
    // =========================================================================
    if (excludedDeprecatedCount > 0) {
      const isCompact = remainingBudget < 300 || budgetLimit < 800
      const projectDeprecatedRules = deprecatedRules.filter(r => !r.projectId || r.projectId === projectId)
      const ruleSummaries = projectDeprecatedRules.slice(0, 20).map(r =>
        isCompact
          ? `- 废止设定：【${r.title}】（禁止采用）`
          : `- 废止设定条目：【${r.title}】（约束类型：${r.constraintType === 'hard' ? '硬约束' : '软约束'}，作用域：${r.scope}，禁止采用）`
      )
      const fragSummaries = deprecatedFragments.slice(0, 20).map(f =>
        isCompact
          ? `- 废止片段：【${f.headingPath}】（来源：${f.sourcePath}，禁止采用）`
          : `- 废止资料片段：【${f.headingPath}】（来源文件：${f.sourcePath}，禁止采用）`
      )
      const header = isCompact
        ? '【以下方案与设定已被作者明确废止，严禁在正文与细纲中采用（禁止采用）】：'
        : '【以下方案与设定已被作者明确废止，严禁在正文与细纲中作为有效事实采用（明确禁止采用）】：'
      const exclusionText = [
        header,
        ...ruleSummaries,
        ...fragSummaries,
      ].join('\n')

      const sources: ChapterContextSourceRef[] = [
        ...projectDeprecatedRules.map(r => resolveRuleSourceRef(db, r, projectId)),
        ...deprecatedFragments.map(f => formatFragmentSourceRef(f, projectId)),
      ]

      tryAddBlock({
        id: 'stage-13-deprecated-exclusions',
        stage: 13,
        stageName: '废案排除清单',
        title: `明确排除的废案清单 (${excludedDeprecatedCount} 项)`,
        content: exclusionText,
        sourceType: 'database',
        sourceFile: '06_废案与漏洞记录',
        sources,
        authorityStatus: 'deprecated',
        isCandidate: false,
        isStale: false,
        charCount: exclusionText.length,
      }, true)
    }

    // 生成完整装配文本与预算校验
    const assembledSections: string[] = []
    for (const b of blocks) {
      assembledSections.push(b.content)
    }

    const fullAssembledText = assembledSections.join('\n\n---\n\n')
    const totalCharCount = fullAssembledText.length
    const estimatedTokens = Math.ceil(totalCharCount * 0.75) // 粗略估算汉字/英文 Token 比例
    const isOverBudget = totalCharCount > budgetLimit
    const exceededChars = Math.max(0, totalCharCount - budgetLimit)

    return {
      chapterNumber,
      blocks,
      omissions,
      staleWarnings,
      candidateWarnings,
      excludedDeprecatedCount,
      totalCharCount,
      estimatedTokens,
      fullAssembledText,
      isOverBudget,
      exceededChars,
    }
  }
}
