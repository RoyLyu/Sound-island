# 声屿 Sound Island

免费、开源、本地优先的专业音效管理器。面向电影声音制作人、声音设计师、剪辑师与日常内容创作者。

> 当前版本：`0.5.0` 素材库工作流版。素材库默认为空，不包含任何示例或 Mock 数据。

## 核心原则

- **真正本地**：音频不会上传，索引保存在本机 SQLite 数据库。
- **不碰原文件**：扫描、分类、收藏和移除索引都不会移动、改名或删除音频。
- **大型素材库可用**：SQLite + FTS5 全文索引，界面按需读取结果，不把几十万条记录一次塞进内存。
- **免费开源**：MIT License，可免费使用、研究、修改和分发。

## 已实现

- 选择本地文件夹并递归扫描 WAV、AIFF、FLAC、MP3、M4A、OGG
- 从真实文件读取时长、采样率、声道与位深（格式支持取决于文件编码）
- SQLite 持久索引，关闭应用后无需重新导入
- 强化 FTS5 全库搜索：输入关键词后始终检索全部已导入音频，不叠加侧栏筛选
- 中英文常见关键词扩展搜索
- 根据文件名和目录名自动放入虚拟分类列表
- 环境、拟音、硬音效、UI、生物、交通、武器、设计音及子分类
- 本地试听、进度定位、收藏；列表音频可作为真实文件拖到桌面、Finder 或外部制作软件
- 真实波形总览：Rust 在本机解码音频并向界面返回归一化峰值
- 键盘工作流：`Space` 播放，`W` / `S` 选择，`F` 收藏，`Z` 撤回，`Tab` 搜索，`Cmd/Ctrl + E` 导出副本
- 智能视图：我的收藏与最近播放
- 主分类可展开/取消选择；母文件夹显示全部层级的后代目录及递归音频数量
- 本地素材库支持拖动排序，排列顺序持久保存到本机 SQLite
- 声音实验室：实时三段 EQ、混响、延迟、失真、五种预设、A/B 对比与自定义调整
- 立体声拓宽：0%–200% 宽度、80–250 Hz 低频单声道保护、中置信号保持、实时相位相关度及单声道兼容保护
- 单声道立体化：分频、高频左右微差、微延迟、短反射及相位保护
- 空间迁移：浴室、走廊、隧道、地下停车场、汽车、教堂、仓库、小房间、山谷、水下及金属容器
- 隔墙与遮挡：门、墙、双层墙、楼上/楼下、汽车外部及头盔听感
- 底部试听区专注显示可跳转波形；右侧声音详情显示 8192 点 FFT 对数实时频谱
- 声音实验室的拓宽、立体化、空间迁移与遮挡入口集中在左侧声音方案栏
- 非破坏式本地导出：生成新的 24-bit WAV，拒绝覆盖母文件
- 本地中文显示名：离线行业词库生成、手动编辑、撤回/恢复；不重命名硬盘文件
- 自动忽略 macOS `._` 资源分叉；导入和重新扫描时必须实际解码出音频帧，否则阻挡入库并清理旧索引
- 一键在 Finder / Windows 资源管理器中选中原文件
- 重新扫描、增量更新、自动清理已经移走文件的失效索引

## 自动分类如何工作

导入时，应用会分析文件名和完整目录路径，例如：

| 文件名 | 自动列表 | 子分类 |
|---|---|---|
| `AMB_Rain_Heavy_01.wav` | 环境 Ambience | 天气 / Weather |
| `Leather_Boots_Footsteps.aif` | 拟音 Foley | 脚步 / Footsteps |
| `Creature_Monster_Growl_03.wav` | 生物 Creature | 怪兽 / Monsters |
| `UI_Notification_Success.wav` | 界面 UI | 通知 / Notifications |

分类仅存在于声屿数据库中，不会在硬盘上移动文件。无法可靠判断时进入「未分类」，避免擅自猜测。

规则位于 [`src-tauri/src/classify.rs`](src-tauri/src/classify.rs)，欢迎提交适合不同音效库命名习惯的规则。

## 安装

正式公开后，可在 GitHub Releases 下载：

- macOS：`.dmg` 或 `.app`
- Windows：`.msi` 或 NSIS `.exe`

未签名的开发版本可能触发系统安全提示。面向大众分发前建议配置 Apple Developer ID 与 Windows 代码签名证书。

## 本地开发

### 前置环境

- Node.js 22 或更高版本
- Rust stable 1.77.2 或更高版本
- Tauri 2 对应的系统依赖

请先按照 [Tauri 官方前置环境说明](https://v2.tauri.app/start/prerequisites/) 配置 macOS、Windows 或 Linux。

### 运行

```bash
npm install
npm run tauri:icon
npm run tauri:dev
```

### 构建安装包

```bash
npm run tauri:icon
npm run tauri:build
```

### 检查

```bash
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

完整发布、真实桌面 QA 与数据排除清单见 [`docs/release-workflow.md`](docs/release-workflow.md)。

## 隐私与安全

- 没有账号系统、云端数据库、遥测或广告 SDK。
- 只有用户主动选择的文件夹会被加入音频读取范围。
- 本地路径只用于数据库索引、试听和在系统文件管理器中定位。
- 波形分析、中文显示名和播放历史都在本机完成；没有文件名翻译网络请求。
- 「从索引移除」不会删除原始音频。

发现安全问题请参阅 [SECURITY.md](SECURITY.md)。

## 技术栈

- Tauri 2 + Rust
- React 19 + TypeScript + Vite
- SQLite / FTS5
- Symphonia 音频元数据探测与可播放性解码验证

## 路线图

- 波形峰值持久缓存与后台预分析
- 可选的用户自定义本地翻译词库
- BWF/iXML 元数据读取与编辑
- 用户可编辑自动分类规则
- 重复文件检测
- 相似音效搜索
- 项目集合与 Pro Tools 区域/时间码工作流
- macOS / Windows 签名与自动更新

## 贡献

欢迎 Issue 与 Pull Request。开始前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## License

[MIT](LICENSE) © 2026 RoyLyu and contributors
