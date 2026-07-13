<div align="center">
  <img src="public/logo-sm.png" width="120" height="120" />
</div>

# tabularis

<p align="center">
  <strong>Ang Tabularis ay isang open-source na desktop SQL workspace para sa PostgreSQL, MySQL/MariaDB, SQLite at 12+ pang database tulad ng DuckDB, ClickHouse, Redis at Firestore.<br />
  Pinapayagan ng built-in na MCP server nito ang Claude, Cursor at Devin (dating Windsurf) na basahin ang iyong schema at magpatakbo ng mga query sa parehong app na ginagamit mo na.</strong>
</p>

<p align="center">
  <strong>README:</strong>
  <a href="./README.md">English</a> |
  <a href="./README.it.md">Italiano</a> |
  <a href="./README.es.md">Español</a> |
  <a href="./README.zh-CN.md">中文</a> |
  <a href="./README.fr.md">Français</a> |
  <a href="./README.de.md">Deutsch</a> |
  <a href="./README.ja.md">日本語</a> |
  <a href="./README.ru.md">Русский</a> |
  <a href="./README.tl.md">Tagalog</a>
</p>

<p align="center">
  
![](https://img.shields.io/github/release/TabularisDB/tabularis.svg?style=flat)
![](https://img.shields.io/github/stars/TabularisDB/tabularis?style=flat)
![](https://img.shields.io/github/downloads/TabularisDB/tabularis/total.svg?style=flat)
![Build & Release](https://github.com/TabularisDB/tabularis/workflows/Release/badge.svg)
[![Discord](https://img.shields.io/discord/1502944695808950282?color=5865F2&logo=discord&logoColor=white)](https://discord.com/invite/K2hmhfHRSt)
[![Gitster](https://gitster.dev/api/repositories/badge/cmlko1jr60005ne4yh7i7oy3e)](https://gitster.dev/repo/TabularisDB/tabularis)

</p>

<p align="center">
  <a href="https://snapcraft.io/tabularis"><img src="https://img.shields.io/badge/snap-tabularis-blue?logo=snapcraft" alt="Snap Store" /></a>
  <a href="https://flatpark.org/apps/dev.tabularis.Tabularis/"><img src="https://img.shields.io/badge/flatpak-tabularis-4A90D9?logo=flatpak&logoColor=white" alt="Flatpak (Flatpark)" /></a>
  <a href="https://aur.archlinux.org/packages/tabularis-bin"><img src="https://img.shields.io/badge/AUR-tabularis--bin-1793D1?logo=archlinux&logoColor=white" alt="AUR" /></a>
  <a href="https://winstall.app/apps/Debba.Tabularis"><img src="https://img.shields.io/winget/v/Debba.Tabularis?label=WinGet&logo=windows&color=0078D4" alt="WinGet" /></a>
</p>

<div align="center">
  <img src="https://raw.githubusercontent.com/TabularisDB/website/main/public/img/overview.gif" alt="Tabularis" />
</div>

**Discord** — [Sumali sa aming Discord server](https://discord.com/invite/K2hmhfHRSt) para makipag-usap sa mga maintainer, magbahagi ng feedback, at humingi ng tulong mula sa komunidad.

> Ito ay isinalin na bersyon ng dokumentasyon. Ang pinakabago at opisyal na pinagmulan ay ang [README sa Ingles](./README.md).

## I-download

```bash
winget install Debba.Tabularis                                   # Windows
brew tap TabularisDB/tabularis && brew install --cask tabularis  # macOS
sudo snap install tabularis                                      # Linux
```

O kumuha ng installer nang direkta:

[![Windows](https://img.shields.io/badge/Windows-Download-blue?logo=windows)](https://github.com/TabularisDB/tabularis/releases/download/v0.14.0/tabularis_0.14.0_x64-setup.exe) [![macOS (Apple Silicon)](https://img.shields.io/badge/macOS-Apple%20Silicon-black?logo=apple)](https://github.com/TabularisDB/tabularis/releases/download/v0.14.0/tabularis_0.14.0_aarch64.dmg) [![macOS (Intel)](https://img.shields.io/badge/macOS-Intel-black?logo=apple)](https://github.com/TabularisDB/tabularis/releases/download/v0.14.0/tabularis_0.14.0_x64.dmg) [![Linux AppImage](https://img.shields.io/badge/Linux-AppImage-green?logo=linux)](https://github.com/TabularisDB/tabularis/releases/download/v0.14.0/tabularis_0.14.0_amd64.AppImage) [![Linux .deb](https://img.shields.io/badge/Linux-.deb-orange?logo=debian)](https://github.com/TabularisDB/tabularis/releases/download/v0.14.0/tabularis_0.14.0_amd64.deb) [![Linux .rpm](https://img.shields.io/badge/Linux-.rpm-red?logo=redhat)](https://github.com/TabularisDB/tabularis/releases/download/v0.14.0/tabularis-0.13.1-1.x86_64.rpm)

Sinusuportahan ng UI ng app ang Ingles, Italyano, Espanyol, Tsino (Simplified), Pranses, Aleman, Hapones, Ruso, at Tagalog.

## Bakit tabularis?

|  | **tabularis** | DBeaver CE | TablePlus | Beekeeper Studio |
|---|---|---|---|---|
| Lisensya | Apache 2.0, libre | Apache 2.0, libre (may bayad na Pro) | Komersyal | GPLv3 (may bayad na edisyon) |
| SQL notebooks (SQL + Markdown cells, cross-cell variables, charts) | ✅ | ❌ | ❌ | ❌ |
| Built-in MCP server para sa AI agents | ✅ | ❌ | ❌ | ❌ |
| Mga plugin sa **anumang wika** (JSON-RPC sa stdio) | ✅ | Java/Eclipse plugins | JavaScript plugins | ❌ |
| AI text-to-SQL gamit ang **lokal na modelo** (Ollama) | ✅ | Cloud AI assistant | ❌ | ❌ |
| Visual EXPLAIN na may interactive plan graphs | ✅ | ✅ | ❌ | ❌ |
| Mga database out of the box | 3 built-in + 12 opisyal na plugin | 100+ | 20+ | ~10 |

> Paghahambing noong Hunyo 2026; maaaring nagbago ang mga feature ng ibang tool mula noon. Kung kailangan mo ng dose-dosenang driver, gamitin ang DBeaver — nakatuon ang tabularis sa paggawa nang maayos ang ilang database.

### Suporta sa database

Built-in ang PostgreSQL, MySQL/MariaDB at SQLite. Ang lahat ng iba ay plugin; ipinapakita sa ibaba kung nasaan ang bawat integration ngayon, ayon sa [driver coverage at plugins](https://tabularis.dev/#driver-coverage) sa website.

ClickHouse (released), Cloudflare D1 (released), DuckDB (released), Firestore (released), IBM Db2 (released), IBM Informix (released), Redis (released), CSV Folder (released), Google Sheets (released), HackerNews (released), Google BigQuery (claimed), LibSQL / Turso (claimed), Meilisearch (claimed), MongoDB (claimed), Oracle (claimed), SQL Server (claimed), Amazon Redshift (scoped), CockroachDB (scoped), TiDB (scoped), DynamoDB (paparating), Snowflake (paparating), Cassandra (open), Elasticsearch (open), Etcd (open), Firebird (open), ScyllaDB (open), SQL Anywhere (open), SurrealDB (open), at Trino / Presto (open).

> Maaaring i-install ang mga driver na may status na **Released** mula sa [plugin registry](https://tabularis.dev/plugins). Ang lahat ng iba ay nasa [bounty board](https://tabularis.dev/plugins/bounties) — kunin ang isa, i-sponsor, o [mag-request ng database](https://github.com/TabularisDB/tabularis/discussions).

## Pag-install

### Windows

```bash
winget install Debba.Tabularis
```

O i-download ang installer mula sa [Releases](https://github.com/TabularisDB/tabularis/releases).

### macOS

```bash
brew tap TabularisDB/tabularis
brew install --cask tabularis
```

Simula sa **v0.13.1**, signed at notarized ang mga build ng Apple kaya magbubukas nang walang dagdag na hakbang.

Ang mga tala sa ibaba ay para lamang sa mas lumang release (bago ang v0.13.1) na direktang na-download:

- Maaaring kailanganin mong bigyan ng accessibility access (Privacy & Security) ang tabularis app. Kapag nag-a-update at nasa allowed list na ang tabularis, tanggalin ito nang manu-mano bago maibigay ang access sa bagong bersyon.
- Maaaring kailanganin mong patakbuhin:

```bash
xattr -c /Applications/tabularis.app
```

### Linux

Snap:

```bash
sudo snap install tabularis
```

Flatpak:

```bash
flatpak remote-add --if-not-exists flatpark https://dl.flatpark.org/flatpark.flatpakrepo
flatpak install flatpark dev.tabularis.Tabularis
```

AppImage:

```bash
chmod +x tabularis_x.x.x_amd64.AppImage
./tabularis_x.x.x_amd64.AppImage
```

Arch Linux:

```bash
yay -S tabularis-bin
```

## Mga update

- Awtomatikong nagche-check ng update ang app sa startup.
- Maaari ring mag-update nang manu-mano mula sa [GitHub Releases](https://github.com/TabularisDB/tabularis/releases).

## Mga screenshot at demo

Ang mga screenshot at demo ng mga feature ay nasa [tabularis.dev](https://tabularis.dev) sa seksyong Features.

## Mga feature

### Pamamahala ng koneksyon

- Suporta para sa PostgreSQL, MySQL/MariaDB at SQLite.
- Lokal na pag-save ng mga profile ng koneksyon.
- SSH tunnels at pag-iimbak ng password sa system keychain.
- Connections page na may grid at list view at real-time search.

### Database explorer

- Mag-browse ng mga table, column, key, index, view at procedure.
- Built-in na pag-edit ng schema elements.
- Interactive ER diagram.
- Mabilis na aksyon sa context menu.

### SQL editor

- Monaco Editor na may syntax highlighting at autocomplete.
- Mga naka-isolate na tab para sa bawat koneksyon.
- Multi-statement execution na may hiwalay na result display.
- Mga nai-save na query at built-in na AI overlay sa editor.

### SQL notebooks

- SQL at Markdown cells sa isang dokumento.
- Inline results at charts.
- Cross-cell variables at global parameters.
- Sunud-sunod na pagpapatakbo ng lahat ng cell.

### Visual query builder

- Pagbuo ng query gamit ang drag-and-drop.
- Visual JOIN, filter, aggregate, sort at LIMIT.
- Real-time na SQL generation.

### Visual EXPLAIN

- Interactive graph ng execution plan.
- Table view, raw output at opsyonal na AI analysis.
- Suporta para sa PostgreSQL, MySQL/MariaDB at SQLite.

### Data grid

- Inline at batch editing.
- Paglikha, pagpili at pagbura ng row.
- Export sa CSV o JSON.
- Paunang suporta sa spatial data (GEOMETRY).
- JSON/JSONB cell highlighting at dedicated editor window (Tree / Monaco / Raw). Opsyonal bawat koneksyon: i-detect ang JSON sa text columns.

### Logging

- Real-time log viewer sa Settings.
- Filter ayon sa level.
- Export sa `.log` files.
- CLI debug mode: `tabularis --debug`.

### Mga plugin

- External plugin system gamit ang JSON-RPC 2.0 sa stdin/stdout.
- Mag-install ng community drivers nang walang restart.
- Opisyal na registry: [`plugins/registry.json`](./plugins/registry.json).
- Gabay para sa developer: [`plugins/PLUGIN_GUIDE.md`](./plugins/PLUGIN_GUIDE.md).

## Mga setting

Naka-imbak ang configuration sa:

- Linux: `~/.config/tabularis/`
- macOS: `~/Library/Application Support/tabularis/`
- Windows: `%APPDATA%\\tabularis\\`

Pangunahing mga file:

- `connections.json`
- `saved_queries.json`
- `config.json`
- `themes/`
- `preferences/`

Sinusuportahan ng field na `language` sa `config.json` ang mga value na `auto`, `en`, `it`, `es`, `zh`, `fr`, `de`, `ja`, `ru`, `tl`. Para sa auto-detection ng Filipino locale (`fil` / `fil-PH`), gumagamit ang app ng parehong Tagalog na translation.

## AI

Opsyonal na Text-to-SQL at query explanation gamit ang mga provider:

- OpenAI
- Anthropic
- MiniMax
- OpenRouter
- Ollama
- OpenAI-compatible APIs

Dinadownload at naka-cache nang lokal ang listahan ng modelo.

## MCP

Patakbuhin ang built-in MCP server:

```bash
tabularis --mcp
```

Mga suportadong client:

- Claude Desktop
- Cursor
- Windsurf

Mga available na tool:

- `list_connections`
- `list_databases`
- `list_tables`
- `describe_table`
- `run_query`

## Tech stack

- Frontend: React 19, TypeScript, Tailwind CSS v4.
- Backend: Rust, Tauri v2, SQLx.

## Development

I-install ang dependencies at patakbuhin:

```bash
pnpm install
pnpm tauri dev
```

Build:

```bash
pnpm tauri build
```

## Roadmap

- Remote control
- Command palette
- JSON/JSONB editor at viewer
- SQL formatting / Prettier
- Data compare at diff
- Collaboration

## Pag-contribute

Malugod na tinatanggap ang mga kontribusyon — tingnan ang [CONTRIBUTING.md](./CONTRIBUTING.md). Maaari kang magsimula sa:

- [SQL Server driver — implementation roadmap at call for contributors](https://github.com/TabularisDB/tabularis/issues/150)
- [UI design system at visual identity — call for contributors](https://github.com/TabularisDB/tabularis/issues/195)
- Sumulat ng driver plugin sa anumang wika — tingnan ang [Plugin Guide](./plugins/PLUGIN_GUIDE.md)

## Kwento ng proyekto

Nagsimula ang Tabularis bilang eksperimento: hanggang saan makakarating ang AI-assisted development sa pagbuo ng gumaganang tool mula sa simula? Mas malayo kaysa inaasahan — ngayon ay aktibong mina-maintain na proyekto na may regular na release at plugin ecosystem.

## Lisensya

Apache License 2.0

---

<p align="center">
  Nagustuhan mo ang tabularis? <a href="https://github.com/TabularisDB/tabularis">Mag-star sa repo</a> ⭐ — malaking tulong ito sa proyekto.
</p>

<p align="center">
  <a href="https://repostars.dev/?repos=TabularisDB%2Ftabularis&theme=dark">
    <img src="https://repostars.dev/api/embed?repo=TabularisDB%2Ftabularis&theme=dark" alt="RepoStars" />
  </a>
</p>
