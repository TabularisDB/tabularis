<br />
<p align="center">
  <img src=".github/assets/banner-light.zh-CN.png#gh-light-mode-only" alt="Tabularis" width="100%">
  <img src=".github/assets/banner-dark.zh-CN.png#gh-dark-mode-only" alt="Tabularis" width="100%">
</p>

# Tabularis

Tabularis 是一款开源的桌面 SQL 工作台，内置 3 种数据库驱动，并提供 21 个已发布插件，包括 DuckDB、ClickHouse、Redis 和 Firestore。其内置的 MCP 服务器可让 Claude、Cursor 和 Devin（原 Windsurf）在你日常使用的同一款应用中读取数据库结构并执行查询。

<p align="center">
  <b><a href="https://tabularis.dev">官网</a></b> ·
  <b><a href="https://tabularis.dev/wiki">文档</a></b> ·
  <b><a href="https://tabularis.dev/download">下载</a></b> ·
  <b><a href="./CHANGELOG.md">更新日志</a></b>
</p>

<br />

<p align="center">
  <img src="https://img.shields.io/github/release/TabularisDB/tabularis.svg?style=flat" alt="Release" />
  <img src="https://img.shields.io/github/stars/TabularisDB/tabularis?style=flat" alt="Stars" />
  <img src="https://img.shields.io/github/downloads/TabularisDB/tabularis/total.svg?style=flat" alt="Downloads" />
  <img src="https://github.com/TabularisDB/tabularis/workflows/Release/badge.svg" alt="Build & Release" />
  <a href="https://discord.com/invite/K2hmhfHRSt"><img src="https://img.shields.io/discord/1502944695808950282?color=5865F2&logo=discord&logoColor=white" alt="Discord" /></a>
  <a href="https://gitster.dev/repo/TabularisDB/tabularis"><img src="https://gitster.dev/api/repositories/badge/cmlko1jr60005ne4yh7i7oy3e" alt="Gitster" /></a>
  <br />
  <a href="https://snapcraft.io/tabularis"><img src="https://img.shields.io/badge/snap-tabularis-blue?logo=snapcraft" alt="Snap Store" /></a>
  <a href="https://flatpark.org/apps/dev.tabularis.Tabularis/"><img src="https://img.shields.io/badge/flatpak-tabularis-4A90D9?logo=flatpak&logoColor=white" alt="Flatpak (Flatpark)" /></a>
  <a href="https://aur.archlinux.org/packages/tabularis-bin"><img src="https://img.shields.io/badge/AUR-tabularis--bin-1793D1?logo=archlinux&logoColor=white" alt="AUR" /></a>
  <a href="https://winstall.app/apps/Debba.Tabularis"><img src="https://img.shields.io/winget/v/Debba.Tabularis?label=WinGet&logo=windows&color=0078D4" alt="WinGet" /></a>
</p>

<p align="center">
  <a href="https://vercel.com/open-source-program"><img alt="Vercel OSS Program" src="https://vercel.com/oss/program-badge-2026.svg" /></a>
</p>

<p align="center">
  <sub>
    <a href="./README.md">English</a> ·
    <a href="./README.it.md">Italiano</a> ·
    <a href="./README.es.md">Español</a> ·
    <a href="./README.zh-CN.md">中文</a> ·
    <a href="./README.fr.md">Français</a> ·
    <a href="./README.de.md">Deutsch</a> ·
    <a href="./README.ja.md">日本語</a> ·
    <a href="./README.ru.md">Русский</a> ·
    <a href="./README.tl.md">Tagalog</a> ·
    <a href="./README.ko.md">한국어</a> ·
    <a href="./README.pt-BR.md">Português (Brasil)</a>
  </sub>
</p>

> [!NOTE]
> 这是翻译版文档。若需最新且权威的说明，请参考[英文 README](./README.md)。

<br />

<div align="center">
  <img src="https://raw.githubusercontent.com/TabularisDB/website/main/public/img/overview.gif" alt="Tabularis 桌面 SQL 工作台，展示查询编辑器和数据表格" />
</div>

## 下载

```bash
winget install Debba.Tabularis    # Windows
brew install --cask tabularis     # macOS
sudo snap install tabularis       # Linux
```

或直接下载安装包：

- **Windows:** &nbsp;[![Windows](https://img.shields.io/badge/Windows-Download-blue?logo=windows)](https://github.com/TabularisDB/tabularis/releases/download/v0.26.0/tabularis_0.26.0_x64-setup.exe)

- **macOS:** &nbsp;[![macOS (Apple Silicon)](https://img.shields.io/badge/macOS-Apple%20Silicon-black?logo=apple)](https://github.com/TabularisDB/tabularis/releases/download/v0.26.0/tabularis_0.26.0_aarch64.dmg)&nbsp;[![macOS (Intel)](https://img.shields.io/badge/macOS-Intel-black?logo=apple)](https://github.com/TabularisDB/tabularis/releases/download/v0.26.0/tabularis_0.26.0_x64.dmg)

- **Linux:** &nbsp;[![Linux AppImage](https://img.shields.io/badge/Linux-AppImage-green?logo=linux)](https://github.com/TabularisDB/tabularis/releases/download/v0.26.0/tabularis_0.26.0_amd64.AppImage)&nbsp;[![Linux .deb](https://img.shields.io/badge/Linux-.deb-orange?logo=debian)](https://github.com/TabularisDB/tabularis/releases/download/v0.26.0/tabularis_0.26.0_amd64.deb)&nbsp;[![Linux .rpm](https://img.shields.io/badge/Linux-.rpm-red?logo=redhat)](https://github.com/TabularisDB/tabularis/releases/download/v0.26.0/tabularis-0.26.0-1.x86_64.rpm)

应用界面支持英语、意大利语、西班牙语、简体中文、法语、德语、日语、俄语、韩语、他加禄语和巴西葡萄牙语。

> [!TIP]
> **Discord：** [加入社区](https://discord.com/invite/K2hmhfHRSt)，与维护者交流、提交反馈并获取帮助。

## 为什么选择 tabularis？

|                                                     |      **tabularis**       |           DBeaver CE           |    TablePlus    | Beekeeper Studio  |
| --------------------------------------------------- | :----------------------: | :----------------------------: | :-------------: | :---------------: |
| 许可证                                              |     Apache 2.0，免费     | Apache 2.0，免费（Pro 版收费） |    商业软件     | GPLv3（付费版本） |
| SQL 笔记本（SQL + Markdown 单元、跨单元变量、图表） |            ✅            |               ❌               |       ❌        |        ❌         |
| 面向 AI 代理的内置 MCP 服务器                       |            ✅            |               ❌               |       ❌        |        ❌         |
| 支持**任意语言**编写插件（基于 stdio 的 JSON-RPC）  |            ✅            |       Java/Eclipse 插件        | JavaScript 插件 |        ❌         |
| 支持**本地模型**（Ollama）的 AI text-to-SQL         |            ✅            |       基于云端的 AI 助手       |       ❌        |        ❌         |
| 带交互式计划图的可视化 EXPLAIN                      |            ✅            |               ✅               |       ❌        |        ❌         |
| 开箱即用支持的数据库                                | 3 种内置 + 21 个官方插件 |              100+              |       20+       |     约 10 种      |

> [!NOTE]
> 对比数据截至 2026 年 6 月，其他工具的功能此后可能已有变化。如果你需要几十种驱动，请使用 DBeaver。tabularis 专注于把少数几种数据库做好。

### 数据库支持

PostgreSQL、MySQL/MariaDB 和 SQLite 为内置支持。内置 PostgreSQL 驱动已弃用，改由 Tabularis 自动安装的 [PostgreSQL 插件](https://github.com/TabularisDB/tabularis-postgresql-plugin)取代。其余均为插件。下面列出当前状态，与网站上的[驱动与插件覆盖](https://tabularis.dev/#driver-coverage)保持一致：

**已发布**

| 数据库                   | 插件                                                                                            | 数据库         | 插件                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------- |
| ClickHouse               | [tabularis-clickhouse-plugin](https://github.com/TabularisDB/tabularis-clickhouse-plugin)       | LibSQL / Turso | [tabularis-libsql-plugin](https://github.com/TabularisDB/tabularis-libsql-plugin)               |
| Cloudflare D1            | [tabularis_cloudflare_d1_plugin](https://github.com/josejorge/tabularis_cloudflare_d1_plugin)   | MongoDB        | [tabularis-mongodb-plugin](https://github.com/danielnuld/tabularis-mongodb-plugin)              |
| Cloudflare D1 (HTTP API) | [cloudflare-tabularis](https://github.com/GabrielMalava/cloudflare-tabularis)                   | MongoDB Atlas  | [tabularis-mongodb-plugin](https://github.com/TabularisDB/tabularis-mongodb-plugin)             |
| DM / Dameng              | [tabularis-dameng-plugin](https://github.com/haos666/tabularis-dameng-plugin)                   | Oracle         | [tabularis-oracle-plugin](https://github.com/TabularisDB/tabularis-oracle-plugin)               |
| DuckDB                   | [tabularis-duckdb-plugin](https://github.com/TabularisDB/tabularis-duckdb-plugin)               | Redis (Go)     | [tabularis-redis-plugin-go](https://github.com/gzamboni/tabularis-redis-plugin-go)              |
| DynamoDB                 | [tabularis-dynamodb-plugin](https://github.com/TabularisDB/tabularis-dynamodb-plugin)           | Redis (Rust)   | [tabularis-redis-plugin](https://github.com/nicholas-papachriston/tabularis-redis-plugin)       |
| Elasticsearch            | [tabularis-elasticsearch-plugin](https://github.com/TabularisDB/tabularis-elasticsearch-plugin) | SQL Server     | [tabularis-sqlserver-plugin](https://github.com/TabularisDB/tabularis-sqlserver-plugin)         |
| Firestore                | [firestore-tabularis](https://codeberg.org/NewtTheWolf/firestore-tabularis)                     | CSV Folder     | [tabularis-csv-plugin](https://github.com/TabularisDB/tabularis-csv-plugin)                     |
| IBM Db2                  | [tabularis-db2-plugin](https://github.com/TabularisDB/tabularis-db2-plugin)                     | Google Sheets  | [tabularis-google-sheets-plugin](https://github.com/TabularisDB/tabularis-google-sheets-plugin) |
| IBM Informix             | [tabularis-informix-plugin](https://github.com/danielnuld/tabularis-informix-plugin)            | HackerNews     | [tabularis-hackernews-plugin](https://github.com/TabularisDB/tabularis-hackernews-plugin)       |

**悬赏看板中**

| 状态     | 数据库                                                                       |
| -------- | ---------------------------------------------------------------------------- |
| 已认领   | Google BigQuery, Meilisearch                                                 |
| 已规划   | Amazon Redshift, CockroachDB, TiDB                                           |
| 即将推出 | Snowflake                                                                    |
| 开放中   | Cassandra, Etcd, Firebird, ScyllaDB, SQL Anywhere, SurrealDB, Trino / Presto |

> [!NOTE]
> 标记为**已发布**的驱动可从[插件注册表](https://tabularis.dev/plugins)安装。其余均在[悬赏看板](https://tabularis.dev/plugins/bounties)上：你可以认领、赞助，或[申请新数据库](https://github.com/TabularisDB/tabularis/discussions)。

## 安装

### Windows

```bash
winget install Debba.Tabularis
```

也可以直接从 [Releases 页面](https://github.com/TabularisDB/tabularis/releases)下载安装程序。

### macOS

```bash
brew install --cask tabularis
```

从 **v0.13.1** 起，构建版本已由 Apple 签名并公证，直接打开即可，无需任何额外步骤。

<details>
<summary>v0.13.1 之前版本的说明</summary>

<br />

以下说明仅适用于直接下载的旧版本（v0.13.1 之前）：

- 你需要在“隐私与安全性”中授予 tabularis 应用辅助功能（Accessibility）访问权限。如果你是升级安装，并且 tabularis 已在允许列表中，请先手动将其移除，然后才能为新版本授予辅助功能访问权限。
- 将应用复制到“应用程序”目录后，可能还需要执行：

```bash
xattr -c /Applications/tabularis.app
```

</details>

### Linux

**Snap**

```bash
sudo snap install tabularis
sudo snap connect tabularis:password-manager-service   # 为已保存的凭据提供钥匙串访问
```

> [!IMPORTANT]
> Snap Store 目前尚不会自动连接 `password-manager-service` 接口。未连接时，保存连接会失败，并报错 `Platform secure storage failure`。

**Flatpak**

```bash
flatpak remote-add --if-not-exists flatpark https://dl.flatpark.org/flatpark.flatpakrepo
flatpak install flatpark dev.tabularis.Tabularis
```

**AppImage**

```bash
chmod +x tabularis_x.x.x_amd64.AppImage
./tabularis_x.x.x_amd64.AppImage
```

**Arch Linux**

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

<sub>[在 tabularis.dev 查看完整参考 →](https://tabularis.dev/wiki/connections)</sub>

- 支持 PostgreSQL、MySQL/MariaDB 和 SQLite。
- 本地保存连接配置。
- 支持 SSH 隧道和系统钥匙串密码存储。
- 连接页面支持网格/列表视图与实时搜索。
- 每个连接可单独自定义外观：自选图标（Lucide、Emoji 或自定义图片）和强调色。

### 数据库浏览器

<sub>[在 tabularis.dev 查看完整参考 →](https://tabularis.dev/wiki/schema-management)</sub>

- 浏览表、列、键、索引、视图和例程。
- 支持部分 schema 元素的行内编辑。
- 交互式 ER 图。
- 右键快捷操作。

### SQL 编辑器

<sub>[在 tabularis.dev 查看完整参考 →](https://tabularis.dev/wiki/editor)</sub>

- 使用 Monaco Editor，支持高亮和自动补全。
- 多标签页与隔离连接。
- 多语句执行，结果分开展示。
- 支持保存查询和编辑器内 AI 辅助。

### SQL 笔记本

<sub>[在 tabularis.dev 查看完整参考 →](https://tabularis.dev/wiki/notebooks)</sub>

- 同一文档中混合 SQL 与 Markdown 单元。
- 单元下方直接显示结果和图表。
- 支持跨单元变量和全局参数。
- 支持顺序执行全部单元。

### 可视化查询构建器

<sub>[在 tabularis.dev 查看完整参考 →](https://tabularis.dev/wiki/visual-query-builder)</sub>

- 拖拽式构建查询。
- 支持可视化 JOIN、过滤、聚合、排序和限制。
- 实时生成 SQL。

### 可视化 EXPLAIN

<sub>[在 tabularis.dev 查看完整参考 →](https://tabularis.dev/wiki/visual-explain)</sub>

- 将执行计划显示为可导航图结构。
- 支持表格、原始输出和可选 AI 分析视图。
- 兼容 PostgreSQL、MySQL/MariaDB 和 SQLite。

### 数据网格

<sub>[在 tabularis.dev 查看完整参考 →](https://tabularis.dev/wiki/data-grid)</sub>

- 行内编辑与批量编辑。
- 创建、选择和删除行。
- 导出为 CSV 或 JSON。
- 初步支持空间数据。
- JSON/JSONB 单元格高亮，并提供专用编辑器窗口（Tree / Monaco / Raw）。可按连接启用：在文本列中检测 JSON。

### 日志

- 在设置中查看实时日志。
- 可按级别过滤。
- 支持导出 `.log` 文件。
- CLI 调试模式：`tabularis --debug`。

### 插件系统

<sub>[在 tabularis.dev 查看完整参考 →](https://tabularis.dev/wiki/plugins)</sub>

- 通过 stdin/stdout 上的 JSON-RPC 2.0 扩展应用。
- 无需重启即可安装社区驱动。
- 官方注册表位于 [`plugins/registry.json`](./plugins/registry.json)。
- 开发指南位于 [`plugins/PLUGIN_GUIDE.md`](./plugins/PLUGIN_GUIDE.md)。

## 配置

<sub>[在 tabularis.dev 查看完整参考 →](https://tabularis.dev/wiki/configuration)</sub>

配置文件默认保存在：

- Linux：`~/.config/tabularis/`
- macOS：`~/Library/Application Support/tabularis/`
- Windows：`%APPDATA%\tabularis\`

主要文件：

- `connections.json`
- `saved_queries.json`
- `config.json`
- `themes/`
- `preferences/`
- `connection-icons/`（连接图标的自定义图片）

`config.json` 中的 `language` 字段支持 `auto`、`en`、`it`、`es`、`zh`、`fr`、`de`、`ja`、`ru`、`ko`、`tl` 和 `pt-BR`。

## AI

<sub>[在 tabularis.dev 查看完整参考 →](https://tabularis.dev/wiki/ai-assistant)</sub>

可选的 text-to-SQL 与查询解释支持以下提供商：

- OpenAI
- Anthropic
- MiniMax
- OpenRouter
- Ollama
- 兼容 OpenAI 的 API

模型列表会动态获取，并在本地缓存。

## MCP

<sub>[在 tabularis.dev 查看完整参考 →](https://tabularis.dev/wiki/mcp-server)</sub>

内置 MCP 服务器启动方式：

```bash
tabularis --mcp
```

支持的客户端：

- Claude Desktop
- Cursor
- Windsurf

可用工具：

| 工具               | 说明                                   |
| ------------------ | -------------------------------------- |
| `list_connections` | 列出所有已保存的连接                   |
| `list_databases`   | 列出某个连接中的所有数据库             |
| `list_tables`      | 列出某个连接中的表（可按 schema 过滤） |
| `describe_table`   | 获取完整结构：列、索引、外键           |
| `run_query`        | 执行任意 SQL 查询并返回结果            |

## 技术栈

| 层   | 技术栈                                |
| ---- | ------------------------------------- |
| 前端 | React 19, TypeScript, Tailwind CSS v4 |
| 后端 | Rust, Tauri v2, SQLx                  |

## 开发

**启动开发环境**

```bash
pnpm install
pnpm tauri dev
```

**构建**

```bash
pnpm tauri build
```

## 路线图

路线图根据 GitHub Issues 自动生成。最新状态请查看[英文 README](./README.md#roadmap)。

## 贡献

欢迎贡献，请参阅 [CONTRIBUTING.md](./CONTRIBUTING.md)。不错的切入点：

- [SQL Server 驱动插件：测试驱动并处理未解决的 Issue](https://github.com/TabularisDB/tabularis-sqlserver-plugin)
- [UI 设计系统与视觉识别：贡献者招募](https://github.com/TabularisDB/tabularis/issues/195)
- 参阅[插件指南](./plugins/PLUGIN_GUIDE.md)，用任意语言编写驱动插件

## 赞助商与支持者

Tabularis 得到了许多优秀赞助者和支持者的支持。完整名单请查看[英文 README](./README.md#sponsors-and-supporters) 和 [tabularis.dev/sponsors](https://tabularis.dev/sponsors)。

## 项目起源

Tabularis 始于一次实验：AI 辅助开发能在多大程度上从零构建出一款可用的工具？结果超出预期：如今它已是一个持续维护的项目，定期发布新版本，并拥有自己的插件生态。

## 许可证

[Apache License 2.0](./LICENSE)

---

<p align="center">
  喜欢 tabularis？欢迎<a href="https://github.com/TabularisDB/tabularis">为仓库点个 Star</a> ⭐，这对项目帮助很大。
</p>

<p align="center">
  <a href="https://repostars.dev/?repos=TabularisDB%2Ftabularis&theme=dark">
    <img src="https://repostars.dev/api/embed?repo=TabularisDB%2Ftabularis&theme=dark" alt="RepoStars" />
  </a>
</p>
