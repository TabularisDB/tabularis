<div align="center">
  <img src="public/logo-sm.png" width="120" height="120" />
</div>

# tabularis

<p align="center">
  <strong>Tabularis ist ein quelloffener Desktop-SQL-Workspace für PostgreSQL, MySQL/MariaDB, SQLite und über 12 weitere Datenbanken wie DuckDB, ClickHouse, Redis und Firestore.<br />
  Dank des integrierten MCP-Servers können Claude, Cursor und Devin (vormals Windsurf) dein Schema lesen und Abfragen ausführen — direkt in der App, die du ohnehin schon nutzt.</strong>
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
  <a href="./README.ru.md">Русский</a>
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

**Discord** - [Server beitreten](https://discord.com/invite/K2hmhfHRSt), um mit den Maintainers zu sprechen, Feedback zu teilen und Hilfe zu bekommen.

> Übersetztes Dokument. Für die maßgebliche und aktuellste Version siehe auch das [englische README](./README.md).

## Downloads

```bash
winget install Debba.Tabularis                                   # Windows
brew tap TabularisDB/tabularis && brew install --cask tabularis  # macOS
sudo snap install tabularis                                      # Linux
```

Oder lade direkt einen Installer herunter:

[![Windows](https://img.shields.io/badge/Windows-Download-blue?logo=windows)](https://github.com/TabularisDB/tabularis/releases/download/v0.13.1/tabularis_0.13.1_x64-setup.exe) [![macOS (Apple Silicon)](https://img.shields.io/badge/macOS-Apple%20Silicon-black?logo=apple)](https://github.com/TabularisDB/tabularis/releases/download/v0.13.1/tabularis_0.13.1_aarch64.dmg) [![macOS (Intel)](https://img.shields.io/badge/macOS-Intel-black?logo=apple)](https://github.com/TabularisDB/tabularis/releases/download/v0.13.1/tabularis_0.13.1_x64.dmg) [![Linux AppImage](https://img.shields.io/badge/Linux-AppImage-green?logo=linux)](https://github.com/TabularisDB/tabularis/releases/download/v0.13.1/tabularis_0.13.1_amd64.AppImage) [![Linux .deb](https://img.shields.io/badge/Linux-.deb-orange?logo=debian)](https://github.com/TabularisDB/tabularis/releases/download/v0.13.1/tabularis_0.13.1_amd64.deb) [![Linux .rpm](https://img.shields.io/badge/Linux-.rpm-red?logo=redhat)](https://github.com/TabularisDB/tabularis/releases/download/v0.13.1/tabularis-0.13.1-1.x86_64.rpm)

Die Benutzeroberfläche der App ist auf Englisch, Italienisch, Spanisch, Chinesisch (vereinfacht), Französisch, Deutsch, Japanisch und Russisch verfügbar.

## Warum tabularis?

|  | **tabularis** | DBeaver CE | TablePlus | Beekeeper Studio |
|---|---|---|---|---|
| Lizenz | Apache 2.0, kostenlos | Apache 2.0, kostenlos (Pro ist kostenpflichtig) | Kommerziell | GPLv3 (kostenpflichtige Editionen) |
| SQL-Notebooks (SQL- + Markdown-Zellen, zellübergreifende Variablen, Diagramme) | ✅ | ❌ | ❌ | ❌ |
| Integrierter MCP-Server für KI-Agenten | ✅ | ❌ | ❌ | ❌ |
| Plugins in **jeder Sprache** (JSON-RPC über stdio) | ✅ | Java-/Eclipse-Plugins | JavaScript-Plugins | ❌ |
| KI-Text-to-SQL mit **lokalen Modellen** (Ollama) | ✅ | Cloud-basierter KI-Assistent | ❌ | ❌ |
| Visual EXPLAIN mit interaktiven Plan-Graphen | ✅ | ✅ | ❌ | ❌ |
| Datenbanken ab Werk | 3 integriert + 12 offizielle Plugins | 100+ | 20+ | ~10 |

> Vergleich mit Stand Juni 2026; die Funktionen anderer Tools können sich seitdem geändert haben. Wer Dutzende Treiber braucht, ist mit DBeaver besser bedient — tabularis konzentriert sich darauf, wenige Datenbanken gut zu unterstützen.

### Datenbankunterstützung

PostgreSQL, MySQL/MariaDB und SQLite sind integriert. Alles andere ist ein Plugin — hier siehst du, wo jede Integration heute steht; dies entspricht der [Treiber- & Plugin-Abdeckung](https://tabularis.dev/#driver-coverage) auf der Website.

ClickHouse (veröffentlicht), Cloudflare D1 (veröffentlicht), DuckDB (veröffentlicht), Firestore (veröffentlicht), IBM Db2 (veröffentlicht), IBM Informix (veröffentlicht), Redis (veröffentlicht), CSV Folder (veröffentlicht), Google Sheets (veröffentlicht), HackerNews (veröffentlicht), Google BigQuery (übernommen), LibSQL / Turso (übernommen), Meilisearch (übernommen), MongoDB (übernommen), Oracle (übernommen), SQL Server (übernommen), Amazon Redshift (spezifiziert), CockroachDB (spezifiziert), TiDB (spezifiziert), DynamoDB (demnächst), Snowflake (demnächst), Cassandra (offen), Elasticsearch (offen), Etcd (offen), Firebird (offen), ScyllaDB (offen), SQL Anywhere (offen), SurrealDB (offen) und Trino / Presto (offen).

> **Veröffentlichte** Treiber lassen sich aus der [Plugin-Registry](https://tabularis.dev/plugins) installieren. Alles andere steht auf dem [Bounty-Board](https://tabularis.dev/plugins/bounties) — übernimm eines, sponsere eines oder [fordere eine Datenbank an](https://github.com/TabularisDB/tabularis/discussions).

## Installation

### Windows

```bash
winget install Debba.Tabularis
```

Alternativ den Installer von der [Releases-Seite](https://github.com/TabularisDB/tabularis/releases) herunterladen.

### macOS

```bash
brew tap TabularisDB/tabularis
brew install --cask tabularis
```

Builds ab **v0.13.1** sind von Apple signiert und notarisiert und lassen sich daher ohne zusätzliche Schritte öffnen.

Die folgenden Hinweise gelten nur für ältere Releases (vor v0.13.1), die direkt heruntergeladen wurden:

- Du musst tabularis den Bedienungshilfen-Zugriff gewähren (Datenschutz & Sicherheit). Bei einem Upgrade, wenn tabularis bereits in der Liste der erlaubten Apps steht, musst du den alten Eintrag manuell entfernen, bevor der neuen Version der Bedienungshilfen-Zugriff gewährt werden kann.
- Nach dem Kopieren der App in den Programme-Ordner kann zusätzlich nötig sein:

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

## Updates

- Automatische Update-Prüfung beim Start.
- Manuelles Update über GitHub Releases möglich.

## Galerie

Die vollständige Galerie findest du auf [tabularis.dev](https://tabularis.dev).

## Funktionen

### Verbindungen

- Unterstützung für PostgreSQL, MySQL/MariaDB und SQLite.
- Lokal gespeicherte Verbindungsprofile.
- SSH-Tunnel und Passwortspeicherung im System-Keychain.
- Verbindungsseite mit Grid-/Listenansicht und Echtzeitsuche.
- Individuelles Erscheinungsbild pro Verbindung: eigenes Icon (Lucide, Emoji oder eigenes Bild) und Akzentfarbe.

### Datenbank-Explorer

- Navigation durch Tabellen, Spalten, Schlüssel, Indizes, Views und Routinen.
- Inline-Bearbeitung ausgewählter Schemaelemente.
- Interaktives ER-Diagramm.
- Schnellaktionen über Kontextmenüs.

### SQL-Editor

- Monaco Editor mit Syntax-Highlighting und Autocomplete.
- Mehrere Tabs mit isolierten Verbindungen.
- Multi-Query-Ausführung mit getrennten Ergebnissen.
- Gespeicherte Abfragen und KI-Overlay im Editor.

### SQL-Notebooks

- SQL- und Markdown-Zellen im selben Dokument.
- Inline-Ergebnisse und Diagramme.
- Variablen zwischen Zellen und globale Parameter.
- Sequenzielle Ausführung aller Zellen.

### Visueller Query Builder

- Drag-and-Drop-Aufbau von Abfragen.
- Visuelle JOINs, Filter, Aggregate, Sortierung und Limits.
- SQL wird in Echtzeit erzeugt.

### Visual EXPLAIN

- Ausführungspläne als navigierbare Graphen.
- Tabellenansicht, Rohansicht und optionale KI-Analyse.
- Unterstützung für PostgreSQL, MySQL/MariaDB und SQLite.

### Data Grid

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

- Externes Plugin-System über JSON-RPC 2.0 via stdin/stdout.
- Community-Treiber ohne Neustart installierbar.
- Offizielles Registry-File: [`plugins/registry.json`](./plugins/registry.json).
- Entwicklerleitfaden: [`plugins/PLUGIN_GUIDE.md`](./plugins/PLUGIN_GUIDE.md).

## Konfiguration

Die Konfiguration wird gespeichert in:

- Linux: `~/.config/tabularis/`
- macOS: `~/Library/Application Support/tabularis/`
- Windows: `%APPDATA%\\tabularis\\`

Wichtige Dateien:

- `connections.json`
- `saved_queries.json`
- `config.json`
- `themes/`
- `preferences/`
- `connection-icons/` (eigene Bilder für Verbindungs-Icons)

In `config.json` unterstützt das Feld `language` die Werte `auto`, `en`, `it`, `es`, `zh`, `fr`, `de`.

## KI

Optionale Text-to-SQL- und Query-Erklärungsfunktionen mit:

- OpenAI
- Anthropic
- MiniMax
- OpenRouter
- Ollama
- OpenAI-kompatiblen APIs

Modelle werden dynamisch geladen und lokal gecacht.

## MCP

Integrierten MCP-Server starten:

```bash
tabularis --mcp
```

Unterstützte Clients:

- Claude Desktop
- Cursor
- Windsurf

Verfügbare Tools:

- `list_connections`
- `list_tables`
- `describe_table`
- `run_query`

## Tech-Stack

- Frontend: React 19, TypeScript, Tailwind CSS v4
- Backend: Rust, Tauri v2, SQLx

## Entwicklung

Setup:

```bash
pnpm install
pnpm tauri dev
```

Build:

```bash
pnpm tauri build
```

## Roadmap

- Remote Control
- Command Palette
- JSON/JSONB-Editor und -Viewer
- SQL Formatting / Prettier
- Data Compare / Diff Tool
- Team Collaboration

## Mitwirken

Beiträge sind willkommen — siehe [CONTRIBUTING.md](./CONTRIBUTING.md). Gute Einstiegspunkte:

- [SQL-Server-Treiber — Implementierungs-Roadmap & Aufruf an Mitwirkende](https://github.com/TabularisDB/tabularis/issues/150)
- [UI-Designsystem & visuelle Identität — Aufruf an Mitwirkende](https://github.com/TabularisDB/tabularis/issues/195)
- Schreibe ein Treiber-Plugin in einer beliebigen Sprache — siehe den [Plugin Guide](./plugins/PLUGIN_GUIDE.md)

## Entstehungsgeschichte

Tabularis begann als Experiment: Wie weit kommt KI-gestützte Entwicklung beim Aufbau eines funktionierenden Tools von Grund auf? Weiter als erwartet — inzwischen ist es ein aktiv gepflegtes Projekt mit regelmäßigen Releases und einem Plugin-Ökosystem.

## Lizenz

Apache License 2.0

---

<p align="center">
  Gefällt dir tabularis? Gib dem <a href="https://github.com/TabularisDB/tabularis">Repo einen Stern</a> ⭐ — das hilft dem Projekt sehr.
</p>

<p align="center">
  <a href="https://repostars.dev/?repos=TabularisDB%2Ftabularis&theme=dark">
    <img src="https://repostars.dev/api/embed?repo=TabularisDB%2Ftabularis&theme=dark" alt="RepoStars" />
  </a>
</p>
