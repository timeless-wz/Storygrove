/**
 * 创作资料中枢 (Workspace Hub) 跨进程与领域契约
 *
 * 定义外部创作母稿来源、解析片段、设定规则、导入候选与章节上下文包的数据模型。
 */

export type WorkspaceSourceCategory =
  | 'creation_principles'    // 00_创作方向: 创作总则
  | 'confirmed_settings'     // 01_已确认设定清单: 已确认设定
  | 'master_plot'            // 02_剧情总纲: 全书规划
  | 'world_data'             // 03_里世界探索: 世界资料
  | 'event_materials'        // 04_事件与遗境库: 事件素材
  | 'character_data'         // 05_人物与关系: 人物资料
  | 'deprecated'             // 06_废案与漏洞记录: 废案
  | 'background_settings'    // 07_世界观后台: 后台设定
  | 'reference_boundary'     // 08_参考作品与借鉴边界: 参考边界
  | 'narrative_goals'        // 09_爆点设计与情绪兑现: 叙事目标
  | 'volume_outline'         // 10_第一卷剧情大纲: 卷级规划
  | 'chapter_outline'        // 11_第一卷逐章细纲: 逐章规划
  | 'style_guide'            // 12_叙述风格与正文规范: 风格规范
  | 'reference_novel'        // 素材库 / 参考小说全文
  | 'other'                  // 其他资料

export type WorkspaceAuthorityStatus =
  | 'confirmed'              // 已确认
  | 'candidate'              // 候选
  | 'background'             // 后台
  | 'deprecated'             // 废止
  | 'reference'              // 参考边界
  | 'material'               // 素材

export type WorkspaceSourceStatus =
  | 'normal'                 // 正常
  | 'changed'                // 已变化
  | 'missing'                // 缺失
  | 'pending'                // 待确认
  | 'disabled'               // 已停用

export interface WorkspaceCategoryPreset {
  category: WorkspaceSourceCategory
  nameZh: string
  nameEn: string
  purposeZh: string
  purposeEn: string
  pattern: RegExp
  defaultAuthority: WorkspaceAuthorityStatus
  canInjectIntoContext: boolean
  isDeprecatedExcluded?: boolean
}

export const WORKSPACE_CATEGORY_PRESETS: WorkspaceCategoryPreset[] = [
  {
    category: 'creation_principles',
    nameZh: '创作总则',
    nameEn: 'Creation Principles',
    purposeZh: '最高优先级的创作原则与全局指导',
    purposeEn: 'Top-priority creation principles and global guidance',
    pattern: /(?:^|[\\/])00[_\s-]*创作方向.*\.md$/iu,
    defaultAuthority: 'confirmed',
    canInjectIntoContext: true,
  },
  {
    category: 'confirmed_settings',
    nameZh: '已确认设定',
    nameEn: 'Confirmed Settings',
    purposeZh: '有效世界规则和硬约束',
    purposeEn: 'Valid world rules and hard constraints',
    pattern: /(?:^|[\\/])01[_\s-]*已确认设定清单.*\.md$/iu,
    defaultAuthority: 'confirmed',
    canInjectIntoContext: true,
  },
  {
    category: 'master_plot',
    nameZh: '全书规划',
    nameEn: 'Master Plot',
    purposeZh: '全书主线、卷级目标与长线谜题',
    purposeEn: 'Series arc, volume goals, and long-term mysteries',
    pattern: /(?:^|[\\/])02[_\s-]*剧情总纲.*\.md$/iu,
    defaultAuthority: 'confirmed',
    canInjectIntoContext: true,
  },
  {
    category: 'world_data',
    nameZh: '世界资料',
    nameEn: 'Worldbuilding',
    purposeZh: '里世界景观、玩法、层级和探索规则',
    purposeEn: 'World landscape, mechanics, tiers, and exploration rules',
    pattern: /(?:^|[\\/])03[_\s-]*.*(?:里世界探索|世界资料).*\.md$/iu,
    defaultAuthority: 'confirmed',
    canInjectIntoContext: true,
  },
  {
    category: 'event_materials',
    nameZh: '事件素材',
    nameEn: 'Event Materials',
    purposeZh: '怪事、遗境、奇观候选',
    purposeEn: 'Anomalies, ruins, and spectacle candidates',
    pattern: /(?:^|[\\/])04[_\s-]*.*(?:事件与遗境库|事件素材).*\.md$/iu,
    defaultAuthority: 'material',
    canInjectIntoContext: true,
  },
  {
    category: 'character_data',
    nameZh: '人物资料',
    nameEn: 'Character Data',
    purposeZh: '角色卡与关系候选，导入结构化角色名单前必须预览确认',
    purposeEn: 'Character cards and relations; requires preview before import',
    pattern: /(?:^|[\\/])05[_\s-]*人物与关系.*\.md$/iu,
    defaultAuthority: 'candidate',
    canInjectIntoContext: true,
  },
  {
    category: 'deprecated',
    nameZh: '废案',
    nameEn: 'Deprecated',
    purposeZh: '默认禁止进入有效设定和正文生成上下文',
    purposeEn: 'Strictly prohibited from valid settings and context injection',
    pattern: /(?:^|[\\/])06[_\s-]*废案与漏洞记录.*\.md$/iu,
    defaultAuthority: 'deprecated',
    canInjectIntoContext: false,
    isDeprecatedExcluded: true,
  },
  {
    category: 'background_settings',
    nameZh: '后台设定',
    nameEn: 'Background Lore',
    purposeZh: '需要时按相关性调用，不默认整篇注入',
    purposeEn: 'Consulted on demand by relevance, never bulk-injected',
    pattern: /(?:^|[\\/])07[_\s-]*世界观后台.*\.md$/iu,
    defaultAuthority: 'background',
    canInjectIntoContext: true,
  },
  {
    category: 'reference_boundary',
    nameZh: '参考边界',
    nameEn: 'Reference Boundaries',
    purposeZh: '只作为创作方法与禁区，不作为故事内事实',
    purposeEn: 'Methodology and taboo boundaries; not in-story facts',
    pattern: /(?:^|[\\/])08[_\s-]*参考作品与借鉴边界.*\.md$/iu,
    defaultAuthority: 'reference',
    canInjectIntoContext: true,
  },
  {
    category: 'narrative_goals',
    nameZh: '叙事目标',
    nameEn: 'Narrative Goals',
    purposeZh: '爽点、悬念和情绪兑现计划',
    purposeEn: 'Pacing, suspense, and emotional payoff plans',
    pattern: /(?:^|[\\/])09[_\s-]*爆点设计与情绪兑现.*\.md$/iu,
    defaultAuthority: 'confirmed',
    canInjectIntoContext: true,
  },
  {
    category: 'volume_outline',
    nameZh: '卷级规划',
    nameEn: 'Volume Outline',
    purposeZh: '卷级章节结构',
    purposeEn: 'Volume-level chapter structure',
    pattern: /(?:^|[\\/])10[_\s-]*.*(?:剧情大纲|卷级大纲).*\.md$/iu,
    defaultAuthority: 'confirmed',
    canInjectIntoContext: true,
  },
  {
    category: 'chapter_outline',
    nameZh: '逐章规划',
    nameEn: 'Chapter Outline',
    purposeZh: '按标题和章节范围定位目标章节材料',
    purposeEn: 'Detailed outline matching target chapter by title and range',
    pattern: /(?:^|[\\/])11[_\s-]*.*(?:逐章细纲|阶段|第.*章|细纲).*\.md$|11_.*[\\/].*\.md$/iu,
    defaultAuthority: 'confirmed',
    canInjectIntoContext: true,
  },
  {
    category: 'style_guide',
    nameZh: '风格规范',
    nameEn: 'Style Guide',
    purposeZh: '正文写作和审稿约束',
    purposeEn: 'Writing style and editorial constraints',
    pattern: /(?:^|[\\/])12[_\s-]*.*(?:叙述风格|正文规范|语言风格|描写规范).*\.md$/iu,
    defaultAuthority: 'confirmed',
    canInjectIntoContext: true,
  },
  {
    category: 'reference_novel',
    nameZh: '参考素材',
    nameEn: 'Reference Materials',
    purposeZh: '参考小说或大文本素材，不默认整篇加入上下文',
    purposeEn: 'Reference novels or large texts; not bulk-injected',
    pattern: /(?:^|[\\/])(?:素材|reference)[\\/].*\.(?:txt|md)$|\.txt$/iu,
    defaultAuthority: 'material',
    canInjectIntoContext: false,
  },
]

export function matchWorkspaceCategory(relativePath: string): WorkspaceCategoryPreset {
  const normalized = relativePath.replace(/\\/g, '/')
  for (const preset of WORKSPACE_CATEGORY_PRESETS) {
    if (preset.pattern.test(normalized)) {
      return preset
    }
  }
  return {
    category: 'other',
    nameZh: '其他资料',
    nameEn: 'Other Material',
    purposeZh: '其他创作辅助资料',
    purposeEn: 'Other writing auxiliary material',
    pattern: /.*/,
    defaultAuthority: 'candidate',
    canInjectIntoContext: true,
  }
}

export interface WorkspaceSource {
  id: string
  projectId: string
  absolutePath: string
  relativePath: string
  category: WorkspaceSourceCategory
  authorityStatus: WorkspaceAuthorityStatus
  contentHash: string
  observedFileHash?: string
  approvedContentHash?: string
  observedSnapshotId?: string | null
  approvedSnapshotId?: string | null
  parseError?: string | null
  parseStatus?: 'parsed' | 'metadata_only' | 'error'
  skipReason?: string | null
  mtime: number
  lastScannedAt: string
  importStatus: 'scanned' | 'imported' | 'stale' | 'missing' | 'disabled'
  isMissing: boolean
  isDisabled: boolean
  fileSize?: number
}

export interface WorkspaceSourceSnapshot {
  snapshotId: string
  sourceId: string
  projectId: string
  contentHash: string
  fileSize: number
  fragmentCount: number
  parserSchemaVersion?: number
  createdAt?: string
}

export interface WorkspaceSourceSnapshotFragment {
  id: string
  snapshotId: string
  sourceId: string
  projectId: string
  headingPath: string
  content: string
  startLine: number
  endLine: number
  fragmentHash: string
  chapterStart: number | null
  chapterEnd: number | null
  purpose: string
  status: 'active' | 'stale' | 'deprecated'
  createdAt?: string
}

export interface WorkspaceSourceFragment {
  fragmentId: string
  sourceId: string
  headingPath: string
  content: string
  startLine: number
  endLine: number
  fragmentHash: string
  chapterStart: number | null
  chapterEnd: number | null
  purpose: string
  status: 'active' | 'stale' | 'deprecated'
}

export type SettingRuleStatus = 'confirmed' | 'candidate' | 'background' | 'deprecated'
export type SettingRuleConstraint = 'hard' | 'soft'

export interface SettingRule {
  ruleId: string
  projectId: string
  title: string
  content: string
  status: SettingRuleStatus
  constraintType: SettingRuleConstraint
  scope: string
  sourceFragmentId?: string
  sourceSnapshotFragmentId?: string | null
  sourceFile: string
  sourceHeadingPath: string
  sourceLineRange: string
  confirmedAt?: string
  confirmedBy?: string
  originType?: 'manual' | 'scan'
  sourceId?: string | null
  sourceSnapshotId?: string | null
  createdAt?: string
  updatedAt?: string
}

export type WorkspaceScanResult =
  | {
      success: true
      taskId?: string
      scannedCount: number
      recognizedCount: number
      enumerationComplete: boolean
      truncated: boolean
      truncationReason?: string
      error?: never
    }
  | {
      success: false
      taskId?: string
      scannedCount?: number
      recognizedCount?: number
      error: string
      enumerationComplete?: boolean
      truncated?: boolean
      truncationReason?: string
    }

export type WorkspaceImportCandidateType = 'character' | 'setting' | 'blueprint' | 'lead'
export type WorkspaceImportCandidateStatus = 'pending' | 'approved' | 'rejected'

export interface WorkspaceImportCandidate {
  candidateId: string
  projectId: string
  candidateType: WorkspaceImportCandidateType
  rawData: string
  suggestedData: string
  sourceFile: string
  sourceHeadingPath: string
  sourceLineRange: string
  evidence: string
  confidence: number
  status: WorkspaceImportCandidateStatus
  actionedAt?: string
  createdAt?: string
}

export type WorkspaceApprovalStage = 'prepared' | 'roster_committed' | 'completed'

export interface WorkspaceApprovalReceipt {
  candidateId: string
  projectId: string
  candidateType: WorkspaceImportCandidateType
  operationId: string
  stage: WorkspaceApprovalStage
  createdAt: string
  updatedAt: string
}

export interface WorkspaceHubStatus {
  externalWorkspacePath: string
  lastScannedAt: string
  totalFiles: number
  recognizedFiles: number
  missingFiles: number
  changedFiles: number
  pendingCandidates: number
  confirmedRulesCount: number
}

export interface ChapterContextSourceRef {
  relativePath: string
  headingPath: string
  fragmentId?: string
  snapshotId?: string | null
  contentHash?: string
  lineRange?: string
  projectId?: string
  sourceId?: string | null
  approvedSnapshotId?: string | null
  sourceSnapshotFragmentId?: string | null
  filePath?: string
  titlePath?: string
  provenanceStatus?: 'found' | 'provenance-missing'
  provenanceError?: string
}

export interface ChapterContextBlock {
  id: string
  stage: number
  stageName: string
  title: string
  content: string
  sourceType: 'file' | 'database'
  sourceFile?: string
  sourceHeadingPath?: string
  sourceLineRange?: string
  sources: ChapterContextSourceRef[]
  authorityStatus: WorkspaceAuthorityStatus
  isCandidate: boolean
  isStale: boolean
  charCount: number
}

export interface ChapterContextOmission {
  stage: number
  stageName: string
  title: string
  reason: 'budget' | 'deprecated-exclusion' | 'out-of-scope' | 'stale-rejected' | 'provenance-mismatch'
  sourceInfo: string
}

export interface ChapterContextBundle {
  chapterNumber: number
  chapterTitle?: string
  blocks: ChapterContextBlock[]
  omissions: ChapterContextOmission[]
  staleWarnings: string[]
  candidateWarnings: string[]
  excludedDeprecatedCount: number
  totalCharCount: number
  estimatedTokens: number
  fullAssembledText: string
  isOverBudget: boolean
  exceededChars: number
}

export interface ChapterContextSnapshot {
  id: string
  projectId: string
  chapterNumber: number
  totalChars: number
  estimatedTokens: number
  bundleText: string
  sourcesJson: string
  blocksJson: string
  staleWarningsJson: string
  candidateWarningsJson: string
  omissionsJson: string
  excludedDeprecatedCount: number
  isOverBudget: boolean
  createdAt?: string
  updatedAt?: string
}
