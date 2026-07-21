# Security Policy

## Supported versions

项目处于早期开发阶段，仅最新版本接受安全修复。

## Reporting a vulnerability

请不要在公开 Issue 中披露可利用的安全漏洞。请通过 GitHub Security Advisory 的私密报告入口联系维护者，并包含影响范围、复现步骤和建议修复方式。

## Security boundaries

- 声屿只应读取用户主动选择的素材库目录。
- 索引保存在应用本地数据目录。
- 应用不应上传音频、文件名、路径或使用数据。
- 文件定位功能只调用系统文件管理器，不执行音频文件内容。
