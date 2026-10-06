# Storygrove 开发与发布

## 开发

按 `package.json` 的 engines 和 packageManager 准备环境，安装锁定依赖：

```sh
pnpm install --frozen-lockfile
pnpm run dev
```

常用验证：

```sh
pnpm run typecheck
pnpm test
pnpm run test:browser
pnpm run lint
```

原生 SQLite 依赖需匹配运行时；使用项目已有的准备脚本，不在应用运行中随意替换二进制。

## Windows 正式打包

关闭由本仓库启动、可能占用构建文件的开发程序。在 Windows 交互桌面中运行：

```powershell
$releaseLog = ".\build-win-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"
pnpm run build:win 2>&1 | Tee-Object -FilePath $releaseLog
if ($LASTEXITCODE -ne 0) {
    throw "发布验证失败，请检查 $releaseLog"
}
```

`build:win` 会执行测试、监视器握手、构建、产物校验、程序及安装器冒烟、旧版升级检查和收尾验证。以实际脚本和本轮证据为准；失败或未执行的步骤不可记为通过。监视器无法就绪时应调查原因，不伪造 ready 信号或绕过门禁。

产物位于 `release/<package.json 中的版本>/`。安装包名称暂为 `ai-novel-writer-setup-<版本>.exe`。`build:win-dir` 生成程序目录，`build` 只编译，均不等同于正式安装包验收。

## GitHub 发布

Storygrove 发布仓库为 https://github.com/timeless-wz/Storygrove 。源码上传不等于发布安装包，也不会证明安装验证通过。

发布前：

1. 确定源码提交和版本；针对最终代码运行完整验收。
2. 核对本轮产物时间、大小、SHA256 与验证回执，不能使用旧文件顶替。
3. 按 `.release/release-profile.json` 的资产合同准备平台安装包、校验文件及更新元数据。
4. 将实际签名、公证状态、支持平台、验证范围与已知限制写入版本说明。
5. 确认所有发布目标及合同要求满足后，创建对应版本的 Release。历史 `.release/notes` 不是 Storygrove 新版的现成验收声明。

应用更新地址和产物内的更新配置必须都指向 Storygrove；新仓库没有发布记录时，不应回退到原项目获取替代安装包。安装包生成后才修改源码中的地址不会修正既有安装包，必须重新构建与验证。

本次仓库迁移保留应用标识、文件名和数据格式。将来修改这些标识需要单独验证旧版升级及用户数据兼容性。
