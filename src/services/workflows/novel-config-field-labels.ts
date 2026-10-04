/** Text-valued NovelConfig fields that support the existing single-field generator. */
export type GeneratableField =
  | 'coreOutline'
  | 'worldSetting'
  | 'goldenFinger'
  | 'protagonistProfile'
  | 'globalGuidance'
  | 'writingStyle'

export const GENERATABLE_FIELD_LABELS: Readonly<Record<GeneratableField, readonly [string, string]>> = {
  coreOutline: ['故事构想', 'Story concept'],
  worldSetting: ['背景构想', 'Background concept'],
  goldenFinger: ['主角优势 / 核心卖点', 'Protagonist advantage / core hook'],
  protagonistProfile: ['主角构想', 'Protagonist concept'],
  globalGuidance: ['全局写作要求', 'Global writing guidance'],
  writingStyle: ['文风配置', 'Writing style'],
}
