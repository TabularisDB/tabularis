<div align="center">
  <img src="public/logo-sm.png" width="120" height="120" />
</div>

# tabularis

<p align="center">
  <strong>README:</strong>
  <a href="./README.md">English</a> |
  <a href="./README.it.md">Italiano</a> |
  <a href="./README.es.md">Español</a> |
  <a href="./README.zh-CN.md">中文</a> |
  <a href="./README.fr.md">Français</a> |
  <a href="./README.de.md">Deutsch</a> |
  <a href="./README.ja.md">日本語</a> |
  <a href="./README.ru.md">Русский</a>
</p>

面向现代数据库的开源桌面客户端。支持 PostgreSQL、MySQL/MariaDB 和 SQLite，内置 SQL 笔记本、AI 功能、MCP 集成以及外部插件系统。

**Discord** - [加入社区](https://discord.com/invite/K2hmhfHRSt)，与维护者交流、提交反馈并获取帮助。

> 这是翻译版文档。若需最新且权威的说明，请同时参考[英文 README](./README.md)。

## 下载

[![Windows](https://img.shields.io/badge/Windows-Download-blue?logo=windows)](https://github.com/TabularisDB/tabularis/releases/download/v0.9.18/tabularis_0.9.18_x64-setup.exe)
[![macOS](https://img.shields.io/badge/macOS-Download-black?logo=apple)](https://github.com/TabularisDB/tabularis/releases/download/v0.9.18/tabularis_0.9.18_x64.dmg)
[![Linux AppImage](https://img.shields.io/badge/Linux-AppImage-green?logo=linux)](https://github.com/TabularisDB/tabularis/releases/download/v0.9.18/tabularis_0.9.18_amd64.AppImage)
[![Linux .deb](https://img.shields.io/badge/Linux-.deb-orange?logo=debian)](https://github.com/TabularisDB/tabularis/releases/download/v0.9.18/tabularis_0.9.18_amd64.deb)
[![Linux .rpm](https://img.shields.io/badge/Linux-.rpm-red?logo=redhat)](https://github.com/TabularisDB/tabularis/releases/download/v0.9.18/tabularis-0.9.7-1.x86_64.rpm)

## 安装

### Windows

```bash
winget install Debba.Tabularis
```

也可以直接从 [Releases 页面](https://github.com/TabularisDB/tabularis/releases)下载安装程序。

### macOS

```bash
brew tap TabularisDB/tabularis
brew install --cask tabularis
```

如果你从 release 直接安装，可能还需要执行：

```bash
xattr -c /Applications/tabularis.app
```

### Linux

Snap：

```bash
sudo snap install tabularis
```

AppImage：

```bash
chmod +x tabularis_x.x.x_amd64.AppImage
./tabularis_x.x.x_amd64.AppImage
```

Arch Linux：

```bash
yay -S tabularis-bin
```

## 更新

- 应用启动时会自动检查更新。
- 也可以通过 GitHub Releases 手动获取最新版。

## 画廊

完整截图和演示请查看 [tabularis.dev](https://tabularis.dev)。

## 功能

### 连接管理

- 支持 PostgreSQL、MySQL/MariaDB 和 SQLite。
- 本地保存连接配置。
- 支持 SSH 隧道和系统钥匙串密码存储。
- 连接页面支持网格/列表视图与实时搜索。

### 数据库浏览器

- 浏览表、列、键、索引、视图和例程。
- 支持部分 schema 元素的行内编辑。
- 交互式 ER 图。
- 右键快捷操作。

### SQL 编辑器

- 使用 Monaco Editor，支持高亮和自动补全。
- 多标签页与隔离连接。
- 多语句执行，结果分开展示。
- 支持保存查询和编辑器内 AI 辅助。

### SQL 笔记本

- 同一文档中混合 SQL 与 Markdown 单元。
- 单元下方直接显示结果和图表。
- 支持跨单元变量和全局参数。
- 支持顺序执行全部单元。

### 可视化查询构建器

- 拖拽式构建查询。
- 支持可视化 JOIN、过滤、聚合、排序和限制。
- 实时生成 SQL。

### 可视化 EXPLAIN

- 将执行计划显示为可导航图结构。
- 支持表格、原始输出和可选 AI 分析视图。
- 兼容 PostgreSQL、MySQL/MariaDB 和 SQLite。

### 数据网格

- 行内编辑与批量编辑。
- 创建、选择和删除行。
- 导出为 CSV 或 JSON。
- 初步支持空间数据。

### 日志

- 在设置中查看实时日志。
- 可按级别过滤。
- 支持导出 `.log` 文件。
- CLI 调试模式：`tabularis --debug`。

### 插件系统

- 通过 stdin/stdout 上的 JSON-RPC 2.0 扩展应用。
- 无需重启即可安装社区驱动。
- 官方注册表位于 [`plugins/registry.json`](./plugins/registry.json)。
- 开发指南位于 [`plugins/PLUGIN_GUIDE.md`](./plugins/PLUGIN_GUIDE.md)。

## 配置

配置文件默认保存在：

- Linux：`~/.config/tabularis/`
- macOS：`~/Library/Application Support/tabularis/`
- Windows：`%APPDATA%\\tabularis\\`

主要文件：

- `connections.json`
- `saved_queries.json`
- `config.json`
- `themes/`
- `preferences/`

`config.json` 中的 `language` 字段支持 `auto`、`en`、`it`、`es`、`zh`、`fr`、`de`。

## AI

可选的 text-to-SQL 与查询解释支持以下提供商：

- OpenAI
- Anthropic
- MiniMax
- OpenRouter
- Ollama
- 兼容 OpenAI 的 API

模型列表会动态获取，并在本地缓存。

## MCP

内置 MCP 服务器启动方式：

```bash
tabularis --mcp
```

支持的客户端：

- Claude Desktop
- Cursor
- Windsurf

可用工具：

- `list_connections`
- `list_tables`
- `describe_table`
- `run_query`

## 技术栈

- 前端：React 19、TypeScript、Tailwind CSS v4
- 后端：Rust、Tauri v2、SQLx

## 开发

启动开发环境：

```bash
pnpm install
pnpm tauri dev
```

构建：

```bash
pnpm tauri build
```

## 路线图

- Remote Control
- Command Palette
- JSON/JSONB 编辑与查看
- SQL Formatting / Prettier
- Data Compare / Diff Tool
- Team Collaboration

## 许可证

Apache License 2.0
