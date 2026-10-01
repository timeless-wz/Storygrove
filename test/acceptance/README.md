# 验收台架（acceptance harness）

配套方案：《全功能链路、存储连接与功能完整性验收方案》。本目录是方案第 10 节交付件的实施，
阶段状态见 `reports/`。**本目录内容只证明已执行的链路，未执行项一律 NOT_RUN，不得折算为 PASS。**

## 结构

```text
inventory/scan-inventory.mjs   L0 静态登记扫描器（通道↔处理器↔表交叉核对，含 scripts SQL）
inventory/features.json        F01–F32 / E00–E01P–E08 用例映射与三维状态（chain/storage/completeness）
lib/fixtures.mjs               运行根隔离目录 + 项目骨架 + 只读来源 fixture + 哈希
lib/storage-checker.mjs        独立只读 SQLite 回读（integrity/fk/语义快照），不经应用代码
lib/electron-driver.mjs        裸启 Electron + CDP attach 驱动（双隔离；用户路径退出 quitViaUI）
lib/isolated-node-runtime.mjs  独立 Node ABI SQLite 运行时（npm 缓存预构建包 + CJS 补丁 + ESM resolve/load hook + 垫片）
run-isolated-node.mjs          以独立 SQLite 二进制运行任意 Node/ vitest / node:test 命令
scenarios/e00-project-persistence.e2e.mjs   台架自证场景（PASS 18/18）
scenarios/e01-draft-persistence.e2e.mjs     E01 部分分支：手动草稿闭环（PASS 21/21）
__tests__/harness.node-test.mjs             台架自身故障边界（8 例）
evidence/                      基线、各命令日志与场景证据归档
reports/                       阶段报告
```

## 常用命令（仓库根；建议用隔离 runner，避免共享二进制 ABI 冲突）

```bash
# L0 登记扫描（重新生成 inventory/*.json 与 inventory.md）
node test/acceptance/inventory/scan-inventory.mjs

# 台架自身故障边界（独立 SQLite 环境）
node test/acceptance/run-isolated-node.mjs --test test/acceptance/__tests__/harness.node-test.mjs

# 类型检查（不受隔离 runner 影响，可直接跑）
node node_modules/typescript/bin/tsc --noEmit

# 完整 Node 回归（独立 SQLite；不触碰共享 better-sqlite3）
node test/acceptance/run-isolated-node.mjs node_modules/vitest/vitest.mjs run --reporter=dot

# 完整浏览器回归（独立端口避开其他任务）
AI_NOVEL_VITEST_BROWSER_API_PORT=63571 \
node test/acceptance/run-isolated-node.mjs node_modules/vitest/vitest.mjs run --config vitest.browser.config.ts --reporter=dot

# E00 / E01P 场景（内部自行构建当前源码、切 Electron ABI 并在结束时恢复）
node test/acceptance/run-isolated-node.mjs test/acceptance/scenarios/e00-project-persistence.e2e.mjs
node test/acceptance/run-isolated-node.mjs test/acceptance/scenarios/e01p-strict-isolation.e2e.mjs
```

## 驱动能力与约定（阶段三后）

- 退出语义分四段记录：`titlebarClose` / `exitConfirm` / `gracefulKill` / `forceKill`；场景断言必须拒绝 `forced:true`。
- 产物哈希锁：`recordArtifactHashes` 在构建后调用，`assertArtifactsUnchanged` 在关键节点校验，防并发构建覆盖。
- 浏览器套件与 Electron 场景**禁止并发**：本机实测并发会翻转原生模块 ABI 并使 smoke marker 丢失。
- 若 Node 全量出现 `window is not defined` 于 vditor 链路：检查是否又把浏览器专用模块改回静态导入（应保持动态导入）。

## 缓存缺失诊断与已知边界

- 隔离 runner 需要npm 缓存中有**同版本** better-sqlite3 的 Node 预构建包
  （`better-sqlite3-v<版本>-node-v<ABI>-<平台>-<架构>.tar.gz`，位于
  `%LOCALAPPDATA%/npm-cache/_prebuilds`，可用 `npm_config_cache` 覆盖）。缺失时 runner 直接报
  `Missing cached SQLite native release: …` 失败——先在 Node ABI 下跑一次 `pnpm test`（pretest 会
  用 prebuild-install 缓存包）再重试；不联网下载、不改共享 node_modules。
- **两条加载路径、与加载顺序无关**：CJS `require` 走 `Module._load` 补丁；原生 ESM `import` 由生成
  hook 的 `resolve` 把裸名 `better-sqlite3` 指到 `sqlite-shim.cjs`（按绝对路径 require 真模块，并强加
  独立 `nativeBinding`），`load` hook 仅作兜底。Node 对 `format:'commonjs'` 的 load hook `source` 在
  模块已进 require 缓存时会忽略，因此单靠 load hook 覆盖不了"先 require 后 import"的顺序（旧版本在
  这里登记过"必须先 ESM import"的已知限制，现已修复）。两种顺序都由 `harness.node-test.mjs` 锁定：
  in-process ESM-first + CJS 断言，外加"先 require 后 import"的自包含子进程回归护栏
  （测试内联 `node -e`，不依赖 `.runtime/` 下随时可能被清理的临时探针文件）。
- 隔离 runner 只保证"独立 Node 副本可用"（binding 固定在 `.runtime/acceptance-native/`，出处哈希
  记录在案）；**不等于"共享 node_modules 二进制已恢复 Node ABI"**，后者由 pretest/predev 自行探测处理。

## 关键约定

- 运行根每次新建于 `<homedir>/AppData/Local/Temp/vela-acc-<runId>/`（长路径，规避 Windows 8.3 短名），
  含 global-home / electron-profile / project-a / project-b / source-fixtures / evidence 等。
- 全局 home 用 `AI_NOVEL_VELA_HOME` 注入；Electron profile 用 `--user-data-dir` 注入；两者必须同时隔离。
- 项目打开走真实 smoke 链路（`project:smoke-open-request/confirm`），主进程写 marker 收据。
- **隔离 runner 的 hook 覆盖 CJS require 与 ESM import 两条加载路径，且与顺序无关**：ESM 侧靠
  `resolve` 把裸名指到垫片（vitest 对外部化模块的 ESM 默认导入不走 `Module._load`，探针已证）；
  包管理器 CLI（pnpm/npm/yarn/corepack）跳过 ESM hook 注册，否则 pnpmfile 探测会被破坏。
  Electron（ABI 不匹配）下 resolve/load hook、垫片与 CJS 补丁全部按 `process.versions.modules` 原样透传。
- 隔离 runner 下 `prepare:native-node` 探测的是**独立副本**，共享二进制不会被真正恢复——证据中须标注。
- 场景退出走用户路径（`quitViaUI`：标题栏关闭按钮 → 退出确认框「保存并退出」），退出码 0 为判据。
- 固定期望数据写死在测试常量（`EXPECTED`），不得调用被测函数生成期望结果。
- `D:\Desktop\小说` 等真实用户目录不作为可写测试目标；不关闭其他任务的应用与进程。
- 三维状态的 `storage` 是状态值；存储目标独立放在 `storageTargets`，不能重用 JSON 键。
- L0 是静态登记候选，脚本目录中的 SQL 也纳入扫描；不能把匹配数量称为完整运行时覆盖。
- 本机常有并发的其他验收任务：Electron 场景避免依赖 `--inspect`（playwright `_electron`）通道，
  使用裸启 + CDP；浏览器回归用独立 `AI_NOVEL_VITEST_BROWSER_API_PORT`。
