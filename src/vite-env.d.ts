/// <reference types="vite/client" />

/** 由 vite.config.ts define 注入的版本号（来自 package.json） */
declare const __APP_VERSION__: string

// Vditor 随包语言包（副作用脚本：设置 window.VditorI18n）。
// 显式传入 options.i18n 可跳过 Vditor 的运行时 <script> 注入——
// 该注入请求一旦悬挂，Vditor 的 init 永不执行且不报错，编辑器会永久空白。
declare module 'vditor/dist/js/i18n/zh_CN.js'
