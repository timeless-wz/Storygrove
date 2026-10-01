import { defineConfig, mergeConfig } from 'vitest/config'
import browserConfig from './vitest.browser.config.ts'

// Limit dependency scanning to this feature while other work is active in the checkout.
const files = ['src/components/pages/__tests__/cultivation-settings.browser.tsx', 'src/components/editor/__tests__/CharacterEditor.profile-edit.browser.tsx']
const config = mergeConfig(browserConfig, defineConfig({ optimizeDeps: { entries: files } }))
config.test = { ...config.test, include: files }
export default config
