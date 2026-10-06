<br />
<p align="center">
  <img src=".github/assets/banner-light.fr.png#gh-light-mode-only" alt="Tabularis" width="100%">
  <img src=".github/assets/banner-dark.fr.png#gh-dark-mode-only" alt="Tabularis" width="100%">
</p>

# Tabularis

Tabularis est un espace de travail SQL de bureau open source avec 3 drivers de bases de données intégrés et 21 plugins publiés, dont DuckDB, ClickHouse, Redis et Firestore. Son serveur MCP intégré permet à Claude, Cursor et Devin (anciennement Windsurf) de lire votre schéma et d’exécuter des requêtes dans l’application que vous utilisez déjà.

<p align="center">
  <b><a href="https://tabularis.dev">Site web</a></b> ·
  <b><a href="https://tabularis.dev/wiki">Documentation</a></b> ·
  <b><a href="https://tabularis.dev/download">Téléchargement</a></b> ·
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
> Document traduit. Pour la version de référence la plus à jour, consultez le [README anglais](./README.md).

<br />

<div align="center">
  <img src="https://raw.githubusercontent.com/TabularisDB/website/main/public/img/overview.gif" alt="Tabularis, un espace de travail SQL de bureau, avec l’éditeur de requêtes et la grille de données" />
</div>

## Téléchargements

```bash
winget install Debba.Tabularis    # Windows
brew install --cask tabularis     # macOS
sudo snap install tabularis       # Linux
```

Ou téléchargez directement un installateur :

- **Windows:** &nbsp;[![Windows](https://img.shields.io/badge/Windows-Download-blue?logo=windows)](https://github.com/TabularisDB/tabularis/releases/download/v0.26.0/tabularis_0.26.0_x64-setup.exe)

- **macOS:** &nbsp;[![macOS (Apple Silicon)](https://img.shields.io/badge/macOS-Apple%20Silicon-black?logo=apple)](https://github.com/TabularisDB/tabularis/releases/download/v0.26.0/tabularis_0.26.0_aarch64.dmg)&nbsp;[![macOS (Intel)](https://img.shields.io/badge/macOS-Intel-black?logo=apple)](https://github.com/TabularisDB/tabularis/releases/download/v0.26.0/tabularis_0.26.0_x64.dmg)

- **Linux:** &nbsp;[![Linux AppImage](https://img.shields.io/badge/Linux-AppImage-green?logo=linux)](https://github.com/TabularisDB/tabularis/releases/download/v0.26.0/tabularis_0.26.0_amd64.AppImage)&nbsp;[![Linux .deb](https://img.shields.io/badge/Linux-.deb-orange?logo=debian)](https://github.com/TabularisDB/tabularis/releases/download/v0.26.0/tabularis_0.26.0_amd64.deb)&nbsp;[![Linux .rpm](https://img.shields.io/badge/Linux-.rpm-red?logo=redhat)](https://github.com/TabularisDB/tabularis/releases/download/v0.26.0/tabularis-0.26.0-1.x86_64.rpm)

L’interface de l’application est disponible en anglais, italien, espagnol, chinois (simplifié), français, allemand, japonais, russe, coréen, tagalog et portugais (brésilien).

> [!TIP]
> **Discord :** [Rejoignez le serveur](https://discord.com/invite/K2hmhfHRSt) pour discuter avec les mainteneurs, partager des retours et obtenir de l’aide.

## Pourquoi tabularis ?

|                                                                               |           **tabularis**            |            DBeaver CE            |     TablePlus      |     Beekeeper Studio      |
| ----------------------------------------------------------------------------- | :--------------------------------: | :------------------------------: | :----------------: | :-----------------------: |
| Licence                                                                       |        Apache 2.0, gratuit         | Apache 2.0, gratuit (Pro payant) |    Commerciale     | GPLv3 (éditions payantes) |
| Notebooks SQL (cellules SQL + Markdown, variables entre cellules, graphiques) |                 ✅                 |                ❌                |         ❌         |            ❌             |
| Serveur MCP intégré pour les agents IA                                        |                 ✅                 |                ❌                |         ❌         |            ❌             |
| Plugins dans **n’importe quel langage** (JSON-RPC sur stdio)                  |                 ✅                 |       Plugins Java/Eclipse       | Plugins JavaScript |            ❌             |
| Text-to-SQL par IA avec **modèles locaux** (Ollama)                           |                 ✅                 |    Assistant IA dans le cloud    |         ❌         |            ❌             |
| EXPLAIN visuel avec graphes de plan interactifs                               |                 ✅                 |                ✅                |         ❌         |            ❌             |
| Bases de données prises en charge nativement                                  | 3 intégrées + 21 plugins officiels |               100+               |        20+         |            ~10            |

> [!NOTE]
> Comparaison datée de juin 2026 ; les fonctionnalités des autres outils ont pu évoluer depuis. Si vous avez besoin de dizaines de drivers, utilisez DBeaver. Tabularis se concentre sur bien prendre en charge quelques bases de données.

### Bases de données prises en charge

PostgreSQL, MySQL/MariaDB et SQLite sont intégrés nativement. Le driver PostgreSQL intégré est déprécié au profit du [plugin PostgreSQL](https://github.com/TabularisDB/tabularis-postgresql-plugin), que Tabularis installe automatiquement. Tout le reste est un plugin. Voici l’état actuel, qui reflète la [couverture des drivers et plugins](https://tabularis.dev/#driver-coverage) sur le site web :

**Disponibles**

| Base de données          | Plugin                                                                                          | Base de données | Plugin                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------- |
| ClickHouse               | [tabularis-clickhouse-plugin](https://github.com/TabularisDB/tabularis-clickhouse-plugin)       | LibSQL / Turso  | [tabularis-libsql-plugin](https://github.com/TabularisDB/tabularis-libsql-plugin)               |
| Cloudflare D1            | [tabularis_cloudflare_d1_plugin](https://github.com/josejorge/tabularis_cloudflare_d1_plugin)   | MongoDB         | [tabularis-mongodb-plugin](https://github.com/danielnuld/tabularis-mongodb-plugin)              |
| Cloudflare D1 (HTTP API) | [cloudflare-tabularis](https://github.com/GabrielMalava/cloudflare-tabularis)                   | MongoDB Atlas   | [tabularis-mongodb-plugin](https://github.com/TabularisDB/tabularis-mongodb-plugin)             |
| DM / Dameng              | [tabularis-dameng-plugin](https://github.com/haos666/tabularis-dameng-plugin)                   | Oracle          | [tabularis-oracle-plugin](https://github.com/TabularisDB/tabularis-oracle-plugin)               |
| DuckDB                   | [tabularis-duckdb-plugin](https://github.com/TabularisDB/tabularis-duckdb-plugin)               | Redis (Go)      | [tabularis-redis-plugin-go](https://github.com/gzamboni/tabularis-redis-plugin-go)              |
| DynamoDB                 | [tabularis-dynamodb-plugin](https://github.com/TabularisDB/tabularis-dynamodb-plugin)           | Redis (Rust)    | [tabularis-redis-plugin](https://github.com/nicholas-papachriston/tabularis-redis-plugin)       |
| Elasticsearch            | [tabularis-elasticsearch-plugin](https://github.com/TabularisDB/tabularis-elasticsearch-plugin) | SQL Server      | [tabularis-sqlserver-plugin](https://github.com/TabularisDB/tabularis-sqlserver-plugin)         |
| Firestore                | [firestore-tabularis](https://codeberg.org/NewtTheWolf/firestore-tabularis)                     | CSV Folder      | [tabularis-csv-plugin](https://github.com/TabularisDB/tabularis-csv-plugin)                     |
| IBM Db2                  | [tabularis-db2-plugin](https://github.com/TabularisDB/tabularis-db2-plugin)                     | Google Sheets   | [tabularis-google-sheets-plugin](https://github.com/TabularisDB/tabularis-google-sheets-plugin) |
| IBM Informix             | [tabularis-informix-plugin](https://github.com/danielnuld/tabularis-informix-plugin)            | HackerNews      | [tabularis-hackernews-plugin](https://github.com/TabularisDB/tabularis-hackernews-plugin)       |

**Sur le tableau des primes**

| Statut             | Bases de données                                                             |
| ------------------ | ---------------------------------------------------------------------------- |
| Réservé            | Google BigQuery, Meilisearch                                                 |
| Cadré              | Amazon Redshift, CockroachDB, TiDB                                           |
| Bientôt disponible | Snowflake                                                                    |
| Ouvert             | Cassandra, Etcd, Firebird, ScyllaDB, SQL Anywhere, SurrealDB, Trino / Presto |

> [!NOTE]
> Les drivers **disponibles** sont installables depuis le [registre des plugins](https://tabularis.dev/plugins). Tout le reste se trouve sur le [tableau des primes](https://tabularis.dev/plugins/bounties) : réservez-en un, sponsorisez-en un, ou [demandez une base de données](https://github.com/TabularisDB/tabularis/discussions).

## Installation

### Windows

```bash
winget install Debba.Tabularis
```

Ou téléchargez l’installateur depuis la [page Releases](https://github.com/TabularisDB/tabularis/releases).

### macOS

```bash
brew install --cask tabularis
```

Les builds à partir de la **v0.13.1** sont signés et notarisés par Apple : ils s’ouvrent sans aucune étape supplémentaire.

<details>
<summary>Notes pour les versions antérieures à la v0.13.1</summary>

<br />

Les notes suivantes ne concernent que les anciennes versions (antérieures à la v0.13.1) téléchargées directement :

- Vous devez autoriser l’accès à l’accessibilité (Confidentialité et sécurité) pour l’application tabularis. Si vous effectuez une mise à jour et que tabularis figure déjà dans la liste des applications autorisées, retirez-la manuellement avant que l’accès à l’accessibilité puisse être accordé à la nouvelle version.
- Après avoir copié l’application dans le dossier Applications, il peut être nécessaire d’exécuter :

```bash
xattr -c /Applications/tabularis.app
```

</details>

### Linux

**Snap**

```bash
sudo snap install tabularis
sudo snap connect tabularis:password-manager-service   # accès au trousseau pour les identifiants enregistrés
```

> [!IMPORTANT]
> L’interface `password-manager-service` n’est pas encore connectée automatiquement par le Snap Store. Sans elle, l’enregistrement d’une connexion échoue avec l’erreur `Platform secure storage failure`.

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

## Mises à jour

- Vérification automatique des mises à jour au démarrage.
- Possibilité de récupérer manuellement la dernière version depuis GitHub Releases.

## Galerie

La galerie complète est disponible sur [tabularis.dev](https://tabularis.dev).

## Fonctionnalités

### Connexions

<sub>[Référence complète sur tabularis.dev →](https://tabularis.dev/wiki/connections)</sub>

- Support de PostgreSQL, MySQL/MariaDB et SQLite.
- Profils de connexion enregistrés localement.
- Tunnels SSH et stockage des mots de passe dans le trousseau système.
- Page de connexions avec vues grille/liste et recherche en temps réel.
- Apparence personnalisée par connexion : icône (Lucide, emoji ou image) et couleur d’accent.

### Explorateur de base de données

<sub>[Référence complète sur tabularis.dev →](https://tabularis.dev/wiki/schema-management)</sub>

- Navigation dans les tables, colonnes, clés, index, vues et routines.
- Édition inline de certaines parties du schéma.
- Diagramme ER interactif.
- Actions rapides via menu contextuel.

### Éditeur SQL

<sub>[Référence complète sur tabularis.dev →](https://tabularis.dev/wiki/editor)</sub>

- Monaco Editor avec coloration et auto-complétion.
- Onglets multiples avec connexions isolées.
- Exécution multi-requêtes avec résultats séparés.
- Requêtes enregistrées et overlay IA dans l’éditeur.

### Notebooks SQL

<sub>[Référence complète sur tabularis.dev →](https://tabularis.dev/wiki/notebooks)</sub>

- Cellules SQL et Markdown dans un seul document.
- Résultats inline et graphiques.
- Variables entre cellules et paramètres globaux.
- Exécution séquentielle de toutes les cellules.

### Constructeur visuel de requêtes

<sub>[Référence complète sur tabularis.dev →](https://tabularis.dev/wiki/visual-query-builder)</sub>

- Construction drag-and-drop.
- JOIN visuels, filtres, agrégations, tris et limites.
- SQL généré en temps réel.

### Visual EXPLAIN

<sub>[Référence complète sur tabularis.dev →](https://tabularis.dev/wiki/visual-explain)</sub>

- Plans d’exécution affichés comme graphes navigables.
- Vues tableau, brute et analyse IA optionnelle.
- Compatible PostgreSQL, MySQL/MariaDB et SQLite.

### Grille de données

<sub>[Référence complète sur tabularis.dev →](https://tabularis.dev/wiki/data-grid)</sub>

- Édition inline et par lot.
- Création, sélection et suppression de lignes.
- Export CSV ou JSON.
- Support initial des données spatiales.
- Cellules JSON/JSONB avec coloration et fenêtre d’édition dédiée (Arbre / Monaco / Raw). Option par connexion : détecter le JSON dans les colonnes texte.

### Logs

- Visualisation des logs en temps réel depuis les paramètres.
- Filtres par niveau.
- Export en fichiers `.log`.
- Mode debug CLI : `tabularis --debug`.

### Plugins

<sub>[Référence complète sur tabularis.dev →](https://tabularis.dev/wiki/plugins)</sub>

- Système externe via JSON-RPC 2.0 sur stdin/stdout.
- Installation de drivers communautaires sans redémarrage.
- Registre officiel dans [`plugins/registry.json`](./plugins/registry.json).
- Guide développeur dans [`plugins/PLUGIN_GUIDE.md`](./plugins/PLUGIN_GUIDE.md).

## Configuration

<sub>[Référence complète sur tabularis.dev →](https://tabularis.dev/wiki/configuration)</sub>

La configuration est stockée dans :

- Linux : `~/.config/tabularis/`
- macOS : `~/Library/Application Support/tabularis/`
- Windows : `%APPDATA%\tabularis\`

Fichiers principaux :

- `connections.json`
- `saved_queries.json`
- `config.json`
- `themes/`
- `preferences/`
- `connection-icons/` (images personnalisées pour les icônes de connexion)

Dans `config.json`, le champ `language` prend en charge `auto`, `en`, `it`, `es`, `zh`, `fr`, `de`, `ja`, `ru`, `ko`, `tl` et `pt-BR`.

## IA

<sub>[Référence complète sur tabularis.dev →](https://tabularis.dev/wiki/ai-assistant)</sub>

Fonctions optionnelles de text-to-SQL et d’explication de requêtes avec :

- OpenAI
- Anthropic
- MiniMax
- OpenRouter
- Ollama
- APIs compatibles OpenAI

Les modèles sont récupérés dynamiquement et mis en cache localement.

## MCP

<sub>[Référence complète sur tabularis.dev →](https://tabularis.dev/wiki/mcp-server)</sub>

Lancement du serveur MCP intégré :

```bash
tabularis --mcp
```

Clients pris en charge :

- Claude Desktop
- Cursor
- Windsurf

Outils disponibles :

| Outil              | Description                                                       |
| ------------------ | ----------------------------------------------------------------- |
| `list_connections` | Lister toutes les connexions enregistrées                         |
| `list_databases`   | Lister toutes les bases de données d’une connexion                |
| `list_tables`      | Lister les tables d’une connexion (filtrage optionnel par schéma) |
| `describe_table`   | Obtenir le schéma complet : colonnes, index, clés étrangères      |
| `run_query`        | Exécuter n’importe quelle requête SQL et renvoyer les résultats   |

## Stack technique

| Couche   | Stack                                 |
| -------- | ------------------------------------- |
| Frontend | React 19, TypeScript, Tailwind CSS v4 |
| Backend  | Rust, Tauri v2, SQLx                  |

## Développement

**Setup**

```bash
pnpm install
pnpm tauri dev
```

**Build**

```bash
pnpm tauri build
```

## Feuille de route

La feuille de route est générée automatiquement à partir des issues GitHub. Consultez l’état actuel dans le [README anglais](./README.md#roadmap).

## Contribuer

Les contributions sont les bienvenues, consultez [CONTRIBUTING.md](./CONTRIBUTING.md). Quelques bons points de départ :

- [Plugin de driver SQL Server : testez le driver et prenez en charge les issues ouvertes](https://github.com/TabularisDB/tabularis-sqlserver-plugin)
- [Système de design UI et identité visuelle : appel à contributeurs](https://github.com/TabularisDB/tabularis/issues/195)
- Écrivez un plugin de driver dans n’importe quel langage avec le [guide des plugins](./plugins/PLUGIN_GUIDE.md)

## Sponsors et soutiens

Tabularis est soutenu par des sponsors et contributeurs formidables. Consultez la liste complète dans le [README anglais](./README.md#sponsors-and-supporters) et sur [tabularis.dev/sponsors](https://tabularis.dev/sponsors).

## Genèse du projet

Tabularis est né d’une expérience : jusqu’où le développement assisté par IA pouvait-il aller pour construire un outil fonctionnel à partir de zéro ? Plus loin que prévu : c’est aujourd’hui un projet activement maintenu, avec des releases régulières et un écosystème de plugins.

## Licence

[Apache License 2.0](./LICENSE)

---

<p align="center">
  Vous aimez tabularis ? Ajoutez une étoile au <a href="https://github.com/TabularisDB/tabularis">dépôt</a> ⭐, cela aide beaucoup le projet.
</p>

<p align="center">
  <a href="https://repostars.dev/?repos=TabularisDB%2Ftabularis&theme=dark">
    <img src="https://repostars.dev/api/embed?repo=TabularisDB%2Ftabularis&theme=dark" alt="RepoStars" />
  </a>
</p>
