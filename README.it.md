<div align="center">
  <img src="public/logo-sm.png" width="120" height="120" />
</div>

# tabularis

<p align="center">
  <strong>Un client database open source per PostgreSQL, MySQL/MariaDB e SQLite.<br />
  Notebook SQL, Visual EXPLAIN, AI e MCP integrati. I plugin aggiungono tutto il resto.</strong>
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

**Discord** - [Entra nel server](https://discord.com/invite/K2hmhfHRSt) per parlare con i maintainer, condividere feedback e ricevere supporto.

> Documento tradotto. Per la versione di riferimento sempre aggiornata, consulta anche il [README in inglese](./README.md).

## Download

```bash
winget install Debba.Tabularis                                   # Windows
brew tap TabularisDB/tabularis && brew install --cask tabularis  # macOS
sudo snap install tabularis                                      # Linux
```

Oppure scarica direttamente un installer:

[![Windows](https://img.shields.io/badge/Windows-Download-blue?logo=windows)](https://github.com/TabularisDB/tabularis/releases/download/v0.13.1/tabularis_0.13.1_x64-setup.exe) [![macOS (Apple Silicon)](https://img.shields.io/badge/macOS-Apple%20Silicon-black?logo=apple)](https://github.com/TabularisDB/tabularis/releases/download/v0.13.1/tabularis_0.13.1_aarch64.dmg) [![macOS (Intel)](https://img.shields.io/badge/macOS-Intel-black?logo=apple)](https://github.com/TabularisDB/tabularis/releases/download/v0.13.1/tabularis_0.13.1_x64.dmg) [![Linux AppImage](https://img.shields.io/badge/Linux-AppImage-green?logo=linux)](https://github.com/TabularisDB/tabularis/releases/download/v0.13.1/tabularis_0.13.1_amd64.AppImage) [![Linux .deb](https://img.shields.io/badge/Linux-.deb-orange?logo=debian)](https://github.com/TabularisDB/tabularis/releases/download/v0.13.1/tabularis_0.13.1_amd64.deb) [![Linux .rpm](https://img.shields.io/badge/Linux-.rpm-red?logo=redhat)](https://github.com/TabularisDB/tabularis/releases/download/v0.13.1/tabularis-0.13.1-1.x86_64.rpm)

L’interfaccia dell’app è disponibile in inglese, italiano, spagnolo, cinese (semplificato), francese, tedesco, giapponese e russo.

## Perché tabularis?

|  | **tabularis** | DBeaver CE | TablePlus | Beekeeper Studio |
|---|---|---|---|---|
| Licenza | Apache 2.0, gratuito | Apache 2.0, gratuito (Pro a pagamento) | Commerciale | GPLv3 (edizioni a pagamento) |
| Notebook SQL (celle SQL + Markdown, variabili tra celle, grafici) | ✅ | ❌ | ❌ | ❌ |
| Server MCP integrato per agenti AI | ✅ | ❌ | ❌ | ❌ |
| Plugin in **qualsiasi linguaggio** (JSON-RPC su stdio) | ✅ | Plugin Java/Eclipse | Plugin JavaScript | ❌ |
| Text-to-SQL AI con **modelli locali** (Ollama) | ✅ | Assistente AI basato su cloud | ❌ | ❌ |
| Visual EXPLAIN con grafi interattivi del piano | ✅ | ✅ | ❌ | ❌ |
| Database supportati nativamente | 3 (+ qualsiasi via plugin) | 100+ | 20+ | ~10 |

> Confronto aggiornato a giugno 2026; le funzionalità degli altri strumenti potrebbero essere cambiate nel frattempo. Se ti servono decine di driver, usa DBeaver — tabularis si concentra sul supportare bene pochi database.

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

## Contribuire

I contributi sono benvenuti — consulta [CONTRIBUTING.md](./CONTRIBUTING.md). Buoni punti di partenza:

- [Driver SQL Server — roadmap di implementazione e ricerca contributor](https://github.com/TabularisDB/tabularis/issues/150)
- [Design system UI e identità visiva — ricerca contributor](https://github.com/TabularisDB/tabularis/issues/195)
- Scrivi un plugin driver in qualsiasi linguaggio — vedi la [Plugin Guide](./plugins/PLUGIN_GUIDE.md)

## Le origini del progetto

Tabularis è nato come esperimento: fino a che punto poteva arrivare lo sviluppo assistito dall’AI nel costruire da zero uno strumento funzionante? Più lontano del previsto — oggi è un progetto attivamente mantenuto, con release regolari e un ecosistema di plugin.

## Licenza

Apache License 2.0

---

<p align="center">
  Ti piace tabularis? <a href="https://github.com/TabularisDB/tabularis">Metti una stella al repo</a> ⭐ — aiuta molto il progetto.
</p>

<p align="center">
  <a href="https://repostars.dev/?repos=TabularisDB%2Ftabularis&theme=dark">
    <img src="https://repostars.dev/api/embed?repo=TabularisDB%2Ftabularis&theme=dark" alt="RepoStars" />
  </a>
</p>
