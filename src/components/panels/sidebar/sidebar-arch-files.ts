/**
 * 保持在项目核心资料中的三份 Markdown 设定文档。
 *
 * 角色不在其中：角色档案是唯一的角色入口与事实来源，角色图谱只是它的只读投影。
 * 这里只保留作者可以直接编写的三个架构文档。
 */
export interface ArchFile {
  key: string
  fileName: string
  label: string
  labelEn: string
  iconName: string
  desc: string
  descEn: string
}

export const ARCH_FILES: ArchFile[] = [
  {
    key: 'premise',
    fileName: 'premise.md',
    label: '故事前提',
    labelEn: 'Story premise',
    iconName: 'target',
    desc: 'Logline、核心冲突、主角优势与故事卖点',
    descEn: 'Logline, core conflict, protagonist advantage, and story hook',
  },
  {
    key: 'worldbuilding',
    fileName: 'worldbuilding.md',
    label: '世界观总纲',
    labelEn: 'Worldbuilding overview',
    iconName: 'globe',
    desc: '世界背景、核心规则与主要危机',
    descEn: 'World background, core rules, and central conflicts',
  },
  {
    key: 'synopsis',
    fileName: 'synopsis.md',
    label: '全书总纲',
    labelEn: 'Book outline',
    iconName: 'map',
    desc: '全书剧情计划；旧按章范围续批保留为兼容模式',
    descEn: 'Whole-book plot plan; legacy chapter-range continuation remains available',
  },
]
