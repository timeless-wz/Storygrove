import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { playwright } from '@vitest/browser-playwright'
import { readFileSync } from 'node:fs'

/**
 * 剧情画布外壳（plot-shell）的展示测试与截图专用配置。
 *
 * 与 vitest.planning-visual.config.ts 同一套做法：vitest.browser.config.ts
 * 没有挂 Tailwind 插件，而 plot-shell 的截图/对话框依赖 Tailwind 工具类，
 * 这里补上 @tailwindcss/vite，只跑 plot-shell 目录的 .visual.tsx。
 *
 * 用法：npx vitest run --config vitest.plot-shell-visual.config.ts
 */

const executablePath = process.env.AI_NOVEL_VITEST_CHROMIUM
const browserApiPort = Number(process.env.AI_NOVEL_VITEST_BROWSER_API_PORT || 63462)
const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig({
  plugins: [tailwindcss(), react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  test: {
    include: ['src/components/canvas/plot-shell/__tests__/*.visual.tsx'],
    setupFiles: ['test/setup-locale.ts'],
    browser: {
      enabled: true,
      api: { host: '127.0.0.1', port: browserApiPort },
      provider: playwright(executablePath ? { launchOptions: { executablePath } } : undefined),
      instances: [{ browser: 'chromium', viewport: { width: 1264, height: 900 } }],
      headless: true,
      fileParallelism: false,
    },
  },
})
