<div align="center">
  <img src="public/logo-sm.png" width="120" height="120" />
</div>

# tabularis

<p align="center">
  <strong>Tabularis est un espace de travail SQL de bureau open source pour PostgreSQL, MySQL/MariaDB, SQLite et plus de 12 autres bases de données comme DuckDB, ClickHouse, Redis et Firestore.<br />
  Son serveur MCP intégré permet à Claude, Cursor et Devin (anciennement Windsurf) de lire votre schéma et d’exécuter des requêtes dans l’application que vous utilisez déjà.</strong>
</p>

<p align="center">
  <strong>README :</strong>
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

**Discord** - [Rejoindre le serveur](https://discord.com/invite/K2hmhfHRSt) pour discuter avec les mainteneurs, partager des retours et obtenir de l’aide.

> Document traduit. Pour la version de référence la plus à jour, consultez aussi le [README anglais](./README.md).

## Téléchargements

```bash
winget install Debba.Tabularis                                   # Windows
brew tap TabularisDB/tabularis && brew install --cask tabularis  # macOS
sudo snap install tabularis                                      # Linux
```

Ou téléchargez directement un installateur :

[![Windows](https://img.shields.io/badge/Windows-Download-blue?logo=windows)](https://github.com/TabularisDB/tabularis/releases/download/v0.13.1/tabularis_0.13.1_x64-setup.exe) [![macOS (Apple Silicon)](https://img.shields.io/badge/macOS-Apple%20Silicon-black?logo=apple)](https://github.com/TabularisDB/tabularis/releases/download/v0.13.1/tabularis_0.13.1_aarch64.dmg) [![macOS (Intel)](https://img.shields.io/badge/macOS-Intel-black?logo=apple)](https://github.com/TabularisDB/tabularis/releases/download/v0.13.1/tabularis_0.13.1_x64.dmg) [![Linux AppImage](https://img.shields.io/badge/Linux-AppImage-green?logo=linux)](https://github.com/TabularisDB/tabularis/releases/download/v0.13.1/tabularis_0.13.1_amd64.AppImage) [![Linux .deb](https://img.shields.io/badge/Linux-.deb-orange?logo=debian)](https://github.com/TabularisDB/tabularis/releases/download/v0.13.1/tabularis_0.13.1_amd64.deb) [![Linux .rpm](https://img.shields.io/badge/Linux-.rpm-red?logo=redhat)](https://github.com/TabularisDB/tabularis/releases/download/v0.13.1/tabularis-0.13.1-1.x86_64.rpm)

L’interface de l’application est disponible en anglais, italien, espagnol, chinois (simplifié), français, allemand, japonais et russe.

## Pourquoi tabularis ?

|  | **tabularis** | DBeaver CE | TablePlus | Beekeeper Studio |
|---|---|---|---|---|
| Licence | Apache 2.0, gratuit | Apache 2.0, gratuit (Pro payant) | Commerciale | GPLv3 (éditions payantes) |
| Notebooks SQL (cellules SQL + Markdown, variables entre cellules, graphiques) | ✅ | ❌ | ❌ | ❌ |
| Serveur MCP intégré pour les agents IA | ✅ | ❌ | ❌ | ❌ |
| Plugins dans **n’importe quel langage** (JSON-RPC sur stdio) | ✅ | Plugins Java/Eclipse | Plugins JavaScript | ❌ |
| Text-to-SQL par IA avec **modèles locaux** (Ollama) | ✅ | Assistant IA dans le cloud | ❌ | ❌ |
| EXPLAIN visuel avec graphes de plan interactifs | ✅ | ✅ | ❌ | ❌ |
| Bases de données prises en charge nativement | 3 intégrées + 12 plugins officiels | 100+ | 20+ | ~10 |

> Comparaison datée de juin 2026 ; les fonctionnalités des autres outils ont pu évoluer depuis. Si vous avez besoin de dizaines de drivers, utilisez DBeaver — tabularis se concentre sur bien prendre en charge quelques bases de données.

### Bases de données prises en charge

PostgreSQL, MySQL/MariaDB et SQLite sont intégrés nativement. Tout le reste est un plugin — voici l’état actuel de chaque intégration, qui reflète la [couverture des drivers et plugins](https://tabularis.dev/#driver-coverage) sur le site web.

Au-delà des bases intégrées : ClickHouse (disponible), Cloudflare D1 (disponible), DuckDB (disponible), Firestore (disponible), IBM Db2 (disponible), IBM Informix (disponible), Redis (disponible), CSV Folder (disponible), Google Sheets (disponible), HackerNews (disponible), Google BigQuery (réservé), LibSQL / Turso (réservé), Meilisearch (réservé), MongoDB (réservé), Oracle (réservé), SQL Server (réservé), Amazon Redshift (cadré), CockroachDB (cadré), TiDB (cadré), DynamoDB (bientôt disponible), Snowflake (bientôt disponible), Cassandra (ouvert), Elasticsearch (ouvert), Etcd (ouvert), Firebird (ouvert), ScyllaDB (ouvert), SQL Anywhere (ouvert), SurrealDB (ouvert) et Trino / Presto (ouvert).

> Les drivers **Disponibles** sont installables depuis le [registre des plugins](https://tabularis.dev/plugins). Tout le reste se trouve sur le [tableau des primes](https://tabularis.dev/plugins/bounties) — réservez-en un, sponsorisez-en un, ou [demandez une base de données](https://github.com/TabularisDB/tabularis/discussions).

## Installation

### Windows

```bash
winget install Debba.Tabularis
```

Ou téléchargez l’installateur depuis la [page Releases](https://github.com/TabularisDB/tabularis/releases).

### macOS

```bash
brew tap TabularisDB/tabularis
brew install --cask tabularis
```

Les builds à partir de la **v0.13.1** sont signés et notarisés par Apple : ils s’ouvrent sans aucune étape supplémentaire.

Les notes suivantes ne concernent que les anciennes versions (antérieures à la v0.13.1) téléchargées directement :

- Vous devez autoriser l’accès à l’accessibilité (Confidentialité et sécurité) pour l’application tabularis. Si vous effectuez une mise à jour et que tabularis figure déjà dans la liste des applications autorisées, retirez-la manuellement avant que l’accès à l’accessibilité puisse être accordé à la nouvelle version.
- En cas d’installation directe, il peut être nécessaire d’exécuter `xattr -c /Applications/tabularis.app`.

### Linux

Snap :

```bash
sudo snap install tabularis
```

Flatpak :

```bash
flatpak remote-add --if-not-exists flatpark https://dl.flatpark.org/flatpark.flatpakrepo
flatpak install flatpark dev.tabularis.Tabularis
```

AppImage :

```bash
chmod +x tabularis_x.x.x_amd64.AppImage
./tabularis_x.x.x_amd64.AppImage
```

Arch Linux :

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

- Support de PostgreSQL, MySQL/MariaDB et SQLite.
- Profils de connexion enregistrés localement.
- Tunnels SSH et stockage des mots de passe dans le trousseau système.
- Page de connexions avec vues grille/liste et recherche en temps réel.
- Apparence personnalisée par connexion : icône (Lucide, emoji ou image) et couleur d'accent.

### Explorateur de base de données

- Navigation dans les tables, colonnes, clés, index, vues et routines.
- Édition inline de certaines parties du schéma.
- Diagramme ER interactif.
- Actions rapides via menu contextuel.

### Éditeur SQL

- Monaco Editor avec coloration et auto-complétion.
- Onglets multiples avec connexions isolées.
- Exécution multi-requêtes avec résultats séparés.
- Requêtes enregistrées et overlay IA dans l’éditeur.

### Notebooks SQL

- Cellules SQL et Markdown dans un seul document.
- Résultats inline et graphiques.
- Variables entre cellules et paramètres globaux.
- Exécution séquentielle de toutes les cellules.

### Constructeur visuel de requêtes

- Construction drag-and-drop.
- JOIN visuels, filtres, agrégations, tris et limites.
- SQL généré en temps réel.

### Visual EXPLAIN

- Plans d’exécution affichés comme graphes navigables.
- Vues tableau, brute et analyse IA optionnelle.
- Compatible PostgreSQL, MySQL/MariaDB et SQLite.

### Grille de données

- Édition inline et par lot.
- Création, sélection et suppression de lignes.
- Export CSV ou JSON.
- Support initial des données spatiales.
- Cellules JSON/JSONB avec coloration et fenêtre d'édition dédiée (Arbre / Monaco / Raw). Option par connexion : détecter le JSON dans les colonnes texte.

### Logs

- Visualisation des logs en temps réel depuis Settings.
- Filtres par niveau.
- Export en fichiers `.log`.
- Mode debug CLI : `tabularis --debug`.

### Plugins

- Système externe via JSON-RPC 2.0 sur stdin/stdout.
- Installation de drivers communautaires sans redémarrage.
- Registre officiel dans [`plugins/registry.json`](./plugins/registry.json).
- Guide développeur dans [`plugins/PLUGIN_GUIDE.md`](./plugins/PLUGIN_GUIDE.md).

## Configuration

La configuration est stockée dans :

- Linux : `~/.config/tabularis/`
- macOS : `~/Library/Application Support/tabularis/`
- Windows : `%APPDATA%\\tabularis\\`

Fichiers principaux :

- `connections.json`
- `saved_queries.json`
- `config.json`
- `themes/`
- `preferences/`
- `connection-icons/` (images personnalisées pour les icônes de connexion)

Dans `config.json`, le champ `language` prend en charge `auto`, `en`, `it`, `es`, `zh`, `fr`, `de`.

## IA

Fonctions optionnelles de text-to-SQL et d’explication de requêtes avec :

- OpenAI
- Anthropic
- MiniMax
- OpenRouter
- Ollama
- APIs compatibles OpenAI

Les modèles sont récupérés dynamiquement et mis en cache localement.

## MCP

Lancement du serveur MCP intégré :

```bash
tabularis --mcp
```

Clients pris en charge :

- Claude Desktop
- Cursor
- Windsurf

Outils disponibles :

- `list_connections`
- `list_tables`
- `describe_table`
- `run_query`

## Stack Technique

- Frontend : React 19, TypeScript, Tailwind CSS v4
- Backend : Rust, Tauri v2, SQLx

## Développement

Setup :

```bash
pnpm install
pnpm tauri dev
```

Build :

```bash
pnpm tauri build
```

## Feuille de route

- Remote Control
- Command Palette
- Éditeur/visualiseur JSON et JSONB
- SQL Formatting / Prettier
- Data Compare / Diff Tool
- Team Collaboration

## Contribuer

Les contributions sont les bienvenues — consultez [CONTRIBUTING.md](./CONTRIBUTING.md). Quelques bons points de départ :

- [Driver SQL Server — feuille de route d’implémentation et appel à contributeurs](https://github.com/TabularisDB/tabularis/issues/150)
- [Système de design UI et identité visuelle — appel à contributeurs](https://github.com/TabularisDB/tabularis/issues/195)
- Écrivez un plugin de driver dans n’importe quel langage — voir le [guide des plugins](./plugins/PLUGIN_GUIDE.md)

## Genèse du projet

Tabularis est né d’une expérience : jusqu’où le développement assisté par IA pouvait-il aller pour construire un outil fonctionnel à partir de zéro ? Plus loin que prévu — c’est aujourd’hui un projet activement maintenu, avec des releases régulières et un écosystème de plugins.

## Licence

Apache License 2.0

---

<p align="center">
  Vous aimez tabularis ? Ajoutez une étoile au <a href="https://github.com/TabularisDB/tabularis">dépôt</a> ⭐ — cela aide beaucoup le projet.
</p>

<p align="center">
  <a href="https://repostars.dev/?repos=TabularisDB%2Ftabularis&theme=dark">
    <img src="https://repostars.dev/api/embed?repo=TabularisDB%2Ftabularis&theme=dark" alt="RepoStars" />
  </a>
</p>
