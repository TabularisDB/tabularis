<br />
<p align="center">
  <img src=".github/assets/banner-light.it.png#gh-light-mode-only" alt="Tabularis" width="100%">
  <img src=".github/assets/banner-dark.it.png#gh-dark-mode-only" alt="Tabularis" width="100%">
</p>

# Tabularis

Tabularis è un workspace SQL desktop open source con 3 driver di database integrati e 21 plugin pubblicati, tra cui DuckDB, ClickHouse, Redis e Firestore. Il suo server MCP integrato permette a Claude, Cursor e Devin (ex Windsurf) di leggere il tuo schema ed eseguire query nella stessa app che usi già.

<p align="center">
  <b><a href="https://tabularis.dev">Sito web</a></b> ·
  <b><a href="https://tabularis.dev/wiki">Documentazione</a></b> ·
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
> Documento tradotto. Per la versione di riferimento sempre aggiornata, consulta il [README in inglese](./README.md).

<br />

<div align="center">
  <img src="https://raw.githubusercontent.com/TabularisDB/website/main/public/img/overview.gif" alt="Tabularis, un workspace SQL desktop, con editor di query e griglia dati" />
</div>

## Download

```bash
winget install Debba.Tabularis    # Windows
brew install --cask tabularis     # macOS
sudo snap install tabularis       # Linux
```

Oppure scarica direttamente un installer:

- **Windows:** &nbsp;[![Windows](https://img.shields.io/badge/Windows-Download-blue?logo=windows)](https://github.com/TabularisDB/tabularis/releases/download/v0.26.0/tabularis_0.26.0_x64-setup.exe)

- **macOS:** &nbsp;[![macOS (Apple Silicon)](https://img.shields.io/badge/macOS-Apple%20Silicon-black?logo=apple)](https://github.com/TabularisDB/tabularis/releases/download/v0.26.0/tabularis_0.26.0_aarch64.dmg)&nbsp;[![macOS (Intel)](https://img.shields.io/badge/macOS-Intel-black?logo=apple)](https://github.com/TabularisDB/tabularis/releases/download/v0.26.0/tabularis_0.26.0_x64.dmg)

- **Linux:** &nbsp;[![Linux AppImage](https://img.shields.io/badge/Linux-AppImage-green?logo=linux)](https://github.com/TabularisDB/tabularis/releases/download/v0.26.0/tabularis_0.26.0_amd64.AppImage)&nbsp;[![Linux .deb](https://img.shields.io/badge/Linux-.deb-orange?logo=debian)](https://github.com/TabularisDB/tabularis/releases/download/v0.26.0/tabularis_0.26.0_amd64.deb)&nbsp;[![Linux .rpm](https://img.shields.io/badge/Linux-.rpm-red?logo=redhat)](https://github.com/TabularisDB/tabularis/releases/download/v0.26.0/tabularis-0.26.0-1.x86_64.rpm)

L’interfaccia dell’app è disponibile in inglese, italiano, spagnolo, cinese (semplificato), francese, tedesco, giapponese, russo, coreano, tagalog e portoghese (brasiliano).

> [!TIP]
> **Discord:** [Entra nel server](https://discord.com/invite/K2hmhfHRSt) per parlare con i maintainer, condividere feedback e ricevere supporto.

## Perché tabularis?

|                                                                   |         **tabularis**          |               DBeaver CE               |     TablePlus     |       Beekeeper Studio       |
| ----------------------------------------------------------------- | :----------------------------: | :------------------------------------: | :---------------: | :--------------------------: |
| Licenza                                                           |      Apache 2.0, gratuito      | Apache 2.0, gratuito (Pro a pagamento) |    Commerciale    | GPLv3 (edizioni a pagamento) |
| Notebook SQL (celle SQL + Markdown, variabili tra celle, grafici) |               ✅               |                   ❌                   |        ❌         |              ❌              |
| Server MCP integrato per agenti AI                                |               ✅               |                   ❌                   |        ❌         |              ❌              |
| Plugin in **qualsiasi linguaggio** (JSON-RPC su stdio)            |               ✅               |          Plugin Java/Eclipse           | Plugin JavaScript |              ❌              |
| Text-to-SQL AI con **modelli locali** (Ollama)                    |               ✅               |     Assistente AI basato su cloud      |        ❌         |              ❌              |
| Visual EXPLAIN con grafi interattivi del piano                    |               ✅               |                   ✅                   |        ❌         |              ❌              |
| Database supportati nativamente                                   | 3 nativi + 21 plugin ufficiali |                  100+                  |        20+        |             ~10              |

> [!NOTE]
> Confronto aggiornato a giugno 2026; le funzionalità degli altri strumenti potrebbero essere cambiate nel frattempo. Se ti servono decine di driver, usa DBeaver. Tabularis si concentra sul supportare bene pochi database.

### Database supportati

PostgreSQL, MySQL/MariaDB e SQLite sono integrati nativamente. Il driver PostgreSQL integrato è deprecato in favore del [plugin PostgreSQL](https://github.com/TabularisDB/tabularis-postgresql-plugin), che Tabularis installa automaticamente. Tutto il resto è un plugin. Lo stato attuale rispecchia la [copertura driver & plugin](https://tabularis.dev/#driver-coverage) sul sito:

**Disponibili**

| Database                 | Plugin                                                                                          | Database       | Plugin                                                                                          |
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

**Sulla bacheca delle taglie**

| Stato     | Database                                                                     |
| --------- | ---------------------------------------------------------------------------- |
| Assegnato | Google BigQuery, Meilisearch                                                 |
| Definito  | Amazon Redshift, CockroachDB, TiDB                                           |
| In arrivo | Snowflake                                                                    |
| Aperto    | Cassandra, Etcd, Firebird, ScyllaDB, SQL Anywhere, SurrealDB, Trino / Presto |

> [!NOTE]
> I driver **disponibili** sono installabili dal [registro dei plugin](https://tabularis.dev/plugins). Tutto il resto è sulla [bacheca delle taglie](https://tabularis.dev/plugins/bounties): prendine una in carico, sponsorizzala o [richiedi un database](https://github.com/TabularisDB/tabularis/discussions).

## Installazione

### Windows

```bash
winget install Debba.Tabularis
```

Oppure scarica l’installer dalla [pagina Releases](https://github.com/TabularisDB/tabularis/releases).

### macOS

```bash
brew install --cask tabularis
```

Le build dalla **v0.13.1** in poi sono firmate e autenticate (notarized) da Apple, quindi si aprono senza passaggi aggiuntivi.

<details>
<summary>Note per le release precedenti alla v0.13.1</summary>

<br />

Le note seguenti valgono solo per le release più vecchie (precedenti alla v0.13.1) scaricate direttamente:

- Devi concedere l’accesso all’accessibilità (Privacy e sicurezza) all’app tabularis. Se stai aggiornando e tabularis è già nell’elenco delle app consentite, dovrai rimuoverla manualmente prima di poter concedere l’accesso alla nuova versione.
- Dopo aver copiato l’app nella cartella Applicazioni, potrebbe essere necessario eseguire:

```bash
xattr -c /Applications/tabularis.app
```

</details>

### Linux

**Snap**

```bash
sudo snap install tabularis
sudo snap connect tabularis:password-manager-service   # accesso al keychain per le credenziali salvate
```

> [!IMPORTANT]
> L’interfaccia `password-manager-service` non viene ancora connessa automaticamente dallo Snap Store. Senza di essa, il salvataggio di una connessione fallisce con l’errore `Platform secure storage failure`.

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

## Aggiornamenti

- Controllo automatico degli aggiornamenti all’avvio.
- Aggiornamento manuale disponibile tramite release GitHub.

## Galleria

La galleria completa è disponibile su [tabularis.dev](https://tabularis.dev).

## Funzionalità

### Connessioni

<sub>[Riferimento completo su tabularis.dev →](https://tabularis.dev/wiki/connections)</sub>

- Supporto per PostgreSQL, MySQL/MariaDB e SQLite.
- Profili connessione salvati localmente.
- Tunneling SSH e archiviazione password nel keychain di sistema.
- Pagina connessioni con vista griglia/lista e ricerca in tempo reale.
- Aspetto personalizzato per ogni connessione: icona (Lucide, emoji o immagine) e colore di accento.

### Esplora database

<sub>[Riferimento completo su tabularis.dev →](https://tabularis.dev/wiki/schema-management)</sub>

- Navigazione di tabelle, colonne, chiavi, indici, viste e routine.
- Modifica inline di alcuni elementi di schema.
- Diagramma ER interattivo.
- Azioni rapide da menu contestuale.

### Editor SQL

<sub>[Riferimento completo su tabularis.dev →](https://tabularis.dev/wiki/editor)</sub>

- Monaco Editor con evidenziazione e completamento.
- Tab multipli con connessioni isolate.
- Esecuzione multi-query con risultati separati.
- Query salvate e overlay AI nell’editor.

### Notebook SQL

<sub>[Riferimento completo su tabularis.dev →](https://tabularis.dev/wiki/notebooks)</sub>

- Celle SQL e Markdown nello stesso documento.
- Risultati inline e grafici.
- Variabili tra celle e parametri globali.
- Esecuzione sequenziale di tutte le celle.

### Query Builder Visuale

<sub>[Riferimento completo su tabularis.dev →](https://tabularis.dev/wiki/visual-query-builder)</sub>

- Composizione query drag-and-drop.
- JOIN visuali, filtri, aggregazioni, ordinamenti e limiti.
- SQL generato in tempo reale.

### Visual EXPLAIN

<sub>[Riferimento completo su tabularis.dev →](https://tabularis.dev/wiki/visual-explain)</sub>

- Piani di esecuzione come grafi navigabili.
- Vista tabellare, raw e analisi AI opzionale.
- Supporto per PostgreSQL, MySQL/MariaDB e SQLite.

### Data Grid

<sub>[Riferimento completo su tabularis.dev →](https://tabularis.dev/wiki/data-grid)</sub>

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

<sub>[Riferimento completo su tabularis.dev →](https://tabularis.dev/wiki/plugins)</sub>

- Sistema plugin esterno via JSON-RPC 2.0 su stdin/stdout.
- Installazione driver comunitari senza riavvio.
- Registro ufficiale in [`plugins/registry.json`](./plugins/registry.json).
- Guida sviluppo in [`plugins/PLUGIN_GUIDE.md`](./plugins/PLUGIN_GUIDE.md).

## Configurazione

<sub>[Riferimento completo su tabularis.dev →](https://tabularis.dev/wiki/configuration)</sub>

Le impostazioni sono salvate in:

- Linux: `~/.config/tabularis/`
- macOS: `~/Library/Application Support/tabularis/`
- Windows: `%APPDATA%\tabularis\`

File principali:

- `connections.json`
- `saved_queries.json`
- `config.json`
- `themes/`
- `preferences/`
- `connection-icons/` (immagini personalizzate per le icone di connessione)

In `config.json`, il campo `language` supporta `auto`, `en`, `it`, `es`, `zh`, `fr`, `de`, `ja`, `ru`, `ko`, `tl` e `pt-BR`.

## AI

<sub>[Riferimento completo su tabularis.dev →](https://tabularis.dev/wiki/ai-assistant)</sub>

Funzioni opzionali di text-to-SQL e spiegazione query con:

- OpenAI
- Anthropic
- MiniMax
- OpenRouter
- Ollama
- API compatibili OpenAI

I modelli vengono recuperati dinamicamente e cacheati localmente.

## MCP

<sub>[Riferimento completo su tabularis.dev →](https://tabularis.dev/wiki/mcp-server)</sub>

Avvio server MCP integrato:

```bash
tabularis --mcp
```

Client supportati:

- Claude Desktop
- Cursor
- Windsurf

Strumenti disponibili:

| Strumento          | Descrizione                                                     |
| ------------------ | --------------------------------------------------------------- |
| `list_connections` | Elenca tutte le connessioni salvate                             |
| `list_databases`   | Elenca tutti i database di una connessione                      |
| `list_tables`      | Elenca le tabelle di una connessione (filtrabili per schema)    |
| `describe_table`   | Restituisce lo schema completo: colonne, indici, chiavi esterne |
| `run_query`        | Esegue qualsiasi query SQL e restituisce i risultati            |

## Stack Tecnologico

| Livello  | Stack                                 |
| -------- | ------------------------------------- |
| Frontend | React 19, TypeScript, Tailwind CSS v4 |
| Backend  | Rust, Tauri v2, SQLx                  |

## Sviluppo

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

La roadmap viene generata automaticamente dalle issue di GitHub. Consulta lo stato attuale nel [README in inglese](./README.md#roadmap).

## Contribuire

I contributi sono benvenuti, consulta [CONTRIBUTING.md](./CONTRIBUTING.md). Buoni punti di partenza:

- [Plugin driver SQL Server: prova il driver e prendi in carico le issue aperte](https://github.com/TabularisDB/tabularis-sqlserver-plugin)
- [Design system UI e identità visiva: ricerca contributor](https://github.com/TabularisDB/tabularis/issues/195)
- Scrivi un plugin driver in qualsiasi linguaggio con la [Plugin Guide](./plugins/PLUGIN_GUIDE.md)

## Sponsor e sostenitori

Tabularis è sostenuto da sponsor e sostenitori fantastici. Trovi l’elenco completo nel [README in inglese](./README.md#sponsors-and-supporters) e su [tabularis.dev/sponsors](https://tabularis.dev/sponsors).

## Le origini del progetto

Tabularis è nato come esperimento: fino a che punto poteva arrivare lo sviluppo assistito dall’AI nel costruire da zero uno strumento funzionante? Più lontano del previsto: oggi è un progetto attivamente mantenuto, con release regolari e un ecosistema di plugin.

## Licenza

[Apache License 2.0](./LICENSE)

---

<p align="center">
  Ti piace tabularis? <a href="https://github.com/TabularisDB/tabularis">Metti una stella al repo</a> ⭐, aiuta molto il progetto.
</p>

<p align="center">
  <a href="https://repostars.dev/?repos=TabularisDB%2Ftabularis&theme=dark">
    <img src="https://repostars.dev/api/embed?repo=TabularisDB%2Ftabularis&theme=dark" alt="RepoStars" />
  </a>
</p>
