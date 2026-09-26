/**
 * 知识库页面的收录范围与来源跳转判定。
 *
 * 本模块只做纯计算：它读的是知识库真实返回的文档元数据与检索命中字段，
 * 不产生任何内容，也不假装知道索引以外的来源。
 *
 * 两个必须诚实的地方：
 *   1. 收录范围：只有作者导入的语料与定稿章节语料在库里，项目内的数据库对象
 *      （蓝图、大纲、角色档案）不会自动进入检索；
 *   2. 来源跳转：只有应用自己登记为「项目文档索引」的名称才能打开真实文档，
 *      其余命中只能显示索引名与章节/行范围，不能给一个点了没反应的按钮。
 */

import { projectDocumentKnowledgeName } from '../../shared/project-documents'
import type { KBDocument, SearchResult } from '../../services/knowledge-service'

export interface KnowledgeScopeLabel {
  zh: string
  en: string
}

/** 知识语料的真实分类，与 electron/vector-store.ts 的 KnowledgeCorpusKind 对应。 */
export type KnowledgeCorpusKind = 'reference' | 'project-knowledge' | 'unknown'

export const KNOWLEDGE_CORPUS_LABELS: Record<KnowledgeCorpusKind, KnowledgeScopeLabel> = {
  'project-knowledge': { zh: '项目语料', en: 'Project corpus' },
  reference: { zh: '参考素材', en: 'Reference material' },
  unknown: { zh: '未标记来源', en: 'Unlabeled' },
}

/** `corpusKind` 由主进程写入，渲染进程的类型里没有它，因此按运行时值收窄。 */
export function readCorpusKind(doc: KBDocument): KnowledgeCorpusKind {
  const raw = (doc as KBDocument & { corpusKind?: unknown }).corpusKind
  return raw === 'reference' || raw === 'project-knowledge' ? raw : 'unknown'
}

export interface KnowledgeCorpusSummary {
  projectKnowledge: number
  reference: number
  unknown: number
  total: number
}

export function summarizeCorpus(documents: readonly KBDocument[]): KnowledgeCorpusSummary {
  const summary: KnowledgeCorpusSummary = { projectKnowledge: 0, reference: 0, unknown: 0, total: documents.length }
  for (const doc of documents) {
    const kind = readCorpusKind(doc)
    if (kind === 'project-knowledge') summary.projectKnowledge += 1
    else if (kind === 'reference') summary.reference += 1
    else summary.unknown += 1
  }
  return summary
}

/**
 * 收录范围说明。
 *
 * 三条入库路径都对应真实入口；未收录部分写明原因，避免作者以为
 * 检索覆盖了整个项目。
 */
export const KNOWLEDGE_INCLUSION_PATHS: readonly { label: KnowledgeScopeLabel; detail: KnowledgeScopeLabel }[] = [
  {
    label: { zh: '定稿章节正文', en: 'Finalized chapter prose' },
    detail: {
      zh: '章节定稿后由定稿流程自动切块入库，无需手动操作。',
      en: 'Indexed automatically by the finalization flow once a chapter is finalized.',
    },
  },
  {
    label: { zh: '作者导入的创作资料', en: 'Author-imported planning material' },
    detail: {
      zh: '通过本页「导入创作资料」显式选择文件后入库。',
      en: 'Added only when you explicitly pick files with “Import planning material” on this page.',
    },
  },
  {
    label: { zh: '作者加入知识检索的项目文档', en: 'Project documents you added to retrieval' },
    detail: {
      zh: '在项目文档列表中逐个开启「加入知识检索」后入库。',
      en: 'Added per document after you enable “Add to knowledge retrieval” in the project document list.',
    },
  },
]

export const KNOWLEDGE_EXCLUSIONS: readonly KnowledgeScopeLabel[] = [
  {
    zh: '蓝图、大纲、角色档案等数据库对象不会自动进入检索：它们由故事资料中心与各自编辑器维护。',
    en: 'Blueprints, outlines, and character profiles are never indexed automatically; they live in the story data center and their own editors.',
  },
  {
    zh: '参考素材语料可以在此检索，但被排除在正文生成的检索上下文之外。',
    en: 'Reference material is searchable here but excluded from the retrieval context used while generating prose.',
  },
]

/**
 * 检索命中的附加字段。
 *
 * 主进程返回的命中还带有 docId、章节号与行范围；这些字段是「来源跳转」
 * 的唯一依据，缺失时一律按未知处理。
 */
export interface KnowledgeHitScope {
  docId: string | null
  chapterNumber: number | null
  startLine: number | null
  endLine: number | null
  sourceSnapshotId: string | null
  authorityStatus: string | null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function readHitScope(hit: SearchResult): KnowledgeHitScope {
  const raw = hit as SearchResult & Record<string, unknown>
  return {
    docId: asString(raw.docId),
    chapterNumber: asNumber(raw.chapterNumber),
    startLine: asNumber(raw.startLine),
    endLine: asNumber(raw.endLine),
    sourceSnapshotId: asString(raw.sourceSnapshotId),
    authorityStatus: asString(raw.authorityStatus),
  }
}

export type KnowledgeJumpTarget =
  | { kind: 'project-document'; documentPath: string; documentName: string }
  | { kind: 'chapter-context'; chapterNumber: number }
  | { kind: 'none'; reason: 'reference-material' | 'not-a-project-document' | 'not-indexed' }

/**
 * 判定一次命中能跳到哪里。
 *
 * `projectDocumentPaths` 是当前项目真实存在的自由文档路径（docs:list 的结果）。
 * 只有命中的索引名同时出现在这份清单里，才说明它是一份可打开的项目文档；
 * 否则退化为章节装配包定位，或明确告知无法跳转——不给点了没反应的按钮。
 */
export function resolveJumpTarget(
  hit: SearchResult,
  documents: readonly KBDocument[],
  projectDocumentPaths: ReadonlySet<string>,
): KnowledgeJumpTarget {
  const scope = readHitScope(hit)
  const doc = scope.docId
    ? documents.find(candidate => candidate.id === scope.docId)
    : documents.find(candidate => candidate.fileName === hit.fileName)

  if (doc && readCorpusKind(doc) === 'reference') return { kind: 'none', reason: 'reference-material' }

  if (doc && projectDocumentPaths.has(doc.fileName)) {
    const documentPath = projectDocumentKnowledgeName(doc.fileName)
    if (documentPath) {
      return { kind: 'project-document', documentPath, documentName: doc.fileName }
    }
  }

  if (doc && scope.chapterNumber !== null && Number.isInteger(scope.chapterNumber) && scope.chapterNumber > 0) {
    return { kind: 'chapter-context', chapterNumber: scope.chapterNumber }
  }
  return { kind: 'none', reason: doc ? 'not-a-project-document' : 'not-indexed' }
}

/** 命中相关性档位：0.5 是全文检索命中，其余按相似度展示。 */
export function isFullTextHit(score: number): boolean {
  return score === 0.5
}
