<br />
<p align="center">
  <img src=".github/assets/banner-light.de.png#gh-light-mode-only" alt="Tabularis" width="100%">
  <img src=".github/assets/banner-dark.de.png#gh-dark-mode-only" alt="Tabularis" width="100%">
</p>

# Tabularis

Tabularis ist ein quelloffener Desktop-SQL-Workspace mit 3 integrierten Datenbanktreibern und 21 veröffentlichten Plugins, darunter DuckDB, ClickHouse, Redis und Firestore. Dank des integrierten MCP-Servers können Claude, Cursor und Devin (vormals Windsurf) dein Schema lesen und Abfragen ausführen, direkt in der App, die du ohnehin schon nutzt.

<p align="center">
  <b><a href="https://tabularis.dev">Website</a></b> ·
  <b><a href="https://tabularis.dev/wiki">Dokumentation</a></b> ·
  <b><a href="https://tabularis.dev/download">Download</a></b> ·
  <b><a href="./CHANGELOG.md">Changelog</a></b>
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
> Übersetztes Dokument. Für die maßgebliche und aktuellste Version siehe das [englische README](./README.md).

<br />

<div align="center">
  <img src="https://raw.githubusercontent.com/TabularisDB/website/main/public/img/overview.gif" alt="Tabularis, ein Desktop-SQL-Workspace, mit Abfrage-Editor und Datentabelle" />
</div>

## Downloads

```bash
winget install Debba.Tabularis    # Windows
brew install --cask tabularis     # macOS
sudo snap install tabularis       # Linux
```

Oder lade direkt einen Installer herunter:

- **Windows:** &nbsp;[![Windows](https://img.shields.io/badge/Windows-Download-blue?logo=windows)](https://github.com/TabularisDB/tabularis/releases/download/v0.27.0/tabularis_0.27.0_x64-setup.exe)

- **macOS:** &nbsp;[![macOS (Apple Silicon)](https://img.shields.io/badge/macOS-Apple%20Silicon-black?logo=apple)](https://github.com/TabularisDB/tabularis/releases/download/v0.27.0/tabularis_0.27.0_aarch64.dmg)&nbsp;[![macOS (Intel)](https://img.shields.io/badge/macOS-Intel-black?logo=apple)](https://github.com/TabularisDB/tabularis/releases/download/v0.27.0/tabularis_0.27.0_x64.dmg)

- **Linux:** &nbsp;[![Linux AppImage](https://img.shields.io/badge/Linux-AppImage-green?logo=linux)](https://github.com/TabularisDB/tabularis/releases/download/v0.27.0/tabularis_0.27.0_amd64.AppImage)&nbsp;[![Linux .deb](https://img.shields.io/badge/Linux-.deb-orange?logo=debian)](https://github.com/TabularisDB/tabularis/releases/download/v0.27.0/tabularis_0.27.0_amd64.deb)&nbsp;[![Linux .rpm](https://img.shields.io/badge/Linux-.rpm-red?logo=redhat)](https://github.com/TabularisDB/tabularis/releases/download/v0.27.0/tabularis-0.27.0-1.x86_64.rpm)

Die Benutzeroberfläche der App ist auf Englisch, Italienisch, Spanisch, Chinesisch (vereinfacht), Französisch, Deutsch, Japanisch, Russisch, Koreanisch, Tagalog und brasilianischem Portugiesisch verfügbar.

> [!TIP]
> **Discord:** [Tritt unserem Server bei](https://discord.com/invite/K2hmhfHRSt), um mit den Maintainern zu sprechen, Feedback zu teilen und Hilfe zu bekommen.

## Warum tabularis?

|                                                                                |            **tabularis**             |                   DBeaver CE                    |     TablePlus      |          Beekeeper Studio          |
| ------------------------------------------------------------------------------ | :----------------------------------: | :---------------------------------------------: | :----------------: | :--------------------------------: |
| Lizenz                                                                         |        Apache 2.0, kostenlos         | Apache 2.0, kostenlos (Pro ist kostenpflichtig) |    Kommerziell     | GPLv3 (kostenpflichtige Editionen) |
| SQL-Notebooks (SQL- + Markdown-Zellen, zellübergreifende Variablen, Diagramme) |                  ✅                  |                       ❌                        |         ❌         |                 ❌                 |
| Integrierter MCP-Server für KI-Agenten                                         |                  ✅                  |                       ❌                        |         ❌         |                 ❌                 |
| Plugins in **jeder Sprache** (JSON-RPC über stdio)                             |                  ✅                  |              Java-/Eclipse-Plugins              | JavaScript-Plugins |                 ❌                 |
| KI-Text-to-SQL mit **lokalen Modellen** (Ollama)                               |                  ✅                  |          Cloud-basierter KI-Assistent           |         ❌         |                 ❌                 |
| Visual EXPLAIN mit interaktiven Plan-Graphen                                   |                  ✅                  |                       ✅                        |         ❌         |                 ❌                 |
| Datenbanken ab Werk                                                            | 3 integriert + 21 offizielle Plugins |                      100+                       |        20+         |                ~10                 |

> [!NOTE]
> Vergleich mit Stand Juni 2026; die Funktionen anderer Tools können sich seitdem geändert haben. Wer Dutzende Treiber braucht, ist mit DBeaver besser bedient. Tabularis konzentriert sich darauf, wenige Datenbanken gut zu unterstützen.

### Datenbankunterstützung

PostgreSQL, MySQL/MariaDB und SQLite sind integriert. Der integrierte PostgreSQL-Treiber ist zugunsten des [PostgreSQL-Plugins](https://github.com/TabularisDB/tabularis-postgresql-plugin) veraltet, das Tabularis automatisch installiert. Alles andere ist ein Plugin. Der aktuelle Stand entspricht der [Treiber- & Plugin-Abdeckung](https://tabularis.dev/#driver-coverage) auf der Website:

**Veröffentlicht**

| Datenbank                | Plugin                                                                                          | Datenbank      | Plugin                                                                                          |
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

**Auf dem Bounty-Board**

| Status       | Datenbanken                                                                  |
| ------------ | ---------------------------------------------------------------------------- |
| Übernommen   | Google BigQuery, Meilisearch                                                 |
| Spezifiziert | Amazon Redshift, CockroachDB, TiDB                                           |
| Demnächst    | Snowflake                                                                    |
| Offen        | Cassandra, Etcd, Firebird, ScyllaDB, SQL Anywhere, SurrealDB, Trino / Presto |

> [!NOTE]
> **Veröffentlichte** Treiber lassen sich aus der [Plugin-Registry](https://tabularis.dev/plugins) installieren. Alles andere steht auf dem [Bounty-Board](https://tabularis.dev/plugins/bounties): übernimm eines, sponsere eines oder [fordere eine Datenbank an](https://github.com/TabularisDB/tabularis/discussions).

## Installation

### Windows

```bash
winget install Debba.Tabularis
```

Alternativ den Installer von der [Releases-Seite](https://github.com/TabularisDB/tabularis/releases) herunterladen.

### macOS

```bash
brew install --cask tabularis
```

Builds ab **v0.13.1** sind von Apple signiert und notarisiert und lassen sich daher ohne zusätzliche Schritte öffnen.

<details>
<summary>Hinweise für Releases vor v0.13.1</summary>

<br />

Die folgenden Hinweise gelten nur für ältere Releases (vor v0.13.1), die direkt heruntergeladen wurden:

- Du musst tabularis den Bedienungshilfen-Zugriff gewähren (Datenschutz & Sicherheit). Bei einem Upgrade, wenn tabularis bereits in der Liste der erlaubten Apps steht, musst du den alten Eintrag manuell entfernen, bevor der neuen Version der Bedienungshilfen-Zugriff gewährt werden kann.
- Nach dem Kopieren der App in den Programme-Ordner kann zusätzlich nötig sein:

```bash
xattr -c /Applications/tabularis.app
```

</details>

### Linux

**Snap**

```bash
sudo snap install tabularis
sudo snap connect tabularis:password-manager-service   # Keychain-Zugriff für gespeicherte Zugangsdaten
```

> [!IMPORTANT]
> Die Schnittstelle `password-manager-service` wird vom Snap Store noch nicht automatisch verbunden. Ohne sie schlägt das Speichern einer Verbindung mit dem Fehler `Platform secure storage failure` fehl.

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

## Updates

- Automatische Update-Prüfung beim Start.
- Manuelles Update über GitHub Releases möglich.

## Galerie

Die vollständige Galerie findest du auf [tabularis.dev](https://tabularis.dev).

## Funktionen

### Verbindungen

<sub>[Vollständige Referenz auf tabularis.dev →](https://tabularis.dev/wiki/connections)</sub>

- Unterstützung für PostgreSQL, MySQL/MariaDB und SQLite.
- Lokal gespeicherte Verbindungsprofile.
- SSH-Tunnel und Passwortspeicherung im System-Keychain.
- Verbindungsseite mit Grid-/Listenansicht und Echtzeitsuche.
- Individuelles Erscheinungsbild pro Verbindung: eigenes Icon (Lucide, Emoji oder eigenes Bild) und Akzentfarbe.

### Datenbank-Explorer

<sub>[Vollständige Referenz auf tabularis.dev →](https://tabularis.dev/wiki/schema-management)</sub>

- Navigation durch Tabellen, Spalten, Schlüssel, Indizes, Views und Routinen.
- Inline-Bearbeitung ausgewählter Schemaelemente.
- Interaktives ER-Diagramm.
- Schnellaktionen über Kontextmenüs.

### SQL-Editor

<sub>[Vollständige Referenz auf tabularis.dev →](https://tabularis.dev/wiki/editor)</sub>

- Monaco Editor mit Syntax-Highlighting und Autocomplete.
- Mehrere Tabs mit isolierten Verbindungen.
- Multi-Query-Ausführung mit getrennten Ergebnissen.
- Gespeicherte Abfragen und KI-Overlay im Editor.

### SQL-Notebooks

<sub>[Vollständige Referenz auf tabularis.dev →](https://tabularis.dev/wiki/notebooks)</sub>

- SQL- und Markdown-Zellen im selben Dokument.
- Inline-Ergebnisse und Diagramme.
- Variablen zwischen Zellen und globale Parameter.
- Sequenzielle Ausführung aller Zellen.

### Visueller Query Builder

<sub>[Vollständige Referenz auf tabularis.dev →](https://tabularis.dev/wiki/visual-query-builder)</sub>

- Drag-and-Drop-Aufbau von Abfragen.
- Visuelle JOINs, Filter, Aggregate, Sortierung und Limits.
- SQL wird in Echtzeit erzeugt.

### Visual EXPLAIN

<sub>[Vollständige Referenz auf tabularis.dev →](https://tabularis.dev/wiki/visual-explain)</sub>

- Ausführungspläne als navigierbare Graphen.
- Tabellenansicht, Rohansicht und optionale KI-Analyse.
- Unterstützung für PostgreSQL, MySQL/MariaDB und SQLite.

### Data Grid

<sub>[Vollständige Referenz auf tabularis.dev →](https://tabularis.dev/wiki/data-grid)</sub>

- Inline- und Batch-Bearbeitung.
- Erstellen, Auswählen und Löschen von Zeilen.
- Export als CSV oder JSON.
- Erste Unterstützung für Geodaten.
- JSON/JSONB-Zellen mit Highlighting und eigenem Editor-Fenster (Tree / Monaco / Raw). Optional pro Verbindung: JSON in Text-Spalten erkennen.

### Logging

- Echtzeit-Logs in den Einstellungen.
- Filter nach Level.
- Export in `.log`-Dateien.
- CLI-Debug-Modus: `tabularis --debug`.

### Plugins

<sub>[Vollständige Referenz auf tabularis.dev →](https://tabularis.dev/wiki/plugins)</sub>

- Externes Plugin-System über JSON-RPC 2.0 via stdin/stdout.
- Community-Treiber ohne Neustart installierbar.
- Offizielles Registry-File: [`plugins/registry.json`](./plugins/registry.json).
- Entwicklerleitfaden: [`plugins/PLUGIN_GUIDE.md`](./plugins/PLUGIN_GUIDE.md).

## Konfiguration

<sub>[Vollständige Referenz auf tabularis.dev →](https://tabularis.dev/wiki/configuration)</sub>

Die Konfiguration wird gespeichert in:

- Linux: `~/.config/tabularis/`
- macOS: `~/Library/Application Support/tabularis/`
- Windows: `%APPDATA%\tabularis\`

Wichtige Dateien:

- `connections.json`
- `saved_queries.json`
- `config.json`
- `themes/`
- `preferences/`
- `connection-icons/` (eigene Bilder für Verbindungs-Icons)

In `config.json` unterstützt das Feld `language` die Werte `auto`, `en`, `it`, `es`, `zh`, `fr`, `de`, `ja`, `ru`, `ko`, `tl` und `pt-BR`.

## KI

<sub>[Vollständige Referenz auf tabularis.dev →](https://tabularis.dev/wiki/ai-assistant)</sub>

Optionale Text-to-SQL- und Query-Erklärungsfunktionen mit:

- OpenAI
- Anthropic
- MiniMax
- OpenRouter
- Ollama
- OpenAI-kompatiblen APIs

Modelle werden dynamisch geladen und lokal gecacht.

## MCP

<sub>[Vollständige Referenz auf tabularis.dev →](https://tabularis.dev/wiki/mcp-server)</sub>

Integrierten MCP-Server starten:

```bash
tabularis --mcp
```

Unterstützte Clients:

- Claude Desktop
- Cursor
- Windsurf

Verfügbare Tools:

| Tool               | Beschreibung                                                         |
| ------------------ | -------------------------------------------------------------------- |
| `list_connections` | Alle gespeicherten Verbindungen auflisten                            |
| `list_databases`   | Alle Datenbanken einer Verbindung auflisten                          |
| `list_tables`      | Tabellen einer Verbindung auflisten (optional nach Schema gefiltert) |
| `describe_table`   | Vollständiges Schema abrufen: Spalten, Indizes, Fremdschlüssel       |
| `run_query`        | Beliebige SQL-Abfrage ausführen und Ergebnisse zurückgeben           |

## Tech-Stack

| Ebene    | Stack                                 |
| -------- | ------------------------------------- |
| Frontend | React 19, TypeScript, Tailwind CSS v4 |
| Backend  | Rust, Tauri v2, SQLx                  |

## Entwicklung

**Setup**

```bash
pnpm install
pnpm tauri dev
```

**Build**

```bash
pnpm tauri build
```

## Roadmap

Die Roadmap wird automatisch aus den GitHub-Issues erzeugt. Den aktuellen Stand findest du im [englischen README](./README.md#roadmap).

## Mitwirken

Beiträge sind willkommen, siehe [CONTRIBUTING.md](./CONTRIBUTING.md). Gute Einstiegspunkte:

- [UI-Designsystem & visuelle Identität: Aufruf an Mitwirkende](https://github.com/TabularisDB/tabularis/issues/195)
- Schreibe ein Treiber-Plugin in einer beliebigen Sprache mit dem [Plugin Guide](./plugins/PLUGIN_GUIDE.md)

## Sponsoren und Unterstützer

Tabularis wird von großartigen Sponsoren und Unterstützern getragen. Die vollständige Liste findest du im [englischen README](./README.md#sponsors-and-supporters) und auf [tabularis.dev/sponsors](https://tabularis.dev/sponsors).

## Entstehungsgeschichte

Tabularis begann als Experiment: Wie weit kommt KI-gestützte Entwicklung beim Aufbau eines funktionierenden Tools von Grund auf? Weiter als erwartet: Inzwischen ist es ein aktiv gepflegtes Projekt mit regelmäßigen Releases und einem Plugin-Ökosystem.

## Lizenz

[Apache License 2.0](./LICENSE)

---

<p align="center">
  Gefällt dir tabularis? Gib dem <a href="https://github.com/TabularisDB/tabularis">Repo einen Stern</a> ⭐, das hilft dem Projekt sehr.
</p>

<p align="center">
  <a href="https://repostars.dev/?repos=TabularisDB%2Ftabularis&theme=dark">
    <img src="https://repostars.dev/api/embed?repo=TabularisDB%2Ftabularis&theme=dark" alt="RepoStars" />
  </a>
</p>
