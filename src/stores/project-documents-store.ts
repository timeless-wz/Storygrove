/**
 * project-documents-store — 项目自由 Markdown 文档的渲染进程状态
 *
 * 数据严格绑定当前项目：切换项目后列表与检索状态立即失效，
 * 旧项目的响应不会写入新项目。加入知识检索只能由作者显式触发。
 */

import { create } from 'zustand'

import type { ProjectDocumentEntry } from '../shared/project-documents'
import type { ProjectSessionContext } from '../shared/ipc-channels'
import { isProjectSessionCurrent } from '../components/project-session-gate'
import {
  addProjectDocumentToKnowledge,
  loadProjectKnowledgeIndex,
  removeProjectDocumentFromKnowledge,
} from '../services/knowledge-service'
import { listProjectDocuments } from '../services/project-documents-service'

export interface ProjectKnowledgeIndexEntry {
  docId: string
  /** 知识检索里代表该文档的索引名称（受控目录内的相对路径）。 */
  fileName: string
}

interface ProjectDocumentsState {
  documents: ProjectDocumentEntry[]
  /** 列表数据所属项目路径；与当前项目不一致时列表视为不可用。 */
  dataProjectKey: string | null
  loading: boolean
  loadingProjectKey: string | null
  lastError: string | null
  /**
   * 知识检索状态：键是受控目录内的文档相对路径（`卷一/设定.md`）。
   * 因此不同目录下的同名文档各自独立，互不覆盖。
   */
  knowledgeIndex: Record<string, ProjectKnowledgeIndexEntry>
  knowledgeLoading: boolean
  /** 正在执行“加入/移出知识检索”的文档路径。 */
  knowledgeBusyDocumentPath: string | null
  knowledgeError: string | null

  load: (projectSession: ProjectSessionContext) => Promise<void>
  loadKnowledgeIndex: (projectSession: ProjectSessionContext) => Promise<void>
  addToKnowledge: (
    projectSession: ProjectSessionContext,
    documentPath: string,
    content: string,
  ) => Promise<{ success: boolean; error?: string }>
  removeFromKnowledge: (
    projectSession: ProjectSessionContext,
    documentPath: string,
  ) => Promise<{ success: boolean; error?: string }>
}

export const useProjectDocumentsStore = create<ProjectDocumentsState>()((set, get) => ({
  documents: [],
  dataProjectKey: null,
  loading: false,
  loadingProjectKey: null,
  lastError: null,
  knowledgeIndex: {},
  knowledgeLoading: false,
  knowledgeBusyDocumentPath: null,
  knowledgeError: null,

  load: async (projectSession) => {
    const projectKey = projectSession.projectPath
    set({ loading: true, loadingProjectKey: projectKey, lastError: null })
    try {
      const result = await listProjectDocuments(projectSession)
      if (!isProjectSessionCurrent(projectSession)) return
      if (!result.success) {
        set({
          documents: [],
          dataProjectKey: projectKey,
          loading: false,
          loadingProjectKey: null,
          lastError: result.error ?? null,
        })
        return
      }
      set({
        documents: result.documents,
        dataProjectKey: projectKey,
        loading: false,
        loadingProjectKey: null,
        lastError: null,
      })
    } catch (error) {
      if (!isProjectSessionCurrent(projectSession)) return
      set({
        documents: [],
        dataProjectKey: projectKey,
        loading: false,
        loadingProjectKey: null,
        lastError: error instanceof Error ? error.message : String(error),
      })
    }
  },

  loadKnowledgeIndex: async (projectSession) => {
    set({ knowledgeLoading: true, knowledgeError: null })
    try {
      const index = await loadProjectKnowledgeIndex(projectSession)
      if (!isProjectSessionCurrent(projectSession)) return
      set({ knowledgeIndex: index, knowledgeLoading: false })
    } catch (error) {
      if (!isProjectSessionCurrent(projectSession)) return
      set({
        knowledgeIndex: {},
        knowledgeLoading: false,
        knowledgeError: error instanceof Error ? error.message : String(error),
      })
    }
  },

  addToKnowledge: async (projectSession, documentPath, content) => {
    set({ knowledgeBusyDocumentPath: documentPath, knowledgeError: null })
    try {
      const result = await addProjectDocumentToKnowledge(projectSession, documentPath, content)
      if (!isProjectSessionCurrent(projectSession)) return { success: false }
      if (!result.success) {
        set({ knowledgeBusyDocumentPath: null, knowledgeError: result.error ?? null })
        return { success: false, error: result.error }
      }
      set(state => ({
        knowledgeBusyDocumentPath: null,
        knowledgeIndex: {
          ...state.knowledgeIndex,
          [documentPath]: {
            docId: result.docId ?? '',
            fileName: state.knowledgeIndex[documentPath]?.fileName ?? documentPath,
          },
        },
      }))
      return { success: true }
    } catch (error) {
      if (!isProjectSessionCurrent(projectSession)) return { success: false }
      const message = error instanceof Error ? error.message : String(error)
      set({ knowledgeBusyDocumentPath: null, knowledgeError: message })
      return { success: false, error: message }
    }
  },

  removeFromKnowledge: async (projectSession, documentPath) => {
    const entry = get().knowledgeIndex[documentPath]
    if (!entry?.docId) return { success: false, error: 'document-not-indexed' }
    set({ knowledgeBusyDocumentPath: documentPath, knowledgeError: null })
    try {
      const result = await removeProjectDocumentFromKnowledge(projectSession, entry.docId)
      if (!isProjectSessionCurrent(projectSession)) return { success: false }
      if (!result.success) {
        set({ knowledgeBusyDocumentPath: null, knowledgeError: result.error ?? null })
        return { success: false, error: result.error }
      }
      set(state => {
        const next = { ...state.knowledgeIndex }
        delete next[documentPath]
        return { knowledgeBusyDocumentPath: null, knowledgeIndex: next }
      })
      return { success: true }
    } catch (error) {
      if (!isProjectSessionCurrent(projectSession)) return { success: false }
      const message = error instanceof Error ? error.message : String(error)
      set({ knowledgeBusyDocumentPath: null, knowledgeError: message })
      return { success: false, error: message }
    }
  },
}))
