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

Open-Source-Desktop-Client für moderne Datenbanken. Unterstützt PostgreSQL, MySQL/MariaDB und SQLite sowie SQL-Notebooks, KI-Funktionen, MCP-Integration und ein externes Plugin-System.

**Discord** - [Server beitreten](https://discord.com/invite/K2hmhfHRSt), um mit den Maintainers zu sprechen, Feedback zu teilen und Hilfe zu bekommen.

> Übersetztes Dokument. Für die maßgebliche und aktuellste Version siehe auch das [englische README](./README.md).

## Downloads

[![Windows](https://img.shields.io/badge/Windows-Download-blue?logo=windows)](https://github.com/TabularisDB/tabularis/releases/download/v0.9.18/tabularis_0.9.18_x64-setup.exe)
[![macOS](https://img.shields.io/badge/macOS-Download-black?logo=apple)](https://github.com/TabularisDB/tabularis/releases/download/v0.9.18/tabularis_0.9.18_x64.dmg)
[![Linux AppImage](https://img.shields.io/badge/Linux-AppImage-green?logo=linux)](https://github.com/TabularisDB/tabularis/releases/download/v0.9.18/tabularis_0.9.18_amd64.AppImage)
[![Linux .deb](https://img.shields.io/badge/Linux-.deb-orange?logo=debian)](https://github.com/TabularisDB/tabularis/releases/download/v0.9.18/tabularis_0.9.18_amd64.deb)
[![Linux .rpm](https://img.shields.io/badge/Linux-.rpm-red?logo=redhat)](https://github.com/TabularisDB/tabularis/releases/download/v0.9.18/tabularis-0.9.7-1.x86_64.rpm)

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

Bei direkter Installation aus einer Release kann zusätzlich nötig sein:

```bash
xattr -c /Applications/tabularis.app
```

### Linux

Snap:

```bash
sudo snap install tabularis
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

## Lizenz

Apache License 2.0
