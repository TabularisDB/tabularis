<div align="center">
  <img src="public/logo-sm.png" width="120" height="120" />
</div>

# tabularis

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

Client desktop open source pour bases de données modernes. Il prend en charge PostgreSQL, MySQL/MariaDB et SQLite, avec notebooks SQL, fonctions IA, intégration MCP et système de plugins externe.

**Discord** - [Rejoindre le serveur](https://discord.com/invite/K2hmhfHRSt) pour discuter avec les mainteneurs, partager des retours et obtenir de l’aide.

> Document traduit. Pour la version de référence la plus à jour, consultez aussi le [README anglais](./README.md).

## Téléchargements

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

Ou téléchargez l’installateur depuis la [page Releases](https://github.com/TabularisDB/tabularis/releases).

### macOS

```bash
brew tap TabularisDB/tabularis
brew install --cask tabularis
```

En cas d’installation directe depuis une release, il peut être nécessaire d’exécuter :

```bash
xattr -c /Applications/tabularis.app
```

### Linux

Snap :

```bash
sudo snap install tabularis
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

## Licence

Apache License 2.0
