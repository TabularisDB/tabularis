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

Client desktop open source per database moderni. Supporta PostgreSQL, MySQL/MariaDB e SQLite, con notebook SQL, funzioni AI, integrazione MCP e un sistema plugin esterno.

**Discord** - [Entra nel server](https://discord.com/invite/K2hmhfHRSt) per parlare con i maintainer, condividere feedback e ricevere supporto.

> Documento tradotto. Per la versione di riferimento sempre aggiornata, consulta anche il [README in inglese](./README.md).

## Download

[![Windows](https://img.shields.io/badge/Windows-Download-blue?logo=windows)](https://github.com/TabularisDB/tabularis/releases/download/v0.9.18/tabularis_0.9.18_x64-setup.exe)
[![macOS](https://img.shields.io/badge/macOS-Download-black?logo=apple)](https://github.com/TabularisDB/tabularis/releases/download/v0.9.18/tabularis_0.9.18_x64.dmg)
[![Linux AppImage](https://img.shields.io/badge/Linux-AppImage-green?logo=linux)](https://github.com/TabularisDB/tabularis/releases/download/v0.9.18/tabularis_0.9.18_amd64.AppImage)
[![Linux .deb](https://img.shields.io/badge/Linux-.deb-orange?logo=debian)](https://github.com/TabularisDB/tabularis/releases/download/v0.9.18/tabularis_0.9.18_amd64.deb)
[![Linux .rpm](https://img.shields.io/badge/Linux-.rpm-red?logo=redhat)](https://github.com/TabularisDB/tabularis/releases/download/v0.9.18/tabularis-0.9.7-1.x86_64.rpm)

## Installazione

### Windows

```bash
winget install Debba.Tabularis
```

Oppure scarica l’installer dalla [pagina Releases](https://github.com/TabularisDB/tabularis/releases).

### macOS

```bash
brew tap TabularisDB/tabularis
brew install --cask tabularis
```

Se installi da release diretta, potrebbe essere necessario eseguire:

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

## Aggiornamenti

- Aggiornamenti automatici all’avvio con notifica in-app.
- Controllo manuale disponibile tramite release GitHub.

## Galleria

La galleria completa è disponibile su [tabularis.dev](https://tabularis.dev).

## Funzionalità

### Connessioni

- Supporto per PostgreSQL, MySQL/MariaDB e SQLite.
- Profili connessione salvati localmente.
- Tunneling SSH e archiviazione password nel keychain di sistema.
- Pagina connessioni con vista griglia/lista e ricerca in tempo reale.
- Aspetto personalizzato per ogni connessione: icona (Lucide, emoji o immagine) e colore di accento.

### Esplora database

- Navigazione di tabelle, colonne, chiavi, indici, viste e routine.
- Modifica inline di alcuni elementi di schema.
- Diagramma ER interattivo.
- Azioni rapide da menu contestuale.

### Editor SQL

- Monaco Editor con evidenziazione e completamento.
- Tab multipli con connessioni isolate.
- Esecuzione multi-query con risultati separati.
- Query salvate e overlay AI nell’editor.

### Notebook SQL

- Celle SQL e Markdown nello stesso documento.
- Risultati inline e grafici.
- Variabili tra celle e parametri globali.
- Esecuzione sequenziale di tutte le celle.

### Query Builder Visuale

- Composizione query drag-and-drop.
- JOIN visuali, filtri, aggregazioni, ordinamenti e limiti.
- SQL generato in tempo reale.

### Visual EXPLAIN

- Piani di esecuzione come grafi navigabili.
- Vista tabellare, raw e analisi AI opzionale.
- Supporto per PostgreSQL, MySQL/MariaDB e SQLite.

### Data Grid

- Editing inline e batch.
- Creazione, selezione ed eliminazione righe.
- Export in CSV o JSON.
- Supporto iniziale a dati spaziali.
- Celle JSON/JSONB con evidenziazione e finestra di editing dedicata (Tree / Monaco / Raw). Opzionale per connessione: rileva JSON nelle colonne di testo.

### Logging

- Log in tempo reale dalle impostazioni.
- Filtri per livello.
- Export in file `.log`.
- Modalità debug via CLI: `tabularis --debug`.

### Plugin

- Sistema plugin esterno via JSON-RPC 2.0 su stdin/stdout.
- Installazione driver comunitari senza riavvio.
- Registro ufficiale in [`plugins/registry.json`](./plugins/registry.json).
- Guida sviluppo in [`plugins/PLUGIN_GUIDE.md`](./plugins/PLUGIN_GUIDE.md).

## Configurazione

Le impostazioni sono salvate in:

- Linux: `~/.config/tabularis/`
- macOS: `~/Library/Application Support/tabularis/`
- Windows: `%APPDATA%\\tabularis\\`

File principali:

- `connections.json`
- `saved_queries.json`
- `config.json`
- `themes/`
- `preferences/`
- `connection-icons/` (immagini personalizzate per le icone di connessione)

In `config.json`, il campo `language` supporta `auto`, `en`, `it`, `es`, `zh`, `fr`, `de`.

## AI

Funzioni opzionali di text-to-SQL e spiegazione query con:

- OpenAI
- Anthropic
- MiniMax
- OpenRouter
- Ollama
- API compatibili OpenAI

I modelli vengono recuperati dinamicamente e cacheati localmente.

## MCP

Avvio server MCP integrato:

```bash
tabularis --mcp
```

Client supportati:

- Claude Desktop
- Cursor
- Windsurf

Strumenti disponibili:

- `list_connections`
- `list_tables`
- `describe_table`
- `run_query`

## Stack Tecnologico

- Frontend: React 19, TypeScript, Tailwind CSS v4
- Backend: Rust, Tauri v2, SQLx

## Sviluppo

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
- Editor/Viewer JSON e JSONB
- SQL Formatting / Prettier
- Data Compare / Diff Tool
- Team Collaboration

## Licenza

Apache License 2.0
