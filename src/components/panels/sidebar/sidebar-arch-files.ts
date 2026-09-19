/**
 * 故事架构的 Markdown 专属文档。
 *
 * 角色不在其中：角色档案是唯一的角色入口与事实来源，角色图谱只是它的只读投影。
 * 这里只保留作者可以直接编写的三个架构文档。
 */
export interface ArchFile {
  key: string
  fileName: string
  label: string
  iconName: string
  desc: string
}

export const ARCH_FILES: ArchFile[] = [
  { key: 'premise', fileName: 'premise.md', label: '故事前提', iconName: 'target', desc: 'Logline、核心冲突、金手指定位' },
  { key: 'worldbuilding', fileName: 'worldbuilding.md', label: '世界观', iconName: 'globe', desc: '核心规则、阶层断层、深层危机' },
  { key: 'synopsis', fileName: 'synopsis.md', label: '情节大纲', iconName: 'map', desc: '全书计划与章节推进节奏' },
]
