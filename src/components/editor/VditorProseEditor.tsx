/**
 * VditorProseEditor — 正文写作页的 Vditor 包装组件
 *
 * 设计约束：
 * - Vditor 的运行时资源（Lute 解析器、中文语言包、图标、代码高亮、内容主题）
 *   随仓库发布在 public/vditor/dist 下，`cdn` 必须指向这个本地目录；
 *   编辑器因此不会请求任何第三方地址。
 * - 不接入任何上传服务：图片按钮走本地 handler，只给出“待接入”提示。
 * - 字数统计沿用项目既有的 countDraftUnits，不使用 Vditor 自带的计数器口径。
 * - 组件是受控的：外部 content 真正变化时才调用 setValue，
 *   避免作者输入过程中被回写重置光标、滚动位置与撤销栈。
 */

import { useCallback, useEffect, useRef } from 'react'

import Vditor from 'vditor'
import 'vditor/dist/index.css'
import './vditor-prose.css'

import { countDraftUnits } from '../../shared/draft-units'
import { useLocaleStore } from '../../stores/locale-store'

/**
 * 本地资源根目录。构建产物用 `./` 前缀（file:// 加载），
 * 浏览器测试与开发服务器用 `/` 前缀，两者都能解析到 public/vditor。
 */
const VDITOR_ASSET_BASE = `${import.meta.env.BASE_URL}vditor`

/**
 * 小说创作用的工具栏：只保留写作相关动作。
 * 顺序为 撤销、重做、标题、粗体、斜体、删除线、引用、列表、
 * 任务列表、链接、图片、分割线、代码、目录、全屏、编辑模式切换。
 */
const VDITOR_TOOLBAR: string[] = [
  'undo',
  'redo',
  '|',
  'headings',
  'bold',
  'italic',
  'strike',
  'quote',
  '|',
  'list',
  'ordered-list',
  'check',
  '|',
  'link',
  'upload',
  'line',
  'code',
  '|',
  'outline',
  'fullscreen',
  'edit-mode',
]

/** 解除编辑模式切换按钮的禁用状态，允许作者切换 IR / 分屏预览 / 所见即所得。 */
function unblockEditModeMenu(host: HTMLElement): void {
  const editModeBtn = host.querySelector<HTMLButtonElement>(
    '.vditor-toolbar button[data-type="edit-mode"]',
  ) ?? host.querySelector<HTMLButtonElement>(
    '.vditor-toolbar button[data-mode]',
  )?.closest('.vditor-toolbar__item')?.firstElementChild as HTMLButtonElement | null
  if (editModeBtn) {
    editModeBtn.classList.remove('vditor-menu--disabled')
    editModeBtn.removeAttribute('disabled')
  }
}

/** 只读状态下加固：正文各模式严格不可写，改写类工具栏禁用，但保留模式切换。 */
function enforceReadOnlyState(host: HTMLElement, vditor: Vditor): void {
  vditor.disabled()
  unblockEditModeMenu(host)

  // 严格确保三种编辑模式下的元素都处于只读/禁用状态
  const irPre = host.querySelector<HTMLElement>('.vditor-ir pre.vditor-reset')
  if (irPre) irPre.setAttribute('contenteditable', 'false')

  const wysiwygPre = host.querySelector<HTMLElement>('.vditor-wysiwyg pre.vditor-reset')
  if (wysiwygPre) wysiwygPre.setAttribute('contenteditable', 'false')

  const svTextarea = host.querySelector<HTMLTextAreaElement>('textarea.vditor-sv')
  if (svTextarea) {
    svTextarea.disabled = true
    svTextarea.setAttribute('readonly', 'true')
  }
}

export interface VditorProseEditorProps {
  content: string
  editable: boolean
  placeholder?: string
  onChange: (markdown: string) => void
  onSave?: (markdown: string) => void
  onCharCountChange?: (count: number) => void
}

export default function VditorProseEditor({
  content,
  editable,
  placeholder,
  onChange,
  onSave,
  onCharCountChange,
}: VditorProseEditorProps) {
  const text = useLocaleStore(s => s.text)
  const hostRef = useRef<HTMLDivElement>(null)
  const vditorRef = useRef<Vditor | null>(null)
  /** 编辑器当前内容（含作者刚输入的值），用于判断外部内容是否真的变了。 */
  const syncedContentRef = useRef(content)
  /** 最近一次收到的 content prop；初始化期间的变化也要在就绪后补上。 */
  const pendingContentRef = useRef(content)
  const readyRef = useRef(false)

  // 回调放进 ref：编辑器只创建一次，父组件重渲染不应重建实例。
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const onCharCountRef = useRef(onCharCountChange)
  const editableRef = useRef(editable)
  const placeholderTextRef = useRef(placeholder)
  const uploadNoticeRef = useRef('')
  useEffect(() => {
    onChangeRef.current = onChange
    onSaveRef.current = onSave
    onCharCountRef.current = onCharCountChange
    editableRef.current = editable
    placeholderTextRef.current = placeholder
    uploadNoticeRef.current = text('图片导入功能待接入', 'Image import is not connected yet')
  })

  /** 把编辑器内容上报给外层；相同的值不会重复上报。 */
  const emitInput = useCallback((markdown: string) => {
    if (markdown === syncedContentRef.current) return
    syncedContentRef.current = markdown
    onCharCountRef.current?.(countDraftUnits(markdown))
    onChangeRef.current(markdown)
  }, [])

  /** 外部内容变化：只有确实不同才写回编辑器。 */
  const applyExternalContent = useCallback(() => {
    const vditor = vditorRef.current
    if (!vditor || !readyRef.current) return
    const next = pendingContentRef.current
    if (next === syncedContentRef.current) return
    syncedContentRef.current = next
    // setValue 不触发 input 回调，因此不会把外部写入当成作者输入再抛回去。
    vditor.setValue(next)
    onCharCountRef.current?.(countDraftUnits(next))
  }, [])

  /** 只读时除 Vditor 自带的 disabled() 外，再拦住输入、粘贴与拖放，但放行模式切换。 */
  const applyEditableState = useCallback(() => {
    const vditor = vditorRef.current
    const host = hostRef.current
    if (!vditor || !readyRef.current || !host) return
    if (editableRef.current) {
      vditor.enable()
    } else {
      enforceReadOnlyState(host, vditor)
    }
  }, [])

  // 创建编辑器：只在挂载时执行一次。
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    readyRef.current = false
    syncedContentRef.current = pendingContentRef.current
    const vditor = new Vditor(host, {
      // 本地资源目录，绝不指向公网 CDN。
      cdn: VDITOR_ASSET_BASE,
      lang: 'zh_CN',
      // 默认即时渲染（IR）；工具栏的 edit-mode 仍可切到所见即所得与分屏预览。
      mode: 'ir',
      value: pendingContentRef.current,
      height: '100%',
      placeholder: placeholderTextRef.current ?? '',
      // 章节草稿以数据库与编辑器 store 为准，不使用 Vditor 的 localStorage 缓存。
      cache: { enable: false },
      // 字数与目标统一走 countDraftUnits，关闭 Vditor 自带计数器。
      counter: { enable: false },
      toolbar: VDITOR_TOOLBAR,
      preview: {
        // 正文最大宽度约 800px。
        maxWidth: 800,
      },
      upload: {
        // 没有任何远程上传地址：图片按钮只提示本地素材管理尚未接入。
        accept: 'image/*',
        multiple: false,
        handler: () => uploadNoticeRef.current,
      },
      input: (markdown: string) => {
        if (vditorRef.current !== vditor) return
        emitInput(markdown)
      },
      after: () => {
        if (vditorRef.current !== vditor) return
        readyRef.current = true
        host.setAttribute('data-vditor-ready', 'true')
        // 初始化期间到达的外部内容在这里补写。
        applyExternalContent()
        onCharCountRef.current?.(countDraftUnits(vditor.getValue()))
        applyEditableState()
      },
    })
    vditorRef.current = vditor
    return () => {
      vditorRef.current = null
      readyRef.current = false
      host.removeAttribute('data-vditor-ready')
      vditor.destroy()
    }
  }, [applyEditableState, applyExternalContent, emitInput])

  // 外部内容更新（打开其他章节、保存后归一化、AI 写回）。
  useEffect(() => {
    pendingContentRef.current = content
    applyExternalContent()
  }, [applyExternalContent, content])

  // 只读状态切换。
  useEffect(() => {
    applyEditableState()
  }, [applyEditableState, editable])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return
      event.preventDefault()
      const vditor = vditorRef.current
      onSaveRef.current?.(vditor ? vditor.getValue() : pendingContentRef.current)
    }
    const blockWhileReadonly = (event: Event) => {
      if (editableRef.current) return
      event.preventDefault()
      event.stopPropagation()
    }

    const handleModeSwitchClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      const modeBtn = target?.closest('.vditor-toolbar button[data-mode]')
      if (modeBtn && !editableRef.current) {
        queueMicrotask(() => {
          if (!editableRef.current && vditorRef.current && hostRef.current) {
            enforceReadOnlyState(hostRef.current, vditorRef.current)
          }
        })
        setTimeout(() => {
          if (!editableRef.current && vditorRef.current && hostRef.current) {
            enforceReadOnlyState(hostRef.current, vditorRef.current)
          }
        }, 0)
      }
    }

    let isApplying = false
    const observer = new MutationObserver(() => {
      if (isApplying || editableRef.current || !readyRef.current) return
      const vditor = vditorRef.current
      if (!vditor) return
      const irEditable = host.querySelector('.vditor-ir:not([style*="display: none"]) pre[contenteditable="true"]')
      const wysiwygEditable = host.querySelector('.vditor-wysiwyg:not([style*="display: none"]) pre[contenteditable="true"]')
      const svEditable = host.querySelector('textarea.vditor-sv:not([style*="display: none"]):not(:disabled)')
      const editButtonsEnabled = host.querySelector(
        '.vditor-toolbar button[data-type="bold"]:not(.vditor-menu--disabled)',
      )
      if (irEditable || wysiwygEditable || svEditable || editButtonsEnabled) {
        isApplying = true
        try {
          enforceReadOnlyState(host, vditor)
        } finally {
          isApplying = false
        }
      }
    })
    observer.observe(host, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'contenteditable', 'disabled'],
    })

    host.addEventListener('click', handleModeSwitchClick, true)
    host.addEventListener('keydown', handleKeyDown, true)
    host.addEventListener('beforeinput', blockWhileReadonly, true)
    host.addEventListener('paste', blockWhileReadonly, true)
    host.addEventListener('drop', blockWhileReadonly, true)
    return () => {
      observer.disconnect()
      host.removeEventListener('click', handleModeSwitchClick, true)
      host.removeEventListener('keydown', handleKeyDown, true)
      host.removeEventListener('beforeinput', blockWhileReadonly, true)
      host.removeEventListener('paste', blockWhileReadonly, true)
      host.removeEventListener('drop', blockWhileReadonly, true)
    }
  }, [])

  return <div ref={hostRef} className="vditor-prose-host h-full min-h-0" data-vditor-prose-editor="true" />
}

export { VDITOR_ASSET_BASE, VDITOR_TOOLBAR }
