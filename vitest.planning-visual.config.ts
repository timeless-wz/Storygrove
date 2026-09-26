import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { playwright } from '@vitest/browser-playwright'
import { readFileSync } from 'node:fs'

/**
 * 创作规划区域的截图专用配置。
 *
 * vitest.browser.config.ts 只挂了 react()，因此浏览器测试里 index.css 的
 * `@import "tailwindcss"` 不会生成任何工具类（.max-w-2xl / .w-full / .h-7 …），
 * 截出来的页面缺少全部 Tailwind 布局。这里补上 @tailwindcss/vite，让截图与
 * 真实应用一致；同时只跑规划区域的截图文件，不影响其他浏览器测试。
 *
 * 用法：npx vitest run --config vitest.planning-visual.config.ts
 */

const executablePath = process.env.AI_NOVEL_VITEST_CHROMIUM
const browserApiPort = Number(process.env.AI_NOVEL_VITEST_BROWSER_API_PORT || 63461)
const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig({
  plugins: [tailwindcss(), react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  test: {
    include: ['src/components/planning/__tests__/*.visual.tsx'],
    setupFiles: ['test/setup-locale.ts'],
    browser: {
      enabled: true,
      api: { host: '127.0.0.1', port: browserApiPort },
      provider: playwright(executablePath ? { launchOptions: { executablePath } } : undefined),
      instances: [{ browser: 'chromium', viewport: { width: 1280, height: 820 } }],
      headless: true,
      fileParallelism: false,
    },
  },
})
