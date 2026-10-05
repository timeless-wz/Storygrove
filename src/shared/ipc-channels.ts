import type { ProseDirectoryAction, ProseOrderEntry, ProseTrashEntry } from './prose-directory'
/**
 * IPC 频道定义 — 渲染进程与主进程的类型安全通信契约
 * 所有 IPC 调用都通过此文件定义频道名和参数/返回值类型
 */
import type { Locale } from '../i18n/types'
import type { FinalizationSnapshot, FinalizationResult } from './finalization'
import type {
  RevisionLearningAfterSnapshotInput,
  RevisionLearningAttemptFinishInput,
  RevisionLearningAttemptStartInput,
  RevisionLearningBindingCasInput,
  RevisionLearningBindInput,
  RevisionLearningCreateFromVersionsInput,
  RevisionLearningEditorSnapshotInput,
  RevisionLearningPublicationStatus,
  RevisionLearningPublishInput,
  RevisionLearningRecord,
  RevisionLearningRecordSummary,
  RevisionLearningReviewConfirmInput,
  RevisionLearningReviewSaveInput,
  RevisionLearningSaveInput,
  RevisionLearningSourceDraft,
  RevisionLearningAttempt,
  RevisionLearningPublishReceipt,
} from './revision-learning'

/** Narrow snapshot/receipt actions; no arbitrary filesystem destination. */
export interface FinalizationChannels {
  'publication:publish': { args: [snapshot: FinalizationSnapshot, context: ProjectSessionContext]; return: FinalizationResult }
  'finalization:commit': { args: [snapshot: FinalizationSnapshot, context: ProjectSessionContext]; return: FinalizationResult }
  'finalization:retry': { args: [finalizationId: string, context: ProjectSessionContext]; return: FinalizationResult }
}
import type {
  CreativeStrategy,
  GenerationReasoningStage,
  ReasoningOverride,
} from './reasoning-types'
import type { EmbeddingOptions } from './embedding-options'
import type { ModelCapabilities } from './provider-presets'
import type { ModelProviderResourceId } from './model-provider-resources'
import type { WritingLanguage } from './writing-language'
import type { DraftStatus } from './draft-status'
import type {
  ProjectDocumentEntry,
  ProjectDocumentImportFailure,
  ProjectDocumentImportOutcome,
} from './project-documents'
import type {
  RecoveryCandidate,
  RecoveryCandidateRecordInput,
} from './recovery-candidate'
import type {
  FinalizedContinuityProjection,
  FinalizedSourceReadResult,
  SaveFinalizedCharacterStateCandidatesRequest,
  SaveFinalizedContinuityRequest,
} from './finalized-continuity'
import type { DraftSourceDependency } from './draft-source-dependency'
import type { ConsistencyExemption } from './consistency-preflight'
import type {
  NarrativeThreadEvent,
  NarrativeThreadEventInput,
  NarrativeThreadChapterContext,
  NarrativeThreadPlanInput,
  NarrativeThreadPlanRecord,
  NarrativeThreadView,
} from './narrative-thread'
import type {
  InfoEntry,
  InfoEntrySaveInput,
  InfoTruthStatus,
  InfoTruthVersion,
  KnowledgeRecord,
  KnowledgeRecordSaveInput,
} from './knowledge-gap'
import type { CharacterActionSaveInput, CharacterActionView } from './character-action'
import type {
  KnowledgeCheckKind,
  KnowledgeCheckReport,
  KnowledgeCheckReportInput,
} from './knowledge-check'
import type { ThreadMarkerLink, ThreadMarkerLinkInput } from './thread-marker-link'
import type {
  CreativeLegacyOrganizationInput,
  CreativeMaterialEntry,
  CreativeMaterialKind,
  CreativeMaterialSaveInput,
  CreativeMaterialStatus,
  LegacyCreativeSource,
} from './creative-content'
import type {
  OutlineSyncAffected,
  OutlineSyncCandidate,
  OutlineSyncCandidateStatus,
  OutlineSyncCreateCandidateInput,
} from './outline-sync'
import type { PlotTreeSnapshot, PlotTreeSourceBundle } from './plot-tree'
import type {
  PlotCanvasSummary,
  PlotCanvasGraph,
  PlotCanvasNodeData,
  PlotCanvasEdgeData,
  PlotCanvasViewport,
  PlotCanvasNodeUpsertPayload,
  PlotCanvasEdgeUpsertPayload,
  PlotCanvasGraphApplyPayload,
  PlotCanvasNodesMergePayload,
  PlotCanvasUpdatePayload,
} from './plot-canvas'
import type {
  ChapterCanvasMeta,
  ChapterCanvasNodeData,
  ChapterCanvasEdgeData,
  ChapterCanvasNodeUpsertPayload,
  ChapterCanvasEdgeUpsertPayload,
} from './chapter-canvas'
import type { WorldMapNode, WorldMapEdge, WorldMapCandidate, WorldMapImage, WorldMap, WorldMapAtlas } from './world-map'
import type {
  WorldCharacterLink,
  WorldCharacterLocation,
  WorldCurrentLocationCommitOptions,
  WorldDeletePlan,
  WorldFaction,
  WorldFactionCharacter,
  WorldFactionPlace,
  WorldFactionRelation,
  WorldLocationCommitResult,
  WorldMapAssignmentPlan,
  WorldEventLink,
  WorldPortal,
  WorldPortalCharacter,
  WorldPortalFaction,
  WorldRecord,
  WorldRelic,
  WorldRelicCharacter,
  WorldRelicFaction,
  WorldRule,
  WorldRuleTarget,
  WorldTrailCommitRequest,
  WorldTrailCommitResult,
  WorldWorkbenchSnapshot,
} from './world-workbench'
import type {
  StoryTimelineBranch,
  StoryTimelineDeleteCommitResult,
  StoryTimelineDeletePreviewResult,
  StoryTimelineEvent,
  StoryTimelineSettings,
  StoryTimelineSnapshot,
} from './story-timeline'
import type {
  CharacterSharedRelationship,
  CharacterGraphPosition,
  CharacterIdentityMap,
} from './character-relationship'
import type { Phase38Channels } from './phase3-8'
import type {
  UpdateActionResponse,
  UpdateCheckResponse,
  UpdatePreferences,
  UpdateReminderDelay,
  UpdateState,
} from './update-types'
import type {
  SkinCommand,
  SkinExecuteResponse,
  SkinReadCustomAssetResponse,
  SkinState,
} from './skin-types'
import type {
  ChapterDeletionOperation,
  ChapterDeletionResult,
  DeleteFinalizedChapterRequest,
} from './chapter-deletion'
import type {
  ImportRunChapterSnapshot,
  ImportRunEffectCommitResult,
  ImportRunEffectReceipt,
  ImportRunExecutionAuthority,
  ImportRunExecutionLease,
  ImportInspectionSummary,
  ImportPurpose,
  ImportNovelFileSelectionRequest,
  ImportRunPreparationResult,
  ImportRunPrepareFromInspectionResult,
  ImportRunPrepareFromInspectionRequest,
  ImportRunPrepareEffectReceiptRequest,
  ImportRunSnapshot,
  ImportRunStartResult,
  ImportRunStage,
} from './import-run'
import type {
  WorkspaceHubStatus,
  WorkspaceSource,
  WorkspaceSourceFragment,
  SettingRule,
  SettingRuleStatus,
  WorkspaceImportCandidate,
  WorkspaceImportCandidateType,
  WorkspaceImportCandidateStatus,
  ChapterContextBundle,
  ChapterContextSnapshot,
} from './workspace-hub'
import type {
  StoryEntityType,
  StoryFact,
  StoryFactCandidate,
  StoryFactCandidateInput,
  StoryFactImpact,
  StoryFactRelation,
  StoryFactRelationInput,
  StoryFactVersion,
  StoryFactVersionCommitInput,
  StoryRecordStatus,
  StoryCandidateReviewStatus,
} from './story-domain'
import type { StoryDataApprovalRequest, StoryDataApprovalResult } from './story-data-approval'
import type { StoryChangeProposal } from './story-candidate'

// ===== 全局配置 =====
export interface ConfigChannels {
  'config:get': {
    args: []
    return: GlobalConfig
  }
  'config:set': {
    args: [config: Partial<GlobalConfig>]
    return: { success: boolean; error?: string }
  }
}

// ===== 应用更新 =====
export interface UpdateChannels {
  'update:get-state': {
    args: []
    return: UpdateState
  }
  'update:check': {
    args: []
    return: UpdateCheckResponse
  }
  'update:download': {
    args: []
    return: UpdateActionResponse
  }
  'update:open-release': {
    args: []
    return: UpdateActionResponse
  }
  'update:defer-reminder': {
    args: [days: UpdateReminderDelay]
    return: UpdateActionResponse
  }
  'update:quit-and-install': {
    args: []
    return: UpdateActionResponse
  }
}

export interface UpdateStateEvents {
  'update:state': UpdateState
}

// ===== 图片皮肤 =====
export interface SkinChannels {
  'skin:get-state': {
    args: []
    return: SkinState
  }
  'skin:execute': {
    args: [command: SkinCommand]
    return: SkinExecuteResponse
  }
  'skin:read-custom-asset': {
    args: []
    return: SkinReadCustomAssetResponse
  }
}

// ===== 窗口控制 =====
export interface WindowChannels {
  'window:minimize': {
    args: []
    return: { success: boolean }
  }
  'window:toggle-maximize': {
    args: []
    return: { success: boolean; maximized?: boolean }
  }
  'window:close': {
    args: []
    return: { success: boolean }
  }
  'window:resolve-close': {
    args: [requestId: string, decision: 'proceed' | 'cancel']
    return: { success: boolean }
  }
}

export interface WindowEvents {
  'window:close-requested': { requestId: string }
}

// ===== 固定官方主页 =====
export interface OfficialHomepageChannels {
  'official-homepage:open': {
    args: []
    return: { success: boolean; error?: string }
  }
}

// ===== 固定模型服务商外链 =====
export interface ModelProviderResourceChannels {
  /** 只接受受信任资源 ID，由主进程映射为固定 HTTPS URL。 */
  'model-provider-resource:open': {
    args: [resource: ModelProviderResourceId]
    return: { success: boolean; error?: string }
  }
}

export interface GlobalConfig {
  theme: string
  locale?: Locale
  defaultModelId: string | null
  defaultEmbeddingModelId?: string | null
  /** 定稿与后处理成功后，打开下一章的创作窗口（默认关闭）。 */
  autoOpenNextChapterAfterFinalize?: boolean
  editorFontSize: number
  editorFontFamily: string
  autoSaveInterval: number
  /** 更新检查和提醒延后的本机偏好，持久化到 ~/.vela/config.json。 */
  updatePreferences?: UpdatePreferences
  proxy?: {
    enabled: boolean
    type: 'http' | 'socks5'
    host: string
    port: number
  }
}

export type AppErrorCode =
  | 'KNOWLEDGE_BASE_NATIVE_UNAVAILABLE'
  | 'LEGACY_VECTOR_MIGRATION_BLOCKED'
  | 'PROJECT_NOT_OPEN'
  | 'EMBEDDING_MODEL_NOT_CONFIGURED'
  | 'PROJECT_STORAGE_PATH_UNSUPPORTED'
  | 'PROJECT_ROOT_REQUIRED'

export interface AppFailure {
  success: false
  errorCode: AppErrorCode
  error?: string
}

export type AppResult<T> = T | AppFailure

/**
 * 一次打开项目时由主进程签发并冻结的跨进程会话身份。
 * projectPath 仅用于主进程的规范根目录校验，不能单独授予访问权限。
 */
export interface ProjectSessionContext {
  projectId: string
  leaseId: string
  projectPath: string
}

/** Renderer-captured source draft contract revalidated by the main-process write transaction. */
export interface ExpectedDraftSource {
  id: number
  chapterNumber: number
  version: number
  status: DraftStatus
  content: string
}

export type SourceDraftGuardErrorCode = 'SOURCE_DRAFT_CHANGED'

// ===== 项目管理 =====
export interface CreateProjectConfig {
  name: string
  path: string
  genre: string
  targetAudience: string
  writingLanguage?: WritingLanguage
}

export interface ProjectChannels {
  'project:get-runtime-context': {
    args: []
    return: {
      activeProjectPath: string | null
      dbReady: boolean
    }
  }
  'project:create': {
    args: [
      config: CreateProjectConfig,
      requestToken: string,
      rendererProjectPath: string | null,
    ]
    return: {
      success: boolean
      projectId: string
      projectPath?: string
      requestToken: string
      activeProjectPath: string | null
      databaseRestored: boolean
      dbReady: boolean
      stale?: boolean
      error?: string
      errorCode?: AppErrorCode
    }
  }
  'project:open': {
    args: [projectPath: string, requestToken: string, rendererProjectPath: string | null]
    return: {
      success: boolean
      project: ProjectData | null
      requestToken: string
      activeProjectPath: string | null
      databaseRestored: boolean
      dbReady: boolean
      stale?: boolean
      error?: string
      errorCode?: AppErrorCode
    }
  }
  'project:save': {
    args: [projectId: string, data: Partial<ProjectData>, expectedProjectPath: string]
    return: { success: boolean; error?: string }
  }
  'project:update-config': {
    args: [projectId: string, data: Partial<ProjectData>, expectedProjectPath: string]
    return: { success: boolean; error?: string }
  }
  /** 将当前项目的 .vela 状态备份到用户明确选择的外部目录；不会复制外部母稿。 */
  'project:backup': {
    args: [grantId: string]
    return: { success: boolean; backupId?: string; fileCount?: number; error?: string }
  }
  /** Restore an app-owned backup into a user-selected new project directory. */
  'project:restore-backup': {
    args: [backupGrantId: string, targetGrantId: string]
    return: { success: boolean; backupId?: string; projectId?: string; fileCount?: number; error?: string }
  }
  'project:recent-list': {
    args: []
    return: Array<{ name: string; path: string; updatedAt: string }>
  }
  'project:recent-remove': {
    args: [projectPath: string]
    return: { success: boolean; error?: string }
  }
  'project:delete': {
    args: [projectPath: string, projectId: string, sessionLease: string]
    return: {
      success: boolean
      directoryDeleted: boolean
      databaseRestored: boolean
      error?: string
      warning?: string
    }
  }
  'project:smoke-open-request': {
    args: []
    return: { projectPath: string; markerPath: string } | null
  }
  'project:smoke-open-confirm': {
    args: [projectPath: string]
    return: { success: boolean; error?: string }
  }
  'dialog:select-folder': {
    args: []
    return: string | null
  }
}

// ===== 文件系统 =====
export type FileWriteCommitState = 'not_committed' | 'committed' | 'unknown'

export interface FileChannels {
  'fs:read-file': {
    args: [filePath: string, expectedProjectPath: string]
    return: { success: boolean; content: string; error?: string }
  }
  'fs:write-file': {
    args: [filePath: string, content: string, expectedProjectPath: string]
    return: { success: boolean; commitState: FileWriteCommitState; error?: string }
  }
  'fs:list-dir': {
    args: [dirPath: string, expectedProjectPath: string]
    return: FileNode[]
  }
  'fs:mkdir': {
    args: [dirPath: string, expectedProjectPath: string]
    return: { success: boolean; error?: string }
  }
  'fs:check-exists': {
    args: [filePath: string, expectedProjectPath: string]
    return: boolean
  }
  'fs:read-json': {
    args: [filePath: string, expectedProjectPath: string]
    return: { success: boolean; data: unknown; error?: string }
  }
  'fs:write-json': {
    args: [filePath: string, data: unknown, expectedProjectPath: string]
    return: { success: boolean; error?: string }
  }
  /** 用户选择后签发的授权；渲染进程仅能携带 grantId 与受限相对路径。 */
  'fs:grant-read-file': {
    args: [grantId: string, relativePath?: string]
    return: { success: boolean; content: string; error?: string }
  }
  'fs:grant-write-file': {
    args: [grantId: string, relativePath: string, content: string]
    return:
      | { success: true }
      | { success: false; commitState: Exclude<FileWriteCommitState, 'committed'>; error?: string }
  }
  /** Binary payloads are base64 so renderer never receives a writable path. */
  'fs:grant-write-base64-file': {
    args: [grantId: string, relativePath: string, base64: string]
    return:
      | { success: true }
      | { success: false; commitState: Exclude<FileWriteCommitState, 'committed'>; error?: string }
  }
  'fs:grant-mkdir': {
    args: [grantId: string, relativePath: string]
    return: { success: boolean; error?: string }
  }
  'dialog:select-export-directory': {
    args: []
    return: ExternalDirectoryGrant | null
  }
  'dialog:select-backup-directory': {
    args: []
    return: ExternalDirectoryGrant | null
  }
  'dialog:select-restore-directory': {
    args: []
    return: ExternalDirectoryGrant | null
  }
}

// ===== 项目自由 Markdown 文档 =====
export interface ProjectDocumentListResult {
  success: boolean
  documents: ProjectDocumentEntry[]
  error?: string
}

export interface ProjectDocumentImportResult {
  success: boolean
  imported: ProjectDocumentImportOutcome[]
  failed: ProjectDocumentImportFailure[]
  error?: string
}

/**
 * 所有 `docs:*` 通道都以当前项目租约 + 受控目录 `boundary` 为唯一权限边界。
 * 渲染进程只能提交受控目录内的相对路径，永远不能提交绝对路径。
 */
export interface ProjectDocumentChannels {
  'docs:list': {
    args: [expectedProjectPath: string]
    return: ProjectDocumentListResult
  }
  'docs:read': {
    args: [documentPath: string, expectedProjectPath: string]
    return: { success: boolean; content: string; error?: string }
  }
  'docs:write': {
    args: [documentPath: string, content: string, expectedProjectPath: string]
    return: { success: boolean; commitState: FileWriteCommitState; error?: string }
  }
  'docs:create': {
    args: [title: string, expectedProjectPath: string]
    return: { success: boolean; documentPath?: string; error?: string }
  }
  'docs:rename': {
    args: [documentPath: string, nextTitle: string, expectedProjectPath: string]
    return: {
      success: boolean
      documentPath?: string
      /**
       * 会话/租约在删除旧文件前失效时，新名称副本已经写入完成。
       * 渲染层据此告知作者“旧文件保留 + 新副本已存在”，而不是笼统的失败。
       */
      createdDocumentPath?: string
      error?: string
    }
  }
  'docs:delete': {
    args: [documentPath: string, expectedProjectPath: string]
    return: { success: boolean; error?: string }
  }
  /** 只读取已授权的外部 Markdown 并复制到当前项目；绝不修改来源文件。 */
  'docs:import': {
    args: [grantIds: string[], expectedProjectPath: string]
    return: ProjectDocumentImportResult
  }
  'docs:import-asset': {
    args: [documentPath: string, grantId: string, expectedProjectPath: string]
    return: { success: boolean; assetReference?: string; error?: string }
  }
  'docs:read-asset': {
    args: [documentPath: string, assetReference: string, expectedProjectPath: string]
    return: { success: boolean; dataUrl?: string; error?: string }
  }
  'dialog:select-markdown-files': {
    args: []
    return: ExternalFileGrant[] | null
  }
  'dialog:select-markdown-images': {
    args: []
    return: ExternalFileGrant[] | null
  }
}

// ===== LLM 调用 =====
export interface DiscoveredModel {
  /** Provider-owned model identifier exactly as returned by the list API. */
  id: string
  /** Provider-owned display name, falling back to the identifier. */
  name: string
  /** Value that can be saved in ModelProfile.modelName. */
  value: string
}

export type ModelDiscoveryErrorCode =
  | 'auth'
  | 'unsupported'
  | 'network'
  | 'invalid_response'
  | 'empty'

export type ModelDiscoveryResult =
  | { success: true; models: DiscoveredModel[] }
  | { success: false; errorCode: ModelDiscoveryErrorCode }

/** Unsaved endpoint fields required to request a provider's model list. */
export type ModelDiscoveryRequest = Pick<
  ModelProfile,
  'provider' | 'protocol' | 'baseUrl' | 'apiKey'
>

export interface LLMChannels {
  'llm:begin-execution-lease': {
    args: [modelId: string]
    return: {
      success: boolean
      lease?: ModelExecutionLeaseReceipt
      errorCode?: 'MODEL_NOT_FOUND' | 'LEASE_BEGIN_FAILED'
      error?: string
    }
  }
  'llm:close-execution-lease': {
    args: [leaseId: string]
    return: { success: boolean; error?: string }
  }
  'llm:generate': {
    args: [request: LLMRequest]
    return: LLMResponse
  }
  'llm:generate-stream': {
    args: [requestId: string, request: LLMRequest]
    return: { requestId: string; started: boolean; error?: string }
  }
  'llm:cancel': {
    args: [requestId: string]
    return: { success: boolean }
  }
  'llm:list-models': {
    args: []
    return: ModelProfile[]
  }
  'llm:discover-models': {
    /** Discovery uses the current settings form without persisting it first. */
    args: [request: ModelDiscoveryRequest]
    return: ModelDiscoveryResult
  }
  'llm:save-model': {
    args: [model: ModelProfile]
    return: { success: boolean }
  }
  'llm:delete-model': {
    args: [modelId: string]
    return: {
      success: boolean
      error?: string
      defaultModelId?: string | null
      defaultEmbeddingModelId?: string | null
    }
  }
  'llm:set-default-model': {
    args: [modelId: string | null]
    return: { success: boolean; error?: string }
  }
  'llm:get-default-model': {
    args: []
    return: string | null
  }
  'llm:set-default-embedding-model': {
    args: [modelId: string | null]
    return: { success: boolean; error?: string }
  }
  'llm:get-default-embedding-model': {
    args: []
    return: string | null
  }
  'llm:test-connection': {
    args: [model: ModelProfile, creativeStrategy?: CreativeStrategy]
    return: { success: boolean; error?: string }
  }
}

export interface LLMStreamEvents {
  'llm:stream-chunk': { requestId: string; chunk: string }
  'llm:stream-done': {
    requestId: string
    fullText: string
    usage?: TokenUsage
    /** Main-process-normalized completion state. Missing provider values become `unknown`. */
    finishReason: LLMFinishReason
  }
  'llm:stream-error': { requestId: string; error: string }
}

// ===== 公共数据类型 =====
export interface ProjectData {
  id: string
  name: string
  path: string
  /** 主进程签发；仅与 id 组合为会话凭据，path 不是授权。 */
  sessionLease?: string
  novelConfig: NovelConfig
  characterStates: string
  createdAt: string
  updatedAt: string
}

export interface NovelConfig {
  /**
   * Project content language; independent from the application UI locale.
   * Missing only while reading pre-language renderer drafts; project open normalizes it.
   */
  writingLanguage?: WritingLanguage
  /** Project-scoped writing intent; independent from the selected model. */
  creativeStrategy?: CreativeStrategy
  /** Project-scoped chapter count before an active narrative thread is marked dormant. */
  narrativeThreadDormantChapterThreshold?: number
  genre: string
  subGenre: string
  targetAudience: string
  totalChapters: number
  wordsPerChapter: number
  plotStructure: 'three_act' | 'heros_journey' | 'save_the_cat' | 'kishotenketsu' | 'multi_thread' | 'freeform'
  narrativePOV: 'third_limited' | 'first_person' | 'third_omniscient' | 'multi_pov'
  coreOutline: string
  worldSetting: string
  goldenFinger: string
  protagonistProfile: string
  globalGuidance: string
  writingStyle?: string
  referenceWorks?: string
  /** Formal, author-maintained creative direction Markdown. */
  creativeDirectionMarkdown?: string
  /** Formal, author-maintained prose execution rules Markdown. */
  writingRulesMarkdown?: string
}

export interface FileNode {
  name: string
  path: string
  isDir: boolean
  children?: FileNode[]
}

/** 只携带用户可展示名称和不透明能力标识；不暴露外部绝对路径。 */
export interface ExternalFileGrant {
  grantId: string
  displayName: string
}

export type ExternalDirectoryGrant = ExternalFileGrant

/** 固定 app-data 服务使用的提示词数据；文件位置不由渲染进程决定。 */
export interface AppPromptTemplate {
  key: string
  writingLanguage?: WritingLanguage
  [key: string]: unknown
}

export interface PromptLoadDiagnostic {
  /** Derived from the owned filename when possible; absent means the whole scope is unreadable. */
  key?: string
  /** Absent on legacy receipts, which retain their original scope-wide behavior. */
  writingLanguage?: WritingLanguage
  path: string
  error: string
}

export interface AppPromptLoadReceipt {
  templates: AppPromptTemplate[]
  diagnostics: PromptLoadDiagnostic[]
}

export interface AppDataChannels {
  'prompt:load-global': { args: []; return: AppPromptLoadReceipt }
  'prompt:save-global': { args: [template: AppPromptTemplate]; return: { success: boolean; error?: string } }
  'prompt:delete-global': { args: [key: string, writingLanguage: WritingLanguage]; return: { success: boolean; error?: string } }
  'skills:list-user': {
    args: []
    return: Array<{ name: string; content: string; baseDir: string; filePath: string }>
  }
  'skills:inspect-github': {
    args: [sourceUrl: string]
    return: { success: boolean; inspection?: import('./writing-skills').RemoteWritingSkillInspection; error?: string }
  }
  'skills:install-github': {
    args: [sourceUrl: string]
    return: { success: boolean; skill?: import('./writing-skills').InstalledWritingSkill; error?: string }
  }
  'skills:uninstall-user': {
    args: [name: string]
    return: { success: boolean; error?: string }
  }
}

export interface LLMRequest {
  modelId: string
  /** Optional frozen main-process model snapshot; when present it is authoritative. */
  modelExecutionLeaseId?: string
  /** Stable attribution for per-project call history. */
  purpose?: string
  /** Project-scoped product intent captured by the renderer for this request. */
  creativeStrategy?: CreativeStrategy
  /** Controlled semantic stage; never inferred from the diagnostic purpose label. */
  reasoningStage?: GenerationReasoningStage
  /** Frozen project lease. Missing/stale leases are never written to project statistics. */
  projectSession?: ProjectSessionContext
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  maxTokens?: number
  stream?: boolean
  responseFormat?: { type: 'json_object' | 'text' }
}

export type ModelExecutionCapabilityEvidenceSource =
  | 'verified-provider-preset'
  | 'user-operational-cap'
  | 'legacy-profile'
  | 'unknown'

export interface ModelExecutionCapabilityEvidence {
  source: {
    contextWindowTokens: ModelExecutionCapabilityEvidenceSource
    maxOutputTokens: ModelExecutionCapabilityEvidenceSource
    featureFlags: ModelExecutionCapabilityEvidenceSource
  }
  subjectFingerprint: string
  contextWindowTokens: number | null
  maxOutputTokens: number
  reasoning: boolean | null
  structuredOutput: boolean | null
  usage: boolean | null
}

/** Non-secret evidence for a complete ModelProfile snapshot retained only in the main process. */
export interface ModelExecutionLeaseReceipt {
  leaseId: string
  modelId: string
  provider: ModelProfile['provider']
  protocol: ModelProfile['protocol']
  modelName: string
  modelRevision: string
  endpointFingerprint: string
  capabilityEvidence: ModelExecutionCapabilityEvidence
  createdAt: number
  expiresAt: number
}

interface LLMResponseBase {
  content: string
  usage?: TokenUsage
  error?: string
}

/** Every non-stream response carries explicit terminal evidence. */
export type LLMResponse =
  | (LLMResponseBase & { success: true; finishReason: 'stop' })
  | (LLMResponseBase & {
      success: false
      finishReason: Exclude<LLMFinishReason, 'stop'>
    })

/**
 * Provider-neutral end state for generated text. `stop` is the only state
 * that downstream workflows and the Agent may treat as a complete response.
 */
export type LLMFinishReason =
  | 'stop'
  | 'length'
  | 'content_filter'
  | 'cancelled'
  | 'error'
  | 'unknown'

export interface TokenUsage {
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
}

export interface ModelProfile {
  id: string
  name: string
  provider: 'openai' | 'gemini' | 'deepseek' | 'ollama' | 'bigmodel' | 'novelai' | 'xai' | 'siliconflow' | 'custom'
  protocol: 'openai' | 'gemini'
  modelName: string
  apiKey: string
  baseUrl: string
  temperature: number
  /** 新配置使用的端点能力；旧配置缺失时继续使用 maxTokens。 */
  capabilities?: ModelCapabilities
  /** 旧配置和当前执行路径使用的输出 token 上限，保持兼容。 */
  maxTokens: number
  purposes: Array<'generation' | 'refinement' | 'summary' | 'embedding'>
  /** Profile-scoped advanced request; `auto` defers to project strategy and purpose. */
  reasoningOverride?: ReasoningOverride
  /** 仅用于 Embedding 模型；旧配置省略时沿用原有默认行为。 */
  embeddingOptions?: EmbeddingOptions
}

export interface ProjectClearOptions {
  creativeFields?: boolean
  blueprints?: boolean
  generatedText?: boolean
  /** Required when creativeFields clears the synopsis; guards against stale UI state. */
  expectedSynopsisHash?: string
}

export type ProjectClearScope = 'creativeFields' | 'blueprints' | 'generatedText'

// ===== 引入 DB 类型 =====
import type {
  ProjectCoreData,
  ProjectCoreSynopsisCommitRequest,
} from '../../electron/repositories/project-core-repository'
import type {
  BlueprintPlanningCandidateListScope,
  BlueprintPlanningCandidateRecord,
  BlueprintPlanningCandidateSaveInput,
  BlueprintPlanningCandidateUpdateInput,
  BlueprintPlanningCheckListScope,
  BlueprintPlanningCheckRecord,
  BlueprintPlanningCheckReport,
  BlueprintPlanningCheckSaveResult,
  BlueprintPlanningConfirmInput,
  BlueprintPlanningConfirmResult,
  BlueprintPlanningExportPackage,
  BlueprintPlanningSourceStatusRecord,
  BlueprintPlanningTargetSourceReference,
  BlueprintPlanningTargetSourceStatusRecord,
  BlueprintVolumeOutline,
  BlueprintVolumeOutlineDeleteInput,
  BlueprintVolumeOutlineSaveInput,
  BlueprintVolumeOutlineSummary,
} from './blueprint-planning'
import type {
  BlueprintCharacterSyncOperation,
  BlueprintData,
  BlueprintListSummary,
  BlueprintRecentNoteSummary,
  BlueprintVolumeData,
  BlueprintRangeCommitReceipt,
  BlueprintRangeCommitRequest,
} from '../../electron/repositories/blueprint-repository'
import type {
  ChapterBlueprintV2DetailRead,
  ChapterBlueprintV2SaveInput,
  ChapterBlueprintV2Summary,
} from './blueprint-v2'
import type {
  CharacterData,
} from '../../electron/repositories/character-repository'
import type { DraftMeta, DraftFull } from '../../electron/repositories/draft-repository'
import type {
  DraftMarkdownSelectionRequest,
  DraftMarkdownSelectionReceiptItem,
  DraftMarkdownSelectionSnapshot,
  MarkdownChapterDraftCommitResult,
  MarkdownChapterDraftInspection,
} from './markdown-exchange'
import type {
  FinalizedDraftExportAuthorityReceipt,
  FinalizedDraftExportSnapshot,
} from '../../electron/repositories/finalization-repository'
import type { RevisionMeta, RevisionFull } from '../../electron/repositories/revision-repository'
import type { ReviewMeta, ReviewFull } from '../../electron/repositories/review-repository'
import type { PostProcessRunData, PostProcessStepData } from '../../electron/repositories/post-process-repository'
import type {
  CharacterRosterCommitReceipt,
  CharacterRosterCommitRequest,
  CharacterRosterSnapshot,
} from './character-roster'
import type {
  FinalizedDraftImportReceipt,
  FinalizedDraftImportRequest,
} from './finalized-draft-import'
import type {
  AuthorManuscriptImportPreview,
  AuthoritativeChapterSequence,
} from './author-manuscript-import'
import type {
  ImportGlobalFactsReceipt,
  ImportGlobalFactsRequest,
} from './import-global-facts'
import type {
  ForeshadowingRecord,
  CreateForeshadowingInput,
  UpdateForeshadowingInput,
} from './foreshadowing'
export type {
  ForeshadowingRecord,
  CreateForeshadowingInput,
  UpdateForeshadowingInput,
} from './foreshadowing'

// ===== 数据库操作 =====
export interface DatabaseChannels {
  'db:close': { args: [expectedProjectPath: string]; return: { success: boolean } }

  // 1. project_core
  'db:project-core-get': {
    args: [expectedProjectPath: string]
    return: ProjectCoreData | null
  }
  'db:creative-legacy-list': {
    args: [expectedProjectPath: string]
    return: LegacyCreativeSource[]
  }
  'db:creative-legacy-organize': {
    args: [input: CreativeLegacyOrganizationInput, expectedProjectPath: string]
    return: { success: boolean; error?: string }
  }
  'db:creative-material-list': {
    args: [filter: { entryKind?: CreativeMaterialKind; status?: CreativeMaterialStatus } | undefined, expectedProjectPath: string]
    return: CreativeMaterialEntry[]
  }
  'db:creative-material-save': {
    args: [input: CreativeMaterialSaveInput, expectedProjectPath: string]
    return: { success: boolean; entry?: CreativeMaterialEntry; error?: string }
  }
  'db:project-core-update': {
    args: [data: Partial<ProjectCoreData> & { expectedSynopsisHash?: string }, expectedProjectPath: string]
    return: { success: boolean; error?: string }
  }
  'db:project-core-synopsis-commit': {
    args: [request: ProjectCoreSynopsisCommitRequest, expectedProjectPath: string]
    return: { success: boolean; error?: string }
  }
  'db:import-global-facts-commit': {
    args: [request: ImportGlobalFactsRequest, expectedProjectPath: string]
    return: { success: boolean; receipt?: ImportGlobalFactsReceipt; error?: string }
  }
  'db:project-clear-generated-data': { args: [options: ProjectClearOptions, expectedProjectPath: string]; return: { success: boolean; cleared?: ProjectClearScope[]; physicalFilesDeleted?: number; error?: string } }
  'db:import-run-prepare-inspection': {
    args: [request: ImportRunPrepareFromInspectionRequest, expectedProjectPath: string]
    return: ImportRunPrepareFromInspectionResult
  }
  'db:import-run-author-preview': {
    args: [inspectionId: string, expectedProjectPath: string]
    return: AuthorManuscriptImportPreview
  }
  'db:import-run-finalize-parsing': {
    args: [runId: string, expectedProjectPath: string]
    return: { success: boolean; preparation?: ImportRunPreparationResult; error?: string }
  }
  'db:import-run-get': { args: [runId: string, expectedProjectPath: string]; return: ImportRunSnapshot | null }
  'db:import-run-list-resumable': { args: [expectedProjectPath: string]; return: ImportRunSnapshot[] }
  'db:import-run-list-chapters': {
    args: [runId: string, afterChapterNumber: number, limit: number, expectedProjectPath: string]
    return: ImportRunChapterSnapshot[]
  }
  'db:import-run-effect-receipt-get': {
    args: [runId: string, stage: ImportRunStage, batchId: string, expectedProjectPath: string]
    return: ImportRunEffectReceipt | null
  }
  'db:import-run-effect-receipt-prepare': {
    args: [request: ImportRunPrepareEffectReceiptRequest, execution: ImportRunExecutionLease, expectedProjectPath: string]
    return: { success: boolean; receipt?: ImportRunEffectReceipt; error?: string }
  }
  'db:import-run-effect-receipt-commit': {
    args: [runId: string, stage: ImportRunStage, batchId: string, execution: ImportRunExecutionLease, expectedProjectPath: string]
    return: { success: boolean; result?: ImportRunEffectCommitResult; error?: string }
  }
  'db:import-run-start-resume': { args: [runId: string, owner: string, expectedProjectPath: string]; return: { success: boolean; start?: ImportRunStartResult; error?: string } }
  'db:import-run-renew-execution': { args: [runId: string, execution: ImportRunExecutionLease, expectedProjectPath: string]; return: { success: boolean; execution?: ImportRunExecutionLease; error?: string } }
  'db:import-run-restart': { args: [runId: string, nextRunId: string, expectedProjectPath: string]; return: { success: boolean; run?: ImportRunSnapshot; error?: string } }
  'db:import-run-request-cancel': { args: [runId: string, execution: ImportRunExecutionLease, expectedProjectPath: string]; return: { success: boolean; run?: ImportRunSnapshot; error?: string } }
  'db:import-run-cancel-at-boundary': { args: [runId: string, execution: ImportRunExecutionLease, expectedProjectPath: string]; return: { success: boolean; run?: ImportRunSnapshot; error?: string } }
  'db:import-run-complete-batch': {
    args: [runId: string, stage: ImportRunStage, batchId: string, execution: ImportRunExecutionLease, expectedProjectPath: string]
    return: { success: boolean; newlyCompleted?: boolean; cancelApplied?: boolean; run?: ImportRunSnapshot; error?: string }
  }
  'db:import-run-advance-stage': {
    args: [runId: string, completedStage: ImportRunStage, nextStage: ImportRunStage, execution: ImportRunExecutionLease, expectedProjectPath: string]
    return: { success: boolean; run?: ImportRunSnapshot; error?: string }
  }
  'db:import-run-fail': {
    args: [runId: string, stage: ImportRunStage, errorMessage: string, execution: ImportRunExecutionLease, expectedProjectPath: string]
    return: { success: boolean; run?: ImportRunSnapshot; error?: string }
  }
  'db:import-run-complete': { args: [runId: string, execution: ImportRunExecutionLease, expectedProjectPath: string]; return: { success: boolean; run?: ImportRunSnapshot; error?: string } }

  // 2. blueprints
  'db:blueprint-get-all': { args: [expectedProjectPath: string]; return: BlueprintData[] }
  'db:blueprint-list-summary': { args: [expectedProjectPath: string]; return: BlueprintListSummary[] }
  'db:blueprint-recent-notes': { args: [expectedProjectPath: string]; return: BlueprintRecentNoteSummary[] }
  'db:blueprint-volume-list': { args: [expectedProjectPath: string]; return: BlueprintVolumeData[] }
  'db:blueprint-volume-upsert': { args: [volume: BlueprintVolumeData, expectedProjectPath: string]; return: { success: boolean; error?: string } }
  'db:blueprint-volume-outline-get': { args: [volumeId: string, expectedProjectPath: string]; return: BlueprintVolumeOutline | null }
  'db:blueprint-volume-outline-list-summaries': { args: [expectedProjectPath: string]; return: BlueprintVolumeOutlineSummary[] }
  'db:blueprint-volume-outline-save': {
    args: [input: BlueprintVolumeOutlineSaveInput, expectedProjectPath: string]
    return: { success: true; outline: BlueprintVolumeOutline } | { success: false; code: string; error: string; current?: BlueprintVolumeOutline | null }
  }
  'db:blueprint-volume-outline-delete': {
    args: [input: BlueprintVolumeOutlineDeleteInput, expectedProjectPath: string]
    return: { success: true; deleted: boolean } | { success: false; code: string; error: string; current?: BlueprintVolumeOutline | null }
  }
  'db:blueprint-planning-candidate-save': {
    args: [input: BlueprintPlanningCandidateSaveInput, expectedProjectPath: string]
    return: { success: true; candidate: BlueprintPlanningCandidateRecord; idempotent: boolean } | { success: false; code: string; error: string }
  }
  'db:blueprint-planning-candidate-update': {
    args: [input: BlueprintPlanningCandidateUpdateInput, expectedProjectPath: string]
    return: { success: true; candidate: BlueprintPlanningCandidateRecord } | { success: false; code: string; error: string; current?: BlueprintPlanningCandidateRecord }
  }
  'db:blueprint-planning-candidate-get': { args: [operationId: string, expectedProjectPath: string]; return: BlueprintPlanningCandidateRecord | null }
  'db:blueprint-planning-candidate-list': {
    args: [scope: BlueprintPlanningCandidateListScope, expectedProjectPath: string]
    return: BlueprintPlanningCandidateRecord[]
  }
  'db:blueprint-planning-candidate-cancel': {
    args: [operationId: string, expectedProjectPath: string]
    return: { success: true; candidate: BlueprintPlanningCandidateRecord } | { success: false; code: string; error: string }
  }
  'db:blueprint-planning-confirm': {
    args: [input: BlueprintPlanningConfirmInput, expectedProjectPath: string]
    return: BlueprintPlanningConfirmResult
  }
  'db:blueprint-planning-source-status': {
    args: [snapshotIds: string[], expectedProjectPath: string]
    return: BlueprintPlanningSourceStatusRecord[]
  }
  'db:blueprint-planning-target-source-status': {
    args: [targets: BlueprintPlanningTargetSourceReference[], expectedProjectPath: string]
    return: BlueprintPlanningTargetSourceStatusRecord[]
  }
  'db:blueprint-planning-check-save': {
    args: [report: BlueprintPlanningCheckReport, expectedProjectPath: string]
    return: BlueprintPlanningCheckSaveResult
  }
  'db:blueprint-planning-check-list': {
    args: [scope: BlueprintPlanningCheckListScope, expectedProjectPath: string]
    return: BlueprintPlanningCheckRecord[]
  }
  'db:blueprint-planning-export': { args: [expectedProjectPath: string]; return: BlueprintPlanningExportPackage }
  'db:blueprint-get': { args: [chapterNumber: number, expectedProjectPath: string]; return: BlueprintData | null }
  'db:blueprint-upsert': { args: [data: BlueprintData, expectedProjectPath: string]; return: { success: boolean; error?: string } }
  'db:blueprint-upsert-many': { args: [items: BlueprintData[], expectedProjectPath: string]; return: { success: boolean; error?: string } }
  'db:blueprint-commit-range': {
    args: [request: BlueprintRangeCommitRequest, expectedProjectPath: string]
    return: { success: boolean; receipt?: BlueprintRangeCommitReceipt; error?: string }
  }
  'db:blueprint-character-sync-list-pending': {
    args: [expectedProjectPath: string]
    return: BlueprintCharacterSyncOperation[]
  }
  'db:blueprint-character-sync-get': {
    args: [operationId: string, expectedProjectPath: string]
    return: BlueprintCharacterSyncOperation | null
  }
  'db:blueprint-character-sync-complete': {
    args: [
      operationId: string,
      expectedProjectPath: string,
    ]
    return: { success: boolean; operation?: BlueprintCharacterSyncOperation; error?: string }
  }
  'db:blueprint-update-notes': { args: [chapterNumber: number, notes: string, expectedProjectPath: string]; return: { success: boolean; updated?: boolean; error?: string } }
  'db:blueprint-delete': { args: [chapterNumber: number, expectedProjectPath: string]; return: { success: boolean; error?: string } }
  'db:blueprint-clear-all': { args: [expectedProjectPath: string]; return: { success: boolean; error?: string } }

  // 2b. blueprint_details — 章节蓝图 v2 细纲（blueprint-v2-contract §6，冻结通道）
  // corrupt / needs-newer-app 以 Detail 上的附加可选字段表达（契约缺口 §13.5），
  // 正常读取时与冻结的 ChapterBlueprintV2Detail | null 完全一致。
  'db:blueprint-v2-get': { args: [chapterNumber: number, expectedProjectPath: string]; return: ChapterBlueprintV2DetailRead | null }
  'db:blueprint-v2-summary-list': { args: [expectedProjectPath: string]; return: ChapterBlueprintV2Summary[] }
  'db:blueprint-v2-save': {
    args: [input: ChapterBlueprintV2SaveInput, expectedProjectPath: string]
    return: { success: boolean; revision?: number; contentHash?: string; conflict?: boolean; currentRevision?: number; error?: string }
  }
  'db:blueprint-v2-scene-order-save': {
    args: [input: { chapterNumber: number; baseRevision: number; orderedSceneIds: string[] }, expectedProjectPath: string]
    return: { success: boolean; revision?: number; contentHash?: string; conflict?: boolean; currentRevision?: number; error?: string }
  }
  'db:blueprint-v2-delete': { args: [chapterNumber: number, expectedProjectPath: string]; return: { success: boolean; error?: string } }
  'db:blueprint-v2-review-notices-clear': { args: [chapterNumber: number, expectedProjectPath: string]; return: { success: boolean; error?: string } }

  // 3. characters
  'db:character-get-all': { args: [expectedProjectPath: string]; return: CharacterData[] }
  /**
   * 结构化角色名单的唯一提交 seam。角色条目仍持久化于 characters 表；
   * 返回的快照经过主进程事务内 read-back 验证。
   */
  'db:cultivation-read': { args: [expectedProjectPath: string]; return: import('./cultivation').CultivationSystem }
  'db:cultivation-save': { args: [request: import('./cultivation').CultivationSaveRequest, expectedProjectPath: string]; return: { success: boolean; result?: import('./cultivation').CultivationSaveResult; error?: string } }
  'db:character-roster-read': {
    args: [expectedProjectPath: string]
    return: CharacterRosterSnapshot
  }
  'db:character-roster-commit': {
    args: [request: CharacterRosterCommitRequest, expectedProjectPath: string]
    return: { success: boolean; receipt?: CharacterRosterCommitReceipt; error?: string }
  }
  'db:character-identities-get': {
    args: [expectedProjectPath: string]
    return: CharacterIdentityMap
  }
  'db:character-identities-ensure': {
    args: [names: string[], expectedProjectPath: string]
    return: CharacterIdentityMap
  }
  'db:character-relationships-get-all': {
    args: [expectedProjectPath: string]
    return: CharacterSharedRelationship[]
  }
  'db:character-relationship-upsert': {
    args: [
      data: {
        id?: string
        character1Id: string
        character2Id: string
        relation: string
        description?: string
      },
      expectedProjectPath: string,
    ]
    return: { success: boolean; relationship?: CharacterSharedRelationship; error?: string }
  }
  'db:character-relationship-delete': {
    args: [id: string, expectedProjectPath: string]
    return: { success: boolean; error?: string }
  }
  'db:character-graph-positions-get': {
    args: [expectedProjectPath: string]
    return: Record<string, CharacterGraphPosition>
  }
  'db:character-graph-positions-save': {
    args: [positions: Record<string, CharacterGraphPosition>, expectedProjectPath: string]
    return: { success: boolean; error?: string }
  }

  // 4. drafts
  'db:draft-import-finalized-batch': {
    args: [request: FinalizedDraftImportRequest, expectedProjectPath: string]
    return: { success: boolean; receipt?: FinalizedDraftImportReceipt; error?: string }
  }
  'db:prose-order': { args: [expectedProjectPath: string]; return: ProseOrderEntry[] }
  'db:prose-trash': { args: [expectedProjectPath: string]; return: ProseTrashEntry[] }
  'db:prose-directory-action': { args: [action: ProseDirectoryAction, expectedProjectPath: string]; return: { success: boolean; trashId?: number; warning?: string; error?: string } }
  'db:prose-volume-list': { args: [expectedProjectPath: string]; return: BlueprintVolumeData[] }
  'db:prose-volume-delete': { args: [volumeId: string, expectedProjectPath: string]; return: { success: boolean; error?: string } }
  'db:chapter-volume-list': { args: [expectedProjectPath: string]; return: Array<{ chapterNumber: number; volumeId: string | null }> }
  'db:chapter-volume-set': { args: [chapterNumber: number, volumeId: string | null, expectedProjectPath: string]; return: { success: boolean; error?: string } }
  'db:draft-create': { args: [params: { chapterNumber: number; blueprintChapterNumber?: number | null; volumeId?: string | null; chapterTitle?: string; insertRelativeTo?: number; insertSide?: 'before' | 'after'; version: number; source: 'write' | 'rewrite'; content: string; wordCount: number; sourceDependencies?: DraftSourceDependency[] }, expectedProjectPath: string]; return: { success: boolean; id?: number; error?: string } }
  'db:draft-list': { args: [chapterNumber: number, expectedProjectPath: string]; return: DraftMeta[] }
  'db:draft-list-all': { args: [expectedProjectPath: string]; return: DraftMeta[] }
  'db:draft-get-meta': { args: [id: number, expectedProjectPath: string]; return: DraftMeta | null }
  'db:draft-get-full': { args: [id: number, expectedProjectPath: string]; return: DraftFull | null }
  'db:draft-get-latest': { args: [chapterNumber: number, expectedProjectPath: string]; return: DraftMeta | null }
  'db:draft-get-finalized': { args: [chapterNumber: number, expectedProjectPath: string]; return: DraftMeta | null }
  'db:draft-get-max-finalized-chapter': { args: [expectedProjectPath: string]; return: number }
  'db:draft-authority-sequence': { args: [expectedProjectPath: string]; return: AuthoritativeChapterSequence }
  'db:draft-export-snapshot': { args: [expectedProjectPath: string]; return: FinalizedDraftExportSnapshot[] }
  'db:draft-export-authority-current': {
    args: [receipt: FinalizedDraftExportAuthorityReceipt, expectedProjectPath: string]
    return: boolean
  }
  'db:draft-export-selection': {
    args: [selection: DraftMarkdownSelectionRequest[], expectedProjectPath: string]
    return: DraftMarkdownSelectionSnapshot
  }
  'db:draft-export-selection-current': {
    args: [receipt: DraftMarkdownSelectionReceiptItem[], expectedProjectPath: string]
    return: boolean
  }
  'db:draft-import-markdown': {
    args: [inspectionId: string, projectSession: ProjectSessionContext, expectedProjectPath: string]
    return: MarkdownChapterDraftCommitResult
  }
  'db:foreshadowing-list': {
    args: [filter: 'all' | 'pending' | 'completed' | undefined, expectedProjectPath: string]
    return: ForeshadowingRecord[]
  }
  'db:foreshadowing-list-by-draft': {
    args: [draftId: number, expectedProjectPath: string]
    return: ForeshadowingRecord[]
  }
  'db:foreshadowing-create': {
    args: [input: CreateForeshadowingInput, expectedProjectPath: string]
    return: { success: boolean; id?: string; error?: string }
  }
  'db:foreshadowing-update': {
    args: [id: string, updates: UpdateForeshadowingInput, expectedProjectPath: string]
    return: { success: boolean; error?: string }
  }
  'db:foreshadowing-toggle-completed': {
    args: [id: string, completed: boolean, expectedProjectPath: string]
    return: { success: boolean; error?: string }
  }
  'db:foreshadowing-delete': {
    args: [id: string, expectedProjectPath: string]
    return: { success: boolean; error?: string }
  }
  'db:continuity-save-finalized': {
    args: [request: SaveFinalizedContinuityRequest, expectedProjectPath: string]
    return: { success: boolean; error?: string }
  }
  'db:continuity-save-character-state-candidates': {
    args: [request: SaveFinalizedCharacterStateCandidatesRequest, expectedProjectPath: string]
    return: { success: boolean; error?: string }
  }
  'db:continuity-list-before': {
    args: [chapterNumber: number, expectedProjectPath: string]
    return: FinalizedContinuityProjection[]
  }
  'db:continuity-read-source': {
    args: [draftId: number, expectedProjectPath: string]
    return: FinalizedSourceReadResult
  }
  'db:consistency-exemption-list': { args: [expectedProjectPath: string]; return: ConsistencyExemption[] }
  'db:consistency-exemption-save': {
    args: [stableFactKey: string, reason: string, expectedProjectPath: string]
    return: { success: boolean; error?: string }
  }
  'db:consistency-exemption-revoke': {
    args: [stableFactKey: string, expectedProjectPath: string]
    return: { success: boolean; error?: string }
  }
  'db:narrative-thread-list': {
    args: [expectedProjectPath: string]
    return: NarrativeThreadView[]
  }
  'db:narrative-thread-list-relevant': {
    args: [context: NarrativeThreadChapterContext, expectedProjectPath: string]
    return: NarrativeThreadView[]
  }
  'db:narrative-thread-plan-create': {
    args: [input: NarrativeThreadPlanInput, expectedProjectPath: string]
    return: { success: boolean; plan?: NarrativeThreadPlanRecord; error?: string }
  }
  'db:narrative-thread-plan-update': {
    args: [id: number, input: NarrativeThreadPlanInput, expectedProjectPath: string]
    return: { success: boolean; plan?: NarrativeThreadPlanRecord; error?: string }
  }
  'db:narrative-thread-plan-delete': {
    args: [id: number, expectedProjectPath: string]
    return: { success: boolean; error?: string }
  }
  'db:narrative-thread-event-confirm': {
    args: [input: NarrativeThreadEventInput, expectedProjectPath: string]
    return: { success: boolean; event?: NarrativeThreadEvent; error?: string }
  }
  'db:plot-tree-read': {
    args: [expectedProjectPath: string]
    return: PlotTreeSourceBundle
  }
  'db:plot-tree-save': {
    args: [snapshot: PlotTreeSnapshot, expectedSourceRevision: string, expectedProjectPath: string]
    return: { success: boolean; snapshot?: PlotTreeSnapshot; errorCode?: 'sources-changed'; error?: string }
  }
  'db:plot-tree-clear': {
    args: [expectedProjectPath: string]
    return: { success: boolean; error?: string }
  }
  'db:draft-next-version': { args: [chapterNumber: number, expectedProjectPath: string]; return: number }
  'db:draft-update-status': { args: [id: number, status: string, wordCount: number | undefined, expectedProjectPath: string]; return: { success: boolean; error?: string } }
  'db:draft-update-content': { args: [id: number, content: string, wordCount: number, expectedProjectPath: string]; return: { success: boolean; error?: string } }
  'db:draft-set-blueprint': { args: [id: number, blueprintChapterNumber: number | null, expectedProjectPath: string]; return: { success: boolean; error?: string } }
  'db:draft-delete': {
    args: [id: number, expectedProjectPath: string]
    return: {
      success: boolean
      errorCode?: 'FINALIZED_DRAFT_DELETE_REQUIRED'
      error?: string
    }
  }
  'db:recovery-candidate-record': {
    args: [request: RecoveryCandidateRecordInput, expectedProjectPath: string]
    return: { success: boolean; candidate?: RecoveryCandidate; error?: string }
  }
  'db:recovery-candidate-list': {
    args: [expectedProjectPath: string]
    return: RecoveryCandidate[]
  }
  'db:recovery-candidate-update': {
    args: [candidateId: string, visibleText: string, expectedProjectPath: string]
    return: { success: boolean; candidate?: RecoveryCandidate; error?: string }
  }
  'db:recovery-candidate-resolve': {
    args: [candidateId: string, status: 'continued' | 'discarded', expectedProjectPath: string]
    return: { success: boolean; error?: string }
  }
  'db:finalization-link-knowledge-document': {
    args: [draftId: number, documentId: string, expectedProjectPath: string]
    return: { success: boolean; finalization?: { knowledgeDocumentId: string }; error?: string }
  }

  // 5. revisions
  'db:revision-create': { args: [params: { baseDraftId: number; revisionType: 'refine' | 'review-fix'; userPrompt?: string; reviewSourceId?: number; content: string; wordCount: number; expectedSource?: ExpectedDraftSource }, expectedProjectPath: string]; return: { success: boolean; id?: number; revisionIndex?: number; errorCode?: SourceDraftGuardErrorCode; error?: string } }
  'db:revision-replace-pending': { args: [params: { baseDraftId: number; revisionType: 'refine' | 'review-fix'; userPrompt?: string; reviewSourceId?: number; content: string; wordCount: number; expectedSource?: ExpectedDraftSource }, expectedProjectPath: string]; return: { success: boolean; id?: number; revisionIndex?: number; errorCode?: SourceDraftGuardErrorCode; error?: string } }
  'db:revision-list': { args: [baseDraftId: number, expectedProjectPath: string]; return: RevisionMeta[] }
  'db:revision-get-pending': { args: [baseDraftId: number, expectedProjectPath: string]; return: RevisionMeta[] }
  'db:revision-get-full': { args: [id: number, expectedProjectPath: string]; return: RevisionFull | null }
  'db:revision-next-index': { args: [baseDraftId: number, expectedProjectPath: string]; return: number }
  'db:revision-merge': {
    args: [request: {
      revisionId: number
      targetDraftId: number
      expectedDraftContent: string
      mergedContent: string
      wordCount: number
    }, expectedProjectPath: string]
    return: {
      success: boolean
      receipt?: {
        revisionId: number
        targetDraftId: number
        status: 'revised'
        wordCount: number
        idempotent: boolean
      }
      error?: string
    }
  }
  'db:revision-mark-merged': { args: [id: number, mergedToDraftId: number, expectedProjectPath: string]; return: { success: boolean; error?: string } }
  'db:revision-mark-discarded': { args: [id: number, expectedProjectPath: string]; return: { success: boolean; error?: string } }

  // 6. reviews
  'db:review-create': { args: [params: { baseDraftId: number; reviewIndex?: number; content: string; expectedSource?: ExpectedDraftSource }, expectedProjectPath: string]; return: { success: boolean; id?: number; reviewIndex?: number; errorCode?: SourceDraftGuardErrorCode; error?: string } }
  'db:review-list': { args: [baseDraftId: number, expectedProjectPath: string]; return: ReviewMeta[] }
  'db:review-get-latest': { args: [baseDraftId: number, expectedProjectPath: string]; return: ReviewFull | null }
  'db:review-get-full': { args: [id: number, expectedProjectPath: string]; return: ReviewFull | null }
  'db:review-next-index': { args: [baseDraftId: number, expectedProjectPath: string]; return: number }

  // 7. post_process
  'db:post-process-create-run': { args: [params: { triggerSourceType: string; triggerSourceId: string; sourceLabel: string; steps: Array<{ key: string; label: string; critical: boolean }> }, expectedProjectPath: string]; return: { success: boolean; id?: string; error?: string } }
  'db:post-process-get-latest-run': { args: [sourceType: string, sourceId: string, expectedProjectPath: string]; return: PostProcessRunData | null }
  'db:post-process-get-steps': { args: [runId: string, expectedProjectPath: string]; return: PostProcessStepData[] }
  'db:post-process-mark-step-ok': { args: [runId: string, stepKey: string, expectedProjectPath: string]; return: { success: boolean; error?: string } }
  'db:post-process-mark-step-failed': { args: [runId: string, stepKey: string, errorMsg: string, expectedProjectPath: string]; return: { success: boolean; error?: string } }
  'db:post-process-is-all-passed': { args: [sourceType: string, sourceId: string, expectedProjectPath: string]; return: boolean }

  // 沿用旧表
  'db:log-llm-call': { args: [call: Record<string, unknown>, expectedProjectPath: string]; return: { success: boolean } }
  'db:get-llm-stats': {
    args: [expectedProjectPath: string]
    return: {
      totalCalls: number
      successfulCalls: number
      failedCalls: number
      knownUsageCalls: number
      totalTokens: number | null
      totalPromptTokens: number | null
      totalCompletionTokens: number | null
    }
  }
  'db:get-llm-history': { args: [limit: number | undefined, expectedProjectPath: string]; return: unknown[] }
  'db:save-summary-snapshot': { args: [chapterNumber: number, characterStates: string, expectedProjectPath: string]; return: { success: boolean } }
  'db:get-latest-summary': { args: [expectedProjectPath: string]; return: { characterStates: string; chapterNumber: number } | null }
  'db:map-get-all': { args: [expectedProjectPath: string]; return: WorldMapAtlas }
  'db:map-upsert': { args: [map: WorldMap, expectedProjectPath: string]; return: { success: boolean; map?: WorldMap; error?: string } }
  'db:map-delete': { args: [mapId: string, strategy: 'promote-children' | 'cascade', expectedProjectPath: string]; return: { success: boolean; removedMapIds?: string[]; error?: string } }
  'db:map-reorder': { args: [orderedIds: string[], expectedProjectPath: string]; return: { success: boolean; error?: string } }
  'db:map-migration-ack': { args: [expectedProjectPath: string]; return: { success: boolean; error?: string } }
  'db:map-node-upsert': { args: [node: WorldMapNode, expectedProjectPath: string]; return: { success: boolean; node?: WorldMapNode; error?: string } }
  'db:map-node-delete': { args: [id: string, expectedProjectPath: string]; return: { success: boolean; error?: string } }
  'db:map-edge-upsert': { args: [edge: WorldMapEdge, expectedProjectPath: string]; return: { success: boolean; edge?: WorldMapEdge; error?: string } }
  'db:map-edge-delete': { args: [id: string, expectedProjectPath: string]; return: { success: boolean; error?: string } }
  'db:map-candidates-get': { args: [expectedProjectPath: string]; return: WorldMapCandidate[] }
  'db:timeline-get-all': { args: [expectedProjectPath: string]; return: StoryTimelineSnapshot }
  'db:timeline-settings-save': { args: [settings: StoryTimelineSettings, expectedProjectPath: string]; return: { success: boolean; settings?: StoryTimelineSettings; error?: string } }
  'db:timeline-event-upsert': { args: [event: StoryTimelineEvent, expectedProjectPath: string]; return: { success: boolean; event?: StoryTimelineEvent; error?: string } }
  'db:timeline-event-delete': { args: [id: string, expectedProjectPath: string]; return: { success: boolean; error?: string } }
  'db:timeline-events-reorder': { args: [orderedIds: string[], expectedProjectPath: string]; return: { success: boolean; error?: string } }
  'db:timeline-branch-upsert': { args: [branch: StoryTimelineBranch, expectedProjectPath: string]; return: { success: boolean; branch?: StoryTimelineBranch; error?: string } }
  'db:timeline-branch-delete': { args: [id: string, expectedProjectPath: string]; return: { success: boolean; error?: string } }
  'db:timeline-branch-create-with-event': { args: [branch: StoryTimelineBranch, event: StoryTimelineEvent, expectedProjectPath: string]; return: { success: boolean; branch?: StoryTimelineBranch; event?: StoryTimelineEvent; error?: string } }
  // 删除影响预览与确认删除：预览由主进程按真实级联规则收集；确认删除回传
  // 预览指纹，影响集合已变化时返回 needsReconfirmation 而不是静默扩大范围。
  'db:timeline-event-delete-preview': { args: [eventId: string, expectedProjectPath: string]; return: StoryTimelineDeletePreviewResult }
  'db:timeline-branch-delete-preview': { args: [branchId: string, expectedProjectPath: string]; return: StoryTimelineDeletePreviewResult }
  'db:timeline-event-delete-confirmed': { args: [eventId: string, fingerprint: string, expectedProjectPath: string]; return: StoryTimelineDeleteCommitResult }
  'db:timeline-branch-delete-confirmed': { args: [branchId: string, fingerprint: string, expectedProjectPath: string]; return: StoryTimelineDeleteCommitResult }

  // 7.5 world — 多世界资料（世界/势力/秘境/通道/规则/人物关联与行踪）
  // 读路径返回完整快照；写路径返回 { success, error } 并携带保存后的实体。
  'db:world-get-all': { args: [expectedProjectPath: string]; return: WorldWorkbenchSnapshot }
  'db:world-upsert': { args: [world: WorldRecord, expectedProjectPath: string]; return: { success: boolean; world?: WorldRecord; error?: string } }
  'db:world-delete-plan': { args: [worldId: string, expectedProjectPath: string]; return: { success: boolean; plan?: WorldDeletePlan; error?: string } }
  'db:world-delete': { args: [worldId: string, expectedProjectPath: string]; return: { success: boolean; error?: string } }

  'db:world-map-assignment-plan': { args: [mapId: string, nextWorldId: string | null, expectedProjectPath: string]; return: { success: boolean; plan?: WorldMapAssignmentPlan; error?: string } }
  'db:world-map-assignment-apply': { args: [mapId: string, nextWorldId: string | null, expectedProjectPath: string]; return: { success: boolean; plan?: WorldMapAssignmentPlan; error?: string } }

  'db:world-faction-upsert': { args: [faction: WorldFaction, expectedProjectPath: string]; return: { success: boolean; faction?: WorldFaction; error?: string } }
  'db:world-faction-delete-plan': { args: [factionId: string, expectedProjectPath: string]; return: { success: boolean; plan?: WorldDeletePlan; error?: string } }
  'db:world-faction-delete': { args: [factionId: string, detachEventLinks: boolean, expectedProjectPath: string]; return: { success: boolean; error?: string } }
  'db:world-faction-place-upsert': { args: [place: WorldFactionPlace, expectedProjectPath: string]; return: { success: boolean; place?: WorldFactionPlace; error?: string } }
  'db:world-faction-relation-upsert': { args: [relation: WorldFactionRelation, expectedProjectPath: string]; return: { success: boolean; relation?: WorldFactionRelation; error?: string } }
  'db:world-faction-character-upsert': { args: [link: WorldFactionCharacter, expectedProjectPath: string]; return: { success: boolean; link?: WorldFactionCharacter; error?: string } }

  'db:world-relic-upsert': { args: [relic: WorldRelic, expectedProjectPath: string]; return: { success: boolean; relic?: WorldRelic; error?: string } }
  'db:world-relic-delete-plan': { args: [relicId: string, expectedProjectPath: string]; return: { success: boolean; plan?: WorldDeletePlan; error?: string } }
  'db:world-relic-delete': { args: [relicId: string, expectedProjectPath: string]; return: { success: boolean; error?: string } }
  'db:world-relic-faction-upsert': { args: [link: WorldRelicFaction, expectedProjectPath: string]; return: { success: boolean; link?: WorldRelicFaction; error?: string } }
  'db:world-relic-character-upsert': { args: [link: WorldRelicCharacter, expectedProjectPath: string]; return: { success: boolean; link?: WorldRelicCharacter; error?: string } }

  'db:world-portal-upsert': { args: [portal: WorldPortal, expectedProjectPath: string]; return: { success: boolean; portal?: WorldPortal; error?: string } }
  'db:world-portal-delete-plan': { args: [portalId: string, expectedProjectPath: string]; return: { success: boolean; plan?: WorldDeletePlan; error?: string } }
  'db:world-portal-delete': { args: [portalId: string, detachEventLinks: boolean, expectedProjectPath: string]; return: { success: boolean; error?: string } }
  'db:world-portal-faction-upsert': { args: [link: WorldPortalFaction, expectedProjectPath: string]; return: { success: boolean; link?: WorldPortalFaction; error?: string } }
  'db:world-portal-character-upsert': { args: [link: WorldPortalCharacter, expectedProjectPath: string]; return: { success: boolean; link?: WorldPortalCharacter; error?: string } }

  'db:world-rule-upsert': { args: [rule: WorldRule, expectedProjectPath: string]; return: { success: boolean; rule?: WorldRule; error?: string } }
  'db:world-rule-delete-plan': { args: [ruleId: string, expectedProjectPath: string]; return: { success: boolean; plan?: WorldDeletePlan; error?: string } }
  'db:world-rule-delete': { args: [ruleId: string, detachEventLinks: boolean, expectedProjectPath: string]; return: { success: boolean; error?: string } }
  'db:world-rule-target-upsert': { args: [target: WorldRuleTarget, expectedProjectPath: string]; return: { success: boolean; target?: WorldRuleTarget; error?: string } }

  'db:world-character-link-upsert': { args: [link: WorldCharacterLink, expectedProjectPath: string]; return: { success: boolean; link?: WorldCharacterLink; error?: string } }
  'db:world-character-location-birth-save': { args: [location: WorldCharacterLocation, expectedProjectPath: string]; return: { success: boolean; location?: WorldCharacterLocation; error?: string } }
  'db:world-character-current-location-commit': { args: [characterId: string, worldId: string | null, nodeId: string | null, options: WorldCurrentLocationCommitOptions, expectedProjectPath: string]; return: WorldLocationCommitResult }
  'db:world-character-current-location-clear': { args: [characterId: string, expectedProjectPath: string]; return: { success: boolean; error?: string } }

  'db:world-trail-commit': { args: [request: WorldTrailCommitRequest, expectedProjectPath: string]; return: WorldTrailCommitResult }
  'db:world-trail-delete-plan': { args: [trailId: string, expectedProjectPath: string]; return: { success: boolean; plan?: WorldDeletePlan; error?: string } }
  'db:world-trail-delete': { args: [trailId: string, releaseCurrentLocation: boolean, expectedProjectPath: string]; return: { success: boolean; error?: string } }

  'db:world-event-links-save': { args: [eventId: string, worldIds: string[], links: WorldEventLink[], expectedProjectPath: string]; return: { success: boolean; error?: string } }

  // 解除单条关联。与「删除实体」严格区分：只解除关系，绝不删除目标实体。
  'db:world-relation-delete': { args: [table: string, id: string, expectedProjectPath: string]; return: { success: boolean; error?: string } }

  // 8. plot_canvas — 作者可编辑的剧情画布（与 plot-tree 只读投影严格分离）
  'db:plot-canvas-list': { args: [expectedProjectPath: string]; return: PlotCanvasSummary[] }
  // 创建支持两种调用形态：旧调用（不带说明）与带说明的新调用；description
  // 可选，缺省为空字符串。
  'db:plot-canvas-create': {
    args:
      | [name: string, parentCanvasId: string | null, expectedProjectPath: string]
      | [name: string, parentCanvasId: string | null, description: string, expectedProjectPath: string]
    return: { success: boolean; canvas?: PlotCanvasSummary; error?: string }
  }
  'db:plot-canvas-update': { args: [input: PlotCanvasUpdatePayload, expectedProjectPath: string]; return: { success: boolean; canvas?: PlotCanvasSummary; error?: string } }
  'db:plot-canvas-rename': { args: [canvasId: string, name: string, expectedProjectPath: string]; return: { success: boolean; canvas?: PlotCanvasSummary; error?: string } }
  'db:plot-canvas-move': { args: [canvasId: string, parentCanvasId: string | null, expectedProjectPath: string]; return: { success: boolean; canvas?: PlotCanvasSummary; error?: string } }
  'db:plot-canvas-reorder': { args: [orderedIds: string[], expectedProjectPath: string]; return: { success: boolean; error?: string } }
  'db:plot-canvas-delete': { args: [canvasId: string, strategy: 'promote-children' | 'cascade', expectedProjectPath: string]; return: { success: boolean; removedCanvasIds?: string[]; error?: string } }
  'db:plot-canvas-graph-get': { args: [canvasId: string, expectedProjectPath: string]; return: PlotCanvasGraph }
  'db:plot-canvas-viewport-save': { args: [canvasId: string, viewport: PlotCanvasViewport, expectedProjectPath: string]; return: { success: boolean; error?: string } }
  'db:plot-canvas-node-upsert': { args: [input: PlotCanvasNodeUpsertPayload, expectedProjectPath: string]; return: { success: boolean; node?: PlotCanvasNodeData; error?: string } }
  'db:plot-canvas-node-delete': { args: [canvasId: string, nodeId: string, expectedProjectPath: string]; return: { success: boolean; error?: string } }
  'db:plot-canvas-nodes-reposition': { args: [canvasId: string, positions: Array<{ nodeId: string; x: number; y: number }>, expectedProjectPath: string]; return: { success: boolean; error?: string } }
  'db:plot-canvas-edge-upsert': { args: [input: PlotCanvasEdgeUpsertPayload, expectedProjectPath: string]; return: { success: boolean; edge?: PlotCanvasEdgeData; error?: string } }
  'db:plot-canvas-edge-delete': { args: [canvasId: string, edgeId: string, expectedProjectPath: string]; return: { success: boolean; error?: string } }
  'db:plot-canvas-graph-apply': { args: [input: PlotCanvasGraphApplyPayload, expectedProjectPath: string]; return: { success: boolean; graph?: PlotCanvasGraph; error?: string } }
  'db:plot-canvas-nodes-merge': { args: [input: PlotCanvasNodesMergePayload, expectedProjectPath: string]; return: { success: boolean; node?: PlotCanvasNodeData; error?: string } }

  // 9. chapter_canvas — 每章一张的章内场景编排画布
  'db:chapter-canvas-get': { args: [chapterNumber: number, expectedProjectPath: string]; return: { canvas: ChapterCanvasMeta | null; nodes: ChapterCanvasNodeData[]; edges: ChapterCanvasEdgeData[] } }
  'db:chapter-canvas-viewport-save': { args: [chapterNumber: number, viewport: { x: number; y: number; zoom: number }, expectedProjectPath: string]; return: { success: boolean; error?: string } }
  'db:chapter-canvas-node-upsert': { args: [input: ChapterCanvasNodeUpsertPayload, expectedProjectPath: string]; return: { success: boolean; node?: ChapterCanvasNodeData; error?: string } }
  'db:chapter-canvas-node-delete': { args: [chapterNumber: number, nodeId: string, expectedProjectPath: string]; return: { success: boolean; error?: string } }
  'db:chapter-canvas-nodes-reposition': { args: [chapterNumber: number, positions: Array<{ nodeId: string; x: number; y: number }>, expectedProjectPath: string]; return: { success: boolean; error?: string } }
  'db:chapter-canvas-edge-upsert': { args: [input: ChapterCanvasEdgeUpsertPayload, expectedProjectPath: string]; return: { success: boolean; edge?: ChapterCanvasEdgeData; error?: string } }
  'db:chapter-canvas-edge-delete': { args: [chapterNumber: number, edgeId: string, expectedProjectPath: string]; return: { success: boolean; error?: string } }

  // 14. 信息与揭露 / 人物行动线 / 正文反向修纲 / 检查报告 / 伏笔↔脉络关系
  //（knowledge-action-outline-sync-contract §3/§4/§5/§6/§7）
  'db:info-entry-list': { args: [filter: { truthStatus?: InfoTruthStatus; query?: string; chapterNumber?: number } | undefined, expectedProjectPath: string]; return: InfoEntry[] }
  'db:info-entry-get': { args: [id: string, expectedProjectPath: string]; return: InfoEntry | null }
  'db:info-entry-save': {
    args: [input: InfoEntrySaveInput, expectedProjectPath: string]
    return: { success: boolean; id?: string; revision?: number; conflict?: boolean; currentRevision?: number; knowledgeRecordsAffected?: number; error?: string }
  }
  'db:info-entry-delete': { args: [id: string, expectedProjectPath: string]; return: { success: boolean; deletedRecords?: number; error?: string } }
  'db:info-entry-truth-history': { args: [id: string, expectedProjectPath: string]; return: InfoTruthVersion[] }
  'db:knowledge-record-list': { args: [query: { infoId?: string; characterId?: string; chapterNumber?: number } | undefined, expectedProjectPath: string]; return: KnowledgeRecord[] }
  'db:knowledge-record-save': {
    args: [input: KnowledgeRecordSaveInput, expectedProjectPath: string]
    return: { success: boolean; id?: string; revision?: number; conflict?: boolean; currentRevision?: number; error?: string }
  }
  'db:knowledge-record-delete': { args: [id: string, expectedProjectPath: string]; return: { success: boolean; error?: string } }
  'db:character-action-list': { args: [query: { characterId?: string; chapterNumber?: number } | undefined, expectedProjectPath: string]; return: CharacterActionView[] }
  'db:character-action-save': {
    args: [input: CharacterActionSaveInput, expectedProjectPath: string]
    return: { success: boolean; id?: string; revision?: number; conflict?: boolean; currentRevision?: number; error?: string }
  }
  'db:character-action-delete': { args: [id: string, expectedProjectPath: string]; return: { success: boolean; error?: string } }
  'db:character-action-promote-to-timeline': {
    args: [id: string, characterName: string, expectedProjectPath: string]
    return: { success: boolean; eventId?: string; alreadyLinked?: boolean; error?: string }
  }
  'db:outline-sync-mark-pending': { args: [input: { chapterNumber: number; draftId: number; proseHash: string }, expectedProjectPath: string]; return: { success: boolean; error?: string } }
  'db:outline-sync-clear-pending': { args: [chapterNumber: number, expectedProjectPath: string]; return: { success: boolean; error?: string } }
  'db:outline-sync-list-pending': { args: [expectedProjectPath: string]; return: Array<{ chapterNumber: number; draftId: number; proseHash: string; markedAt: string }> }
  'db:outline-sync-create-candidate': {
    args: [input: OutlineSyncCreateCandidateInput, expectedProjectPath: string]
    return: { success: boolean; candidate?: OutlineSyncCandidate; rejectedItems?: Array<{ id: string; reason: string }>; error?: string }
  }
  'db:outline-sync-get-candidate': { args: [id: string, expectedProjectPath: string]; return: OutlineSyncCandidate | null }
  'db:outline-sync-list-candidates': { args: [query: { chapterNumber?: number; status?: OutlineSyncCandidateStatus } | undefined, expectedProjectPath: string]; return: OutlineSyncCandidate[] }
  'db:outline-sync-discard-candidate': { args: [id: string, expectedProjectPath: string]; return: { success: boolean; error?: string } }
  'db:outline-sync-commit': {
    args: [input: { candidateId: string; acceptedItemIds: string[] }, expectedProjectPath: string]
    return: { success: boolean; revision?: number; contentHash?: string; committed?: boolean; alreadyCommitted?: boolean; needsRecompare?: boolean; reason?: string; affected?: OutlineSyncAffected; error?: string }
  }
  'db:outline-sync-affected-preview': { args: [chapterNumber: number, expectedProjectPath: string]; return: OutlineSyncAffected }
  'db:knowledge-check-report-save': { args: [report: KnowledgeCheckReportInput, expectedProjectPath: string]; return: { success: boolean; report?: KnowledgeCheckReport; error?: string } }
  'db:knowledge-check-report-list': { args: [query: { kind?: KnowledgeCheckKind; scope?: string } | undefined, expectedProjectPath: string]; return: KnowledgeCheckReport[] }
  'db:knowledge-check-report-delete': { args: [id: string, expectedProjectPath: string]; return: { success: boolean; error?: string } }
  'db:thread-marker-link-list': { args: [query: { threadPlanId?: number; foreshadowingId?: string } | undefined, expectedProjectPath: string]; return: ThreadMarkerLink[] }
  'db:thread-marker-link': { args: [input: ThreadMarkerLinkInput, expectedProjectPath: string]; return: { success: boolean; link?: ThreadMarkerLink; error?: string } }
  'db:thread-marker-unlink': { args: [id: string, expectedProjectPath: string]; return: { success: boolean; error?: string } }
}

export interface WorldMapImageChannels {
  'world-map-image:get': {
    args: [mapId: string, expectedProjectPath: string]
    return: { success: boolean; image: WorldMapImage | null; dataUrl?: string; error?: string }
  }
  'world-map-image:select-and-import': {
    args: [mapId: string, expectedProjectPath: string]
    return: { success: boolean; cancelled?: boolean; image?: WorldMapImage; dataUrl?: string; error?: string }
  }
  'world-map-image:remove': {
    args: [mapId: string, expectedProjectPath: string]
    return: { success: boolean; error?: string }
  }
}

// ===== 知识库频道 =====
export interface KnowledgeBaseChannels {
  'kb:import-document': { args: [grantId: string, expectedProjectPath: string]; return: { success: boolean; docId?: string; chunkCount?: number; error?: string; errorCode?: AppErrorCode } }
  'kb:import-folder': { args: [grantId: string, expectedProjectPath: string]; return: { success: boolean; importedCount: number; failedFiles: string[]; error?: string; errorCode?: AppErrorCode } }
  'kb:import-text': { args: [text: string, fileName: string, expectedProjectPath: string]; return: { success: boolean; docId?: string; chunkCount?: number; error?: string; errorCode?: AppErrorCode } }
  'kb:import-planning-text': { args: [text: string, fileName: string, expectedProjectPath: string]; return: { success: boolean; docId?: string; chunkCount?: number; error?: string; errorCode?: AppErrorCode } }
  'kb:import-reference-text': {
    args: [
      chapterNumber: number,
      runId: string,
      executionAuthority: ImportRunExecutionAuthority,
    ]
    return: { success: boolean; docId?: string; chunkCount?: number; idempotent?: boolean; error?: string; errorCode?: AppErrorCode }
  }
  'kb:search': { args: [query: string, topK: number | undefined, expectedProjectPath: string]; return: AppResult<Array<{ text: string; score: number; fileName: string }>> }
  'kb:search-writing-context': { args: [query: string, topK: number | undefined, expectedProjectPath: string]; return: AppResult<Array<{ text: string; score: number; fileName: string }>> }
  'kb:search-with-scope': { args: [query: string, fromChapter: number, toChapter: number, topK: number | undefined, expectedProjectPath: string]; return: AppResult<Array<{ text: string; score: number; fileName: string }>> }
  'kb:list-documents': { args: [expectedProjectPath: string]; return: AppResult<Array<{ id: string; fileName: string; importedAt: string; chunkCount: number; filePath: string }>> }
  'kb:remove-document': { args: [docId: string, expectedProjectPath: string]; return: { success: boolean; error?: string } }
  'kb:clear-all': { args: [expectedProjectPath: string]; return: { success: boolean; error?: string } }
  'kb:stats': { args: [expectedProjectPath: string]; return: AppResult<{ documentCount: number; totalChunks: number; vectorDimension: number }> }
  'dialog:select-knowledge-files': { args: []; return: ExternalFileGrant[] | null }
  'dialog:select-knowledge-folder': { args: []; return: ExternalDirectoryGrant | null }
  'kb:get-vectorless-count': { args: [expectedProjectPath: string]; return: AppResult<{ count: number }> }
  /**
   * This is a local status read only. It never sends text to an embedding
   * provider; the renderer uses it to decide whether it may offer a rebuild.
   */
  'kb:get-vector-rebuild-status': {
    args: [expectedProjectPath: string]
    return: AppResult<{
      embeddingConfigured: boolean
      canRebuild: boolean
      totalChunks: number
      vectorlessCount: number
      activeVectorDimension: number
    }>
  }
  'kb:backfill-vectors': { args: [expectedProjectPath: string]; return: { success: boolean; processed: number; failed: number; error?: string; errorCode?: AppErrorCode } }
}

  // ===== 导入小说 =====
export interface ImportChannels {
  'dialog:select-novel-files': {
    args: [request?: ImportPurpose | ImportNovelFileSelectionRequest, projectSession?: ProjectSessionContext]
    return: {
      success: boolean
      inspection?: ImportInspectionSummary
      preparation?: ImportRunPreparationResult
      error?: string
    } | null
  }
  'dialog:select-chapter-markdown-files': {
    args: [projectSession: ProjectSessionContext]
    return: MarkdownChapterDraftInspection | { success: false; error: string } | null
  }
}

// ===== 章节生命周期 =====
export interface ChapterLifecycleChannels {
  'chapter:delete-finalized': {
    args: [request: DeleteFinalizedChapterRequest, expectedProjectPath: string]
    return: ChapterDeletionResult
  }
  'chapter:retry-deletion': {
    args: [operationId: string, expectedProjectPath: string]
    return: ChapterDeletionResult
  }
  'chapter:confirm-legacy-knowledge-absent': {
    args: [operationId: string, expectedProjectPath: string]
    return: ChapterDeletionResult
  }
  'chapter:list-incomplete-deletions': {
    args: [expectedProjectPath: string]
    return: { success: boolean; operations?: ChapterDeletionOperation[]; error?: string }
  }
}

// ===== MCP =====
export type MCPConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface MCPServerSummary {
  id: string
  name: string
  transport: 'stdio' | 'sse'
}

export interface MCPServerStatus {
  id: string
  name: string
  status: MCPConnectionStatus
  toolCount: number
  error?: string
}

export interface MCPToolDescription {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  serverId: string
}

export interface MCPResourceDescription {
  uri: string
  name: string
  description?: string
  mimeType?: string
  serverId: string
}

export type MCPConfigLoadResult =
  | { status: 'missing'; servers: [] }
  | { status: 'loaded'; servers: MCPServerSummary[] }
  | { status: 'error'; servers: []; error: string }

export type MCPConfigLoadResponse =
  | ({ status: 'missing'; servers: [] } & { success: true })
  | ({ status: 'loaded'; servers: MCPServerSummary[] } & { success: true })
  | ({ status: 'error'; servers: []; error: string } & { success: false })

export interface MCPChannels {
  'mcp:load-config': { args: []; return: MCPConfigLoadResponse }
  'mcp:connect': { args: [serverId: string]; return: { success: boolean; error?: string } }
  'mcp:disconnect': { args: [serverId: string]; return: { success: boolean; error?: string } }
  'mcp:disconnect-all': { args: []; return: { success: boolean; error?: string } }
  'mcp:list-tools': { args: []; return: MCPToolDescription[] }
  'mcp:list-resources': { args: []; return: MCPResourceDescription[] }
  'mcp:call-tool': { args: [serverId: string, toolName: string, args: Record<string, unknown>]; return: { success: boolean; content: string; error?: string } }
  'mcp:get-servers-status': { args: []; return: MCPServerStatus[] }
  'mcp:get-config-path': { args: []; return: string }
}

// ===== 创作资料中枢 =====
export interface WorkspaceHubChannels {
  'workspace:get-status': {
    args: [expectedProjectPath?: string]
    return: WorkspaceHubStatus
  }
  'workspace:select-directory': {
    args: [expectedProjectPath?: string]
    return: { grantId: string; displayName: string } | null
  }
  'workspace:bind-directory': {
    args: [grantId: string, expectedProjectPath?: string]
    return: { success: boolean; scannedCount?: number; recognizedCount?: number; error?: string }
  }
  'workspace:unbind-directory': {
    args: [expectedProjectPath?: string]
    return: { success: boolean; error?: string }
  }
  'workspace:scan': {
    args: [taskId?: string, expectedProjectPath?: string]
    return: { success: boolean; scannedCount: number; recognizedCount: number; error?: string }
  }
  'workspace:cancel-scan': {
    args: [taskId?: string, expectedProjectPath?: string]
    return: { success: boolean; error?: string }
  }
  'workspace:approve-source': {
    args: [sourceId: string, expectedProjectPath?: string]
    return: { success: boolean; error?: string }
  }
  'workspace:approve-all-sources': {
    args: [expectedProjectPath?: string]
    return: { success: boolean; count: number; error?: string }
  }
  'workspace:list-sources': {
    args: [expectedProjectPath?: string]
    return: WorkspaceSource[]
  }
  'workspace:get-source-detail': {
    args: [
      sourceId: string,
      snapshotId?: string | null,
      fragmentId?: string | null,
      expectedProjectPath?: string,
    ]
    return: {
      source: WorkspaceSource | null
      fragments: WorkspaceSourceFragment[]
      targetSnapshotId?: string | null
      provenanceStatus?: 'found' | 'provenance-missing'
    }
  }
  'workspace:list-rules': {
    args: [status?: SettingRuleStatus, expectedProjectPath?: string]
    return: SettingRule[]
  }
  'workspace:upsert-rule': {
    args: [rule: SettingRule, expectedProjectPath?: string]
    return: { success: boolean; error?: string }
  }
  'workspace:update-rule-status': {
    args: [ruleId: string, status: SettingRuleStatus, expectedProjectPath?: string]
    return: { success: boolean; error?: string }
  }
  'workspace:delete-rule': {
    args: [ruleId: string, expectedProjectPath?: string]
    return: { success: boolean; error?: string }
  }
  'workspace:list-candidates': {
    args: [candidateType?: WorkspaceImportCandidateType, status?: WorkspaceImportCandidateStatus, expectedProjectPath?: string]
    return: WorkspaceImportCandidate[]
  }
  'workspace:action-candidate': {
    args: [candidateId: string, action: 'approve' | 'reject', expectedProjectPath?: string]
    return: { success: boolean; error?: string }
  }
  'workspace:assemble-chapter-context': {
    args: [chapterNumber: number, budgetChars?: number, includeCandidates?: boolean, expectedProjectPath?: string]
    return: ChapterContextBundle
  }
  'workspace:save-chapter-context-snapshot': {
    args: [snapshot: ChapterContextSnapshot, expectedProjectPath?: string]
    return: { success: boolean; snapshotId?: string; error?: string }
  }
}

// ===== 第二阶段故事资料管理中心 =====
export interface AgentProposalCommitReceipt {
  proposalId: string
  projectId: string
  resource: 'blueprint' | 'draft'
  chapterNumber?: number
  draftId?: number
  revision: string
  wordCount?: number
  committedAt: string
}

export interface AgentProposalCommitEvent {
  proposalId: string
  projectId: string
  proposalType: string
  receipt: AgentProposalCommitReceipt | null
  projectPath: string
  projectSession: ProjectSessionContext
}

export interface StoryDataEventChannels {
  'story-data:agent-proposal-committed': AgentProposalCommitEvent
}

export interface AgentProposalReview {
  proposalId: string
  projectId: string
  proposalType: string
  status: 'pending'
  baseRevision: string
  createdAt: string
  approvable: boolean
  payload: Record<string, unknown>
}

export interface StoryDataChannels {
  'story-data:list-agent-proposals': {
    args: [expectedProjectPath?: string]
    return: AgentProposalReview[]
  }
  'story-data:reject-agent-proposal': {
    args: [proposalId: string, expectedProjectPath?: string]
    return: { success: boolean; error?: string }
  }
  'story-data:persist-proposal': {
    args: [proposal: StoryChangeProposal, expectedProjectPath?: string]
    return: StoryFactCandidate[] | { success: false; error: string }
  }
  'story-data:create-candidate': {
    args: [input: StoryFactCandidateInput, expectedProjectPath?: string]
    return: StoryFactCandidate | { success: false; error: string }
  }
  /** Candidate-only extraction from immutable finalized author prose. */
  'story-data:extract-finalized-draft': {
    args: [draftId: number, expectedProjectPath?: string]
    return: StoryFactCandidate[] | { success: false; error: string }
  }
  'story-data:list-candidates': {
    args: [entityType?: StoryEntityType, reviewStatus?: StoryCandidateReviewStatus, expectedProjectPath?: string]
    return: StoryFactCandidate[]
  }
  'story-data:list-facts': {
    args: [status?: StoryRecordStatus, entityType?: StoryEntityType, expectedProjectPath?: string]
    return: StoryFact[]
  }
  'story-data:list-versions': {
    args: [factId: string, expectedProjectPath?: string]
    return: StoryFactVersion[]
  }
  'story-data:commit-fact-version': {
    args: [input: StoryFactVersionCommitInput, expectedProjectPath?: string]
    return: StoryFactVersion | { success: false; error: string }
  }
  'story-data:list-relations': {
    args: [factId?: string, expectedProjectPath?: string]
    return: StoryFactRelation[]
  }
  'story-data:add-relation': {
    args: [input: StoryFactRelationInput, expectedProjectPath?: string]
    return: StoryFactRelation | { success: false; error: string }
  }
  'story-data:list-impacts': {
    args: [factId?: string, expectedProjectPath?: string]
    return: StoryFactImpact[]
  }
  'story-data:approve-candidate': {
    args: [request: StoryDataApprovalRequest, expectedProjectPath?: string]
    return: StoryDataApprovalResult
  }
  'story-data:reject-candidate': {
    args: [candidateId: string, expectedProjectPath?: string]
    return: { success: boolean; error?: string }
  }
  'story-data:approve-agent-proposal': {
    args: [proposalId: string, approvedBy: string, expectedProjectPath?: string]
    return: { success: boolean; proposalId?: string; error?: string }
  }
}

export interface RevisionLearningChannels {
  'revision-learning:list-source-drafts': { args: []; return: RevisionLearningSourceDraft[] }
  'revision-learning:list': { args: []; return: RevisionLearningRecordSummary[] }
  'revision-learning:get': { args: [recordId: string]; return: RevisionLearningRecord }
  'revision-learning:create-from-versions': { args: [input: RevisionLearningCreateFromVersionsInput]; return: RevisionLearningRecord }
  'revision-learning:record-editor-before': { args: [input: RevisionLearningEditorSnapshotInput]; return: RevisionLearningRecord }
  'revision-learning:capture-after': { args: [input: RevisionLearningAfterSnapshotInput]; return: RevisionLearningRecord }
  'revision-learning:reverse-sample': { args: [recordId: string, expectedRevision: number]; return: RevisionLearningRecord }
  'revision-learning:save-input': { args: [input: RevisionLearningSaveInput]; return: RevisionLearningRecord }
  'revision-learning:attempt-begin': { args: [input: RevisionLearningAttemptStartInput]; return: RevisionLearningAttempt }
  'revision-learning:attempt-finish': { args: [input: RevisionLearningAttemptFinishInput]; return: RevisionLearningAttempt }
  'revision-learning:review-save': { args: [input: RevisionLearningReviewSaveInput]; return: RevisionLearningRecord }
  'revision-learning:review-confirm': { args: [input: RevisionLearningReviewConfirmInput]; return: RevisionLearningRecord }
  'revision-learning:publish': {
    args: [input: RevisionLearningPublishInput]
    return: { receipt: RevisionLearningPublishReceipt; recovered: boolean }
  }
  'revision-learning:bind': {
    args: [input: RevisionLearningBindInput]
    return: { bound: boolean; conflict: boolean; currentSkillId: string | null }
  }
  'revision-learning:publication-status': { args: [recordId: string]; return: RevisionLearningPublicationStatus }
  'revision-learning:binding-cas': {
    args: [input: RevisionLearningBindingCasInput]
    return: { success: boolean; conflict?: boolean; currentSkillId?: string | null; error?: string }
  }
}

// ===== 合并所有频道 =====
export type AllInvokeChannels = WindowChannels & OfficialHomepageChannels & ModelProviderResourceChannels & ConfigChannels & UpdateChannels & SkinChannels & ProjectChannels & FileChannels & AppDataChannels & LLMChannels & DatabaseChannels & WorldMapImageChannels & KnowledgeBaseChannels & ProjectDocumentChannels & ChapterLifecycleChannels & ImportChannels & MCPChannels & WorkspaceHubChannels & StoryDataChannels & RevisionLearningChannels & Phase38Channels & FinalizationChannels
export type AllEventChannels = LLMStreamEvents & UpdateStateEvents & WindowEvents & StoryDataEventChannels

/** 提取 invoke 频道名 */
export type InvokeChannel = keyof AllInvokeChannels

/** 提取 event 频道名 */
export type EventChannel = keyof AllEventChannels
