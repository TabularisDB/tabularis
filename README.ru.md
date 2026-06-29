<div align="center">
  <img src="public/logo-sm.png" width="120" height="120" />
</div>

# tabularis

<p align="center">
  <strong>Tabularis — настольная среда для работы с SQL с открытым исходным кодом для PostgreSQL, MySQL/MariaDB, SQLite и ещё 12+ баз данных, таких как DuckDB, ClickHouse, Redis и Firestore.<br />
  Встроенный MCP-сервер позволяет Claude, Cursor и Devin (ранее Windsurf) читать вашу схему и выполнять запросы прямо в том приложении, которым вы уже пользуетесь.</strong>
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

**Discord** — [присоединиться к серверу](https://discord.com/invite/K2hmhfHRSt), чтобы общаться с мейнтейнерами, делиться обратной связью и получать помощь от сообщества.

> Это переведённая версия документации. Актуальный и официальный источник — [README на английском](./README.md).

## Скачать

```bash
winget install Debba.Tabularis                                   # Windows
brew tap TabularisDB/tabularis && brew install --cask tabularis  # macOS
sudo snap install tabularis                                      # Linux
```

Или скачайте установщик напрямую:

[![Windows](https://img.shields.io/badge/Windows-Download-blue?logo=windows)](https://github.com/TabularisDB/tabularis/releases/download/v0.13.1/tabularis_0.13.1_x64-setup.exe) [![macOS (Apple Silicon)](https://img.shields.io/badge/macOS-Apple%20Silicon-black?logo=apple)](https://github.com/TabularisDB/tabularis/releases/download/v0.13.1/tabularis_0.13.1_aarch64.dmg) [![macOS (Intel)](https://img.shields.io/badge/macOS-Intel-black?logo=apple)](https://github.com/TabularisDB/tabularis/releases/download/v0.13.1/tabularis_0.13.1_x64.dmg) [![Linux AppImage](https://img.shields.io/badge/Linux-AppImage-green?logo=linux)](https://github.com/TabularisDB/tabularis/releases/download/v0.13.1/tabularis_0.13.1_amd64.AppImage) [![Linux .deb](https://img.shields.io/badge/Linux-.deb-orange?logo=debian)](https://github.com/TabularisDB/tabularis/releases/download/v0.13.1/tabularis_0.13.1_amd64.deb) [![Linux .rpm](https://img.shields.io/badge/Linux-.rpm-red?logo=redhat)](https://github.com/TabularisDB/tabularis/releases/download/v0.13.1/tabularis-0.13.1-1.x86_64.rpm)

Интерфейс приложения доступен на английском, итальянском, испанском, китайском (упрощённом), французском, немецком, японском и русском языках.

## Почему tabularis?

|  | **tabularis** | DBeaver CE | TablePlus | Beekeeper Studio |
|---|---|---|---|---|
| Лицензия | Apache 2.0, бесплатно | Apache 2.0, бесплатно (Pro платный) | Коммерческая | GPLv3 (платные редакции) |
| SQL-блокноты (SQL- и Markdown-ячейки, переменные между ячейками, графики) | ✅ | ❌ | ❌ | ❌ |
| Встроенный MCP-сервер для AI-агентов | ✅ | ❌ | ❌ | ❌ |
| Плагины на **любом языке** (JSON-RPC через stdio) | ✅ | Плагины Java/Eclipse | Плагины JavaScript | ❌ |
| AI text-to-SQL с **локальными моделями** (Ollama) | ✅ | Облачный AI-ассистент | ❌ | ❌ |
| Visual EXPLAIN с интерактивными графами планов | ✅ | ✅ | ❌ | ❌ |
| Баз данных «из коробки» | 3 встроенных + 12 официальных плагинов | 100+ | 20+ | ~10 |

> Сравнение по состоянию на июнь 2026 года; возможности других инструментов с тех пор могли измениться. Если вам нужны десятки драйверов, используйте DBeaver — tabularis сосредоточен на том, чтобы хорошо поддерживать несколько баз данных.

### Поддержка баз данных

PostgreSQL, MySQL/MariaDB и SQLite встроены изначально. Всё остальное — это плагины; ниже показано, на какой стадии находится каждая интеграция сегодня, в соответствии с [покрытием драйверов и плагинов](https://tabularis.dev/#driver-coverage) на сайте.

ClickHouse (выпущено), Cloudflare D1 (выпущено), DuckDB (выпущено), Firestore (выпущено), IBM Db2 (выпущено), IBM Informix (выпущено), Redis (выпущено), CSV Folder (выпущено), Google Sheets (выпущено), HackerNews (выпущено), Google BigQuery (закреплено), LibSQL / Turso (закреплено), Meilisearch (закреплено), MongoDB (закреплено), Oracle (закреплено), SQL Server (закреплено), Amazon Redshift (запланировано), CockroachDB (запланировано), TiDB (запланировано), DynamoDB (скоро), Snowflake (скоро), Cassandra (открыто), Elasticsearch (открыто), Etcd (открыто), Firebird (открыто), ScyllaDB (открыто), SQL Anywhere (открыто), SurrealDB (открыто), Trino / Presto (открыто).

> Драйверы со статусом **Выпущено** можно установить из [реестра плагинов](https://tabularis.dev/plugins). Всё остальное находится на [доске задач](https://tabularis.dev/plugins/bounties) — возьмите задачу, спонсируйте её или [запросите базу данных](https://github.com/TabularisDB/tabularis/discussions).

## Установка

### Windows

```bash
winget install Debba.Tabularis
```

Либо скачать установщик со страницы [Releases](https://github.com/TabularisDB/tabularis/releases).

### macOS

```bash
brew tap TabularisDB/tabularis
brew install --cask tabularis
```

Сборки, начиная с **v0.13.1**, подписаны и нотаризованы Apple, поэтому открываются без дополнительных действий.

Приведённые ниже примечания относятся только к более старым релизам (до v0.13.1), скачанным напрямую:

- При установке tabularis на macOS может потребоваться предоставить доступ к специальным возможностям (Конфиденциальность и безопасность). При обновлении, если предыдущая версия уже добавлена в список разрешённых, её нужно удалить вручную, прежде чем доступ можно будет предоставить новой версии.
- Может потребоваться выполнить:

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

## Обновления

- При запуске приложение автоматически проверяет наличие обновлений.
- Также можно обновиться вручную со страницы [GitHub Releases](https://github.com/TabularisDB/tabularis/releases).

## Скриншоты и демо

Скриншоты и демо возможностей — на [tabularis.dev](https://tabularis.dev) в разделе Features.

## Возможности

### Управление подключениями

- Поддержка PostgreSQL, MySQL/MariaDB и SQLite.
- Локальное сохранение профилей подключений.
- SSH-туннели и хранение паролей в системном keychain.
- Страница подключений с режимами «сетка» и «список» и поиском в реальном времени.

### Обозреватель базы данных

- Просмотр таблиц, столбцов, ключей, индексов, представлений и процедур.
- Встроенное редактирование элементов схемы.
- Интерактивная ER-диаграмма.
- Быстрые действия через контекстное меню.

### SQL-редактор

- Monaco Editor с подсветкой синтаксиса и автодополнением.
- Изолированные вкладки для каждого подключения.
- Выполнение нескольких запросов с раздельным отображением результатов.
- Сохранённые запросы и встроенный AI-оверлей в редакторе.

### SQL-блокноты

- SQL- и Markdown-ячейки в одном документе.
- Inline-результаты и графики.
- Переменные между ячейками и глобальные параметры.
- Последовательное выполнение всех ячеек.

### Визуальный конструктор запросов

- Построение запросов через drag-and-drop.
- Визуальные JOIN, фильтры, агрегаты, сортировка и LIMIT.
- Генерация SQL в реальном времени.

### Visual EXPLAIN

- План выполнения в виде интерактивного графа.
- Просмотр в виде таблицы, исходного вывода и опциональный AI-анализ.
- Поддержка PostgreSQL, MySQL/MariaDB и SQLite.

### Сетка данных

- Inline- и пакетное редактирование.
- Создание, выбор и удаление строк.
- Экспорт в CSV или JSON.
- Начальная поддержка пространственных данных (GEOMETRY).
- Подсветка ячеек JSON/JSONB и отдельное окно редактора (Tree / Monaco / Raw). Для каждого подключения можно включить распознавание JSON в текстовых столбцах.

### Логирование

- Просмотр логов в реальном времени в настройках.
- Фильтрация по уровню.
- Экспорт в `.log`-файлы.
- Режим отладки в CLI: `tabularis --debug`.

### Плагины

- Внешняя система плагинов на JSON-RPC 2.0 через stdin/stdout.
- Установка драйверов сообщества без перезапуска.
- Официальный реестр: [`plugins/registry.json`](./plugins/registry.json).
- Руководство для разработчиков: [`plugins/PLUGIN_GUIDE.md`](./plugins/PLUGIN_GUIDE.md).

## Настройки

Конфигурация хранится в:

- Linux: `~/.config/tabularis/`
- macOS: `~/Library/Application Support/tabularis/`
- Windows: `%APPDATA%\\tabularis\\`

Основные файлы:

- `connections.json`
- `saved_queries.json`
- `config.json`
- `themes/`
- `preferences/`

Поле `language` в `config.json` поддерживает значения `auto`, `en`, `it`, `es`, `zh`, `fr`, `de`, `ja`, `ru`.

## AI

Опциональные функции Text-to-SQL и объяснения запросов работают с провайдерами:

- OpenAI
- Anthropic
- MiniMax
- OpenRouter
- Ollama
- OpenAI-совместимые API

Список моделей подгружается динамически и кэшируется локально.

## MCP

Запуск встроенного MCP-сервера:

```bash
tabularis --mcp
```

Поддерживаемые клиенты:

- Claude Desktop
- Cursor
- Windsurf

Доступные инструменты:

- `list_connections`
- `list_tables`
- `describe_table`
- `run_query`

## Стек технологий

- Фронтенд: React 19, TypeScript, Tailwind CSS v4.
- Бэкенд: Rust, Tauri v2, SQLx.

## Разработка

Установка зависимостей и запуск:

```bash
pnpm install
pnpm tauri dev
```

Сборка:

```bash
pnpm tauri build
```

## Дорожная карта

- Удалённое управление
- Командная палитра
- Редактор и просмотрщик JSON/JSONB
- Форматирование SQL / Prettier
- Сравнение и диффы данных
- Командная работа

## Участие в разработке

Вклад в проект приветствуется — см. [CONTRIBUTING.md](./CONTRIBUTING.md). С чего можно начать:

- [Драйвер SQL Server — план реализации и приглашение контрибьюторов](https://github.com/TabularisDB/tabularis/issues/150)
- [Дизайн-система UI и визуальная идентичность — приглашение контрибьюторов](https://github.com/TabularisDB/tabularis/issues/195)
- Напишите плагин-драйвер на любом языке — см. [руководство по плагинам](./plugins/PLUGIN_GUIDE.md)

## История проекта

Tabularis начинался как эксперимент: как далеко можно продвинуться в создании работающего инструмента с нуля с помощью AI-ассистированной разработки? Дальше, чем ожидалось, — сейчас это активно поддерживаемый проект с регулярными релизами и экосистемой плагинов.

## Лицензия

Apache License 2.0

---

<p align="center">
  Нравится tabularis? <a href="https://github.com/TabularisDB/tabularis">Поставьте репозиторию звезду</a> ⭐ — это очень помогает проекту.
</p>

<p align="center">
  <a href="https://repostars.dev/?repos=TabularisDB%2Ftabularis&theme=dark">
    <img src="https://repostars.dev/api/embed?repo=TabularisDB%2Ftabularis&theme=dark" alt="RepoStars" />
  </a>
</p>
