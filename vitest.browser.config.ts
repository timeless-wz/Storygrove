import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { playwright } from '@vitest/browser-playwright'
import { readFileSync } from 'node:fs'

const executablePath = process.env.AI_NOVEL_VITEST_CHROMIUM
const browserApiPort = Number(process.env.AI_NOVEL_VITEST_BROWSER_API_PORT || 63450)
const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig({
  plugins: [tailwindcss(), react(), {
    name: 'cultivation-browser-test-database', enforce: 'pre',
    resolveId(source, importer, options) {
      if (options.ssr && importer?.replace(/\\/g, '/').includes('/electron/repositories/') && /^\.\.\/database$/.test(source)) {
        return new URL('./test/cultivation-browser-database.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
      }
    },
  }],
  optimizeDeps: {
    include: ['zustand/middleware'],
  },
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  test: {
    include: ['src/**/*.browser.tsx'],
    setupFiles: ['test/setup-locale.ts'],
    browser: {
      enabled: true,
      commands: {
        async cultivationIpc(context, channel: string, ...args: unknown[]) {
          const backend = await context.project.vite.ssrLoadModule('/test/cultivation-browser-backend.ts')
          return backend.cultivationTestIpc(channel, ...args)
        },
        async creativeIpc(context, channel: string, ...args: unknown[]) {
          const backend = await context.project.vite.ssrLoadModule('/test/creative-content-browser-backend.ts')
          return backend.creativeContentTestIpc(channel, ...args)
        },
      },
      // 63315 is frequently reserved by Windows/HNS. Keep this overridable
      // for CI, but use an unreserved default for local browser regressions.
      api: { host: '127.0.0.1', port: browserApiPort },
      provider: playwright(executablePath ? { launchOptions: { executablePath } } : undefined),
      instances: [{ browser: 'chromium' }],
      headless: true,
      fileParallelism: false,
    },
  },
})
