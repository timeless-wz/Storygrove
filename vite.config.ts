import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'vite-plugin-electron/simple';
import electronRenderer from 'vite-plugin-electron-renderer';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// ESM 中不存在 __dirname，需要用 import.meta.url 来模拟
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 从 package.json 读取版本号，构建时注入到前端
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

// https://vitejs.dev/config/
export default defineConfig({
  // BrowserWindow.loadFile() serves the renderer through file://.  Keep public
  // and bundled asset URLs relative to dist/ rather than the filesystem root.
  base: './',
  plugins: [{
    name: 'renderer-build-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        // Keep the synchronous theme bootstrap without allowing arbitrary inline
        // scripts or eval. Hash the emitted text, including its exact whitespace.
        const inlineHashes = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
          .filter(([, attributes]) => !/\bsrc\s*=/i.test(attributes))
          .map(([, , code]) => `'sha256-${createHash('sha256').update(code).digest('base64')}'`);
        // Vditor synchronously loads its bundled icon sprite through XHR and
        // inserts that exact file as an inline script. Authorize only this asset.
        inlineHashes.push(`'sha256-${createHash('sha256').update(readFileSync(path.join(__dirname, 'public/vditor/dist/js/icons/ant.js'))).digest('base64')}'`);
        return [{ tag: 'meta', injectTo: 'head-prepend', attrs: {
          'http-equiv': 'Content-Security-Policy',
          content: `default-src 'self'; script-src 'self' ${inlineHashes.join(' ')}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'`,
        } }];
      },
    },
  }, tailwindcss(), react(), electron({
    main: {
      // Shortcut of `build.lib.entry`.
      entry: 'electron/main.ts',
      vite: {
        build: {
          // 强制输出 CommonJS，保证 better-sqlite3 等 native 模块能正常加载
          rollupOptions: {
            external: ['better-sqlite3', '@lancedb/lancedb', 'yauzl'],
            output: {
              format: 'cjs'
            }
          }
        }
      }
    },
    preload: {
      // Shortcut of `build.rollupOptions.input`.
      // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
      input: path.join(__dirname, 'electron/preload.ts')
    }
  }), process.env.NODE_ENV !== 'test' && electronRenderer()],
  publicDir: 'public',
  server: {
    host: '127.0.0.1',
    port: 5180,
    strictPort: true,
    watch: {
      ignored: ['**/docs/**']
    }
  },
  define: {
    // 构建时将 package.json 版本注入为全局常量，避免 StatusBar 硬编码版本号
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  optimizeDeps: {
    entries: ['index.html', 'src/**/*.{ts,tsx}']
  },
  test: {
    // Test copy must not follow the operating-system locale of a CI runner.
    setupFiles: ['test/setup-locale.ts'],
    // Electron repositories share one process-global native SQLite handle.
    // Running files concurrently lets one fixture close or replace another
    // fixture's database, so keep the default suite isolated by file.
    fileParallelism: false,
    // 本地历史 worktree、pnpm 缓存与打包产物可能包含旧版本测试或另一套 ABI 的原生模块；
    // 它们不是当前项目源码。electron-builder 的 release/ 里带着整份 app.asar.unpacked
    // node_modules（better-sqlite3 为 Electron ABI），一旦被解析到，测试就会报
    // NODE_MODULE_VERSION 不匹配。
    exclude: [
      ...configDefaults.exclude,
      '**/release/**',
      '**/.worktrees/**',
      '**/.pnpm-store/**',
      '**/.workbuddy/**',
      '**/.runtime/**',
      '**/plugins/**',
      '**/.release/scripts/release-artifact-retention.test.mjs',
    ],
  },
  build: {
    rollupOptions: {
      onwarn(warning, defaultHandler) {
        // 过滤掉已知的无害警告
        if (warning.code === 'INEFFECTIVE_DYNAMIC_IMPORT') return;
        if (warning.message?.includes('Invalid key')) return;
        defaultHandler(warning);
      }
    }
  }
});
