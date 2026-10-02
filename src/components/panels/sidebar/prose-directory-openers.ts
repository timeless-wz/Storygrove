import { useEditorStore } from '../../../stores/editor-store'
import { useProjectStore } from '../../../stores/project-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { captureProjectSession } from '../../project-session-gate'

export function openProseDirectory(kind: 'draft' | 'manuscript') {
  const session = captureProjectSession(useProjectStore.getState().currentProject)
  if (!session) return
  const text = useLocaleStore.getState().text
  useEditorStore.getState().openFile({
    id: `prose-directory:${session.projectId}:${session.leaseId}:${kind}`,
    name: kind === 'draft' ? text('草稿箱', 'Draft box') : text('正文章节', 'Manuscript chapters'),
    type: 'chapter-directory', proseDirectoryKind: kind,
    projectKey: session.projectPath, projectSessionLease: session.leaseId,
  })
}
