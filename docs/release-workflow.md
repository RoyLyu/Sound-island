# 声屿发布与 QA 工作流

此流程用于每个桌面版本。目标是让源代码、自动化检查、真实桌面验证和 GitHub 安装包保持一致，同时保证素材、绝对路径和 SQLite 数据库永不进入版本库。

## 1. 发布前检查

```bash
npm ci
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

版本号须在 `package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json` 中一致。

## 2. 真实桌面 QA

使用独立 bundle identifier 构建 QA 应用，避免读写正式版数据库。在 1280 × 760 窗口至少验证：

- 搜索、选择、Space 试听、波形与实时频谱；
- `F` 收藏、`Z` 撤回、`Tab` 搜索、`Cmd/Ctrl + E` 导出；
- 中文显示名只读取原始音频名，真实路径和硬盘文件名不变；
- 拖出音频使用 copy 模式；
- 声音实验室 A/B 试听、相位相关度、单声道立体化、空间/遮挡和 24-bit WAV 导出；
- 导出文件可由系统音频工具读取，源文件哈希保持不变。

## 3. 数据边界

提交前执行：

```bash
git status --short
git ls-files | rg '(\.db(-wal|-shm)?$|/target/|^dist/|^node_modules/)'
rg -n '/Users/|/Volumes/' --glob '!docs/release-workflow.md' --glob '!package-lock.json' .
```

允许提交源码、配置、测试和文档。禁止提交音效文件、真实素材路径、SQLite 数据库、构建缓存与 QA 导出文件。

## 4. GitHub Release

合并到 `main` 后创建 `app-vX.Y.Z` 标签并推送。`.github/workflows/release.yml` 会先执行质量门禁，再分别生成 Apple Silicon macOS、Intel macOS 和 Windows NSIS 安装包并发布到同一个 Release。

当前公开构建为 ad-hoc 签名，尚未经过 Apple notarization。正式面向大众分发前需配置 Developer ID、notarization 与 Windows 代码签名。
