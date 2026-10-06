<br />
<p align="center">
  <img src=".github/assets/banner-light.ru.png#gh-light-mode-only" alt="Tabularis" width="100%">
  <img src=".github/assets/banner-dark.ru.png#gh-dark-mode-only" alt="Tabularis" width="100%">
</p>

# Tabularis

Tabularis представляет собой настольную среду для работы с SQL с открытым исходным кодом, с 3 встроенными драйверами баз данных и 21 выпущенным плагином, включая DuckDB, ClickHouse, Redis и Firestore. Встроенный MCP-сервер позволяет Claude, Cursor и Devin (ранее Windsurf) читать вашу схему и выполнять запросы прямо в том приложении, которым вы уже пользуетесь.

<p align="center">
  <b><a href="https://tabularis.dev">Сайт</a></b> ·
  <b><a href="https://tabularis.dev/wiki">Документация</a></b> ·
  <b><a href="https://tabularis.dev/download">Скачать</a></b> ·
  <b><a href="./CHANGELOG.md">Список изменений</a></b>
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
> Это переведённая версия документации. Актуальный и официальный источник: [README на английском](./README.md).

<br />

<div align="center">
  <img src="https://raw.githubusercontent.com/TabularisDB/website/main/public/img/overview.gif" alt="Tabularis, настольная среда для работы с SQL, с редактором запросов и таблицей данных" />
</div>

## Скачать

```bash
winget install Debba.Tabularis    # Windows
brew install --cask tabularis     # macOS
sudo snap install tabularis       # Linux
```

Или скачайте установщик напрямую:

- **Windows:** &nbsp;[![Windows](https://img.shields.io/badge/Windows-Download-blue?logo=windows)](https://github.com/TabularisDB/tabularis/releases/download/v0.26.0/tabularis_0.26.0_x64-setup.exe)

- **macOS:** &nbsp;[![macOS (Apple Silicon)](https://img.shields.io/badge/macOS-Apple%20Silicon-black?logo=apple)](https://github.com/TabularisDB/tabularis/releases/download/v0.26.0/tabularis_0.26.0_aarch64.dmg)&nbsp;[![macOS (Intel)](https://img.shields.io/badge/macOS-Intel-black?logo=apple)](https://github.com/TabularisDB/tabularis/releases/download/v0.26.0/tabularis_0.26.0_x64.dmg)

- **Linux:** &nbsp;[![Linux AppImage](https://img.shields.io/badge/Linux-AppImage-green?logo=linux)](https://github.com/TabularisDB/tabularis/releases/download/v0.26.0/tabularis_0.26.0_amd64.AppImage)&nbsp;[![Linux .deb](https://img.shields.io/badge/Linux-.deb-orange?logo=debian)](https://github.com/TabularisDB/tabularis/releases/download/v0.26.0/tabularis_0.26.0_amd64.deb)&nbsp;[![Linux .rpm](https://img.shields.io/badge/Linux-.rpm-red?logo=redhat)](https://github.com/TabularisDB/tabularis/releases/download/v0.26.0/tabularis-0.26.0-1.x86_64.rpm)

Интерфейс приложения доступен на английском, итальянском, испанском, китайском (упрощённом), французском, немецком, японском, русском, корейском, тагальском и бразильском португальском языках.

> [!TIP]
> **Discord:** [присоединяйтесь к нашему серверу](https://discord.com/invite/K2hmhfHRSt), чтобы общаться с мейнтейнерами, делиться обратной связью и получать помощь.

## Почему tabularis?

|                                                                           |            **tabularis**             |             DBeaver CE              |     TablePlus      |     Beekeeper Studio     |
| ------------------------------------------------------------------------- | :----------------------------------: | :---------------------------------: | :----------------: | :----------------------: |
| Лицензия                                                                  |        Apache 2.0, бесплатно         | Apache 2.0, бесплатно (Pro платный) |    Коммерческая    | GPLv3 (платные редакции) |
| SQL-блокноты (SQL- и Markdown-ячейки, переменные между ячейками, графики) |                  ✅                  |                 ❌                  |         ❌         |            ❌            |
| Встроенный MCP-сервер для AI-агентов                                      |                  ✅                  |                 ❌                  |         ❌         |            ❌            |
| Плагины на **любом языке** (JSON-RPC через stdio)                         |                  ✅                  |        Плагины Java/Eclipse         | Плагины JavaScript |            ❌            |
| AI text-to-SQL с **локальными моделями** (Ollama)                         |                  ✅                  |        Облачный AI-ассистент        |         ❌         |            ❌            |
| Visual EXPLAIN с интерактивными графами планов                            |                  ✅                  |                 ✅                  |         ❌         |            ❌            |
| Баз данных «из коробки»                                                   | 3 встроенных + 21 официальный плагин |                100+                 |        20+         |           ~10            |

> [!NOTE]
> Сравнение по состоянию на июнь 2026 года; возможности других инструментов с тех пор могли измениться. Если вам нужны десятки драйверов, используйте DBeaver. Tabularis сосредоточен на том, чтобы хорошо поддерживать несколько баз данных.

### Поддержка баз данных

PostgreSQL, MySQL/MariaDB и SQLite встроены изначально. Встроенный драйвер PostgreSQL устарел: вместо него используется [плагин PostgreSQL](https://github.com/TabularisDB/tabularis-postgresql-plugin), который Tabularis устанавливает автоматически. Всё остальное реализовано плагинами. Текущее состояние соответствует [покрытию драйверов и плагинов](https://tabularis.dev/#driver-coverage) на сайте:

**Выпущено**

| База данных              | Плагин                                                                                          | База данных    | Плагин                                                                                          |
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

**На доске задач**

| Статус        | Базы данных                                                                  |
| ------------- | ---------------------------------------------------------------------------- |
| Закреплено    | Google BigQuery, Meilisearch                                                 |
| Запланировано | Amazon Redshift, CockroachDB, TiDB                                           |
| Скоро         | Snowflake                                                                    |
| Открыто       | Cassandra, Etcd, Firebird, ScyllaDB, SQL Anywhere, SurrealDB, Trino / Presto |

> [!NOTE]
> Драйверы со статусом **Выпущено** можно установить из [реестра плагинов](https://tabularis.dev/plugins). Всё остальное находится на [доске задач](https://tabularis.dev/plugins/bounties): возьмите задачу, спонсируйте её или [запросите базу данных](https://github.com/TabularisDB/tabularis/discussions).

## Установка

### Windows

```bash
winget install Debba.Tabularis
```

Либо скачайте установщик со страницы [Releases](https://github.com/TabularisDB/tabularis/releases).

### macOS

```bash
brew install --cask tabularis
```

Сборки, начиная с **v0.13.1**, подписаны и нотаризованы Apple, поэтому открываются без дополнительных действий.

<details>
<summary>Примечания для релизов до v0.13.1</summary>

<br />

Приведённые ниже примечания относятся только к более старым релизам (до v0.13.1), скачанным напрямую:

- Может потребоваться предоставить tabularis доступ к специальным возможностям (Конфиденциальность и безопасность). При обновлении, если предыдущая версия уже добавлена в список разрешённых, её нужно удалить вручную, прежде чем доступ можно будет предоставить новой версии.
- После копирования приложения в папку «Программы» может дополнительно потребоваться выполнить:

```bash
xattr -c /Applications/tabularis.app
```

</details>

### Linux

**Snap**

```bash
sudo snap install tabularis
sudo snap connect tabularis:password-manager-service   # доступ к keychain для сохранённых учётных данных
```

> [!IMPORTANT]
> Интерфейс `password-manager-service` пока не подключается Snap Store автоматически. Без него сохранение подключения завершается ошибкой `Platform secure storage failure`.

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

## Обновления

- При запуске приложение автоматически проверяет наличие обновлений.
- Также можно обновиться вручную через GitHub Releases.

## Галерея

Полную галерею смотрите на [tabularis.dev](https://tabularis.dev).

## Возможности

### Управление подключениями

<sub>[Полная справка на tabularis.dev →](https://tabularis.dev/wiki/connections)</sub>

- Поддержка PostgreSQL, MySQL/MariaDB и SQLite.
- Локальное сохранение профилей подключений.
- SSH-туннели и хранение паролей в системном keychain.
- Страница подключений с режимами «сетка» и «список» и поиском в реальном времени.
- Индивидуальное оформление для каждого подключения: свой значок (Lucide, эмодзи или собственное изображение) и акцентный цвет.

### Обозреватель базы данных

<sub>[Полная справка на tabularis.dev →](https://tabularis.dev/wiki/schema-management)</sub>

- Просмотр таблиц, столбцов, ключей, индексов, представлений и процедур.
- Встроенное редактирование элементов схемы.
- Интерактивная ER-диаграмма.
- Быстрые действия через контекстное меню.

### SQL-редактор

<sub>[Полная справка на tabularis.dev →](https://tabularis.dev/wiki/editor)</sub>

- Monaco Editor с подсветкой синтаксиса и автодополнением.
- Изолированные вкладки для каждого подключения.
- Выполнение нескольких запросов с раздельным отображением результатов.
- Сохранённые запросы и встроенный AI-оверлей в редакторе.

### SQL-блокноты

<sub>[Полная справка на tabularis.dev →](https://tabularis.dev/wiki/notebooks)</sub>

- SQL- и Markdown-ячейки в одном документе.
- Inline-результаты и графики.
- Переменные между ячейками и глобальные параметры.
- Последовательное выполнение всех ячеек.

### Визуальный конструктор запросов

<sub>[Полная справка на tabularis.dev →](https://tabularis.dev/wiki/visual-query-builder)</sub>

- Построение запросов через drag-and-drop.
- Визуальные JOIN, фильтры, агрегаты, сортировка и LIMIT.
- Генерация SQL в реальном времени.

### Visual EXPLAIN

<sub>[Полная справка на tabularis.dev →](https://tabularis.dev/wiki/visual-explain)</sub>

- План выполнения в виде интерактивного графа.
- Просмотр в виде таблицы, исходного вывода и опциональный AI-анализ.
- Поддержка PostgreSQL, MySQL/MariaDB и SQLite.

### Сетка данных

<sub>[Полная справка на tabularis.dev →](https://tabularis.dev/wiki/data-grid)</sub>

- Inline- и пакетное редактирование.
- Создание, выбор и удаление строк.
- Экспорт в CSV или JSON.
- Начальная поддержка пространственных данных.
- Подсветка ячеек JSON/JSONB и отдельное окно редактора (Tree / Monaco / Raw). Для каждого подключения можно включить распознавание JSON в текстовых столбцах.

### Логирование

- Просмотр логов в реальном времени в настройках.
- Фильтрация по уровню.
- Экспорт в `.log`-файлы.
- Режим отладки в CLI: `tabularis --debug`.

### Плагины

<sub>[Полная справка на tabularis.dev →](https://tabularis.dev/wiki/plugins)</sub>

- Внешняя система плагинов на JSON-RPC 2.0 через stdin/stdout.
- Установка драйверов сообщества без перезапуска.
- Официальный реестр: [`plugins/registry.json`](./plugins/registry.json).
- Руководство для разработчиков: [`plugins/PLUGIN_GUIDE.md`](./plugins/PLUGIN_GUIDE.md).

## Настройки

<sub>[Полная справка на tabularis.dev →](https://tabularis.dev/wiki/configuration)</sub>

Конфигурация хранится в:

- Linux: `~/.config/tabularis/`
- macOS: `~/Library/Application Support/tabularis/`
- Windows: `%APPDATA%\tabularis\`

Основные файлы:

- `connections.json`
- `saved_queries.json`
- `config.json`
- `themes/`
- `preferences/`
- `connection-icons/` (собственные изображения для значков подключений)

Поле `language` в `config.json` поддерживает значения `auto`, `en`, `it`, `es`, `zh`, `fr`, `de`, `ja`, `ru`, `ko`, `tl` и `pt-BR`.

## AI

<sub>[Полная справка на tabularis.dev →](https://tabularis.dev/wiki/ai-assistant)</sub>

Опциональные функции Text-to-SQL и объяснения запросов работают с провайдерами:

- OpenAI
- Anthropic
- MiniMax
- OpenRouter
- Ollama
- OpenAI-совместимые API

Список моделей подгружается динамически и кэшируется локально.

## MCP

<sub>[Полная справка на tabularis.dev →](https://tabularis.dev/wiki/mcp-server)</sub>

Запуск встроенного MCP-сервера:

```bash
tabularis --mcp
```

Поддерживаемые клиенты:

- Claude Desktop
- Cursor
- Windsurf

Доступные инструменты:

| Инструмент         | Описание                                                       |
| ------------------ | -------------------------------------------------------------- |
| `list_connections` | Список всех сохранённых подключений                            |
| `list_databases`   | Список всех баз данных подключения                             |
| `list_tables`      | Список таблиц подключения (с необязательным фильтром по схеме) |
| `describe_table`   | Полная схема: столбцы, индексы, внешние ключи                  |
| `run_query`        | Выполнение любого SQL-запроса с возвратом результатов          |

## Стек технологий

| Уровень  | Стек                                  |
| -------- | ------------------------------------- |
| Фронтенд | React 19, TypeScript, Tailwind CSS v4 |
| Бэкенд   | Rust, Tauri v2, SQLx                  |

## Разработка

**Установка**

```bash
pnpm install
pnpm tauri dev
```

**Сборка**

```bash
pnpm tauri build
```

## Дорожная карта

Дорожная карта формируется автоматически из GitHub Issues. Актуальное состояние смотрите в [README на английском](./README.md#roadmap).

## Участие в разработке

Вклад в проект приветствуется, см. [CONTRIBUTING.md](./CONTRIBUTING.md). С чего можно начать:

- [Плагин-драйвер SQL Server: протестируйте драйвер и возьмите открытые задачи](https://github.com/TabularisDB/tabularis-sqlserver-plugin)
- [Дизайн-система UI и визуальная идентичность: приглашение контрибьюторов](https://github.com/TabularisDB/tabularis/issues/195)
- Напишите плагин-драйвер на любом языке с помощью [руководства по плагинам](./plugins/PLUGIN_GUIDE.md)

## Спонсоры и сторонники

Tabularis поддерживают замечательные спонсоры и сторонники. Полный список смотрите в [README на английском](./README.md#sponsors-and-supporters) и на [tabularis.dev/sponsors](https://tabularis.dev/sponsors).

## История проекта

Tabularis начинался как эксперимент: как далеко можно продвинуться в создании работающего инструмента с нуля с помощью AI-ассистированной разработки? Дальше, чем ожидалось: сейчас это активно поддерживаемый проект с регулярными релизами и экосистемой плагинов.

## Лицензия

[Apache License 2.0](./LICENSE)

---

<p align="center">
  Нравится tabularis? <a href="https://github.com/TabularisDB/tabularis">Поставьте репозиторию звезду</a> ⭐, это очень помогает проекту.
</p>

<p align="center">
  <a href="https://repostars.dev/?repos=TabularisDB%2Ftabularis&theme=dark">
    <img src="https://repostars.dev/api/embed?repo=TabularisDB%2Ftabularis&theme=dark" alt="RepoStars" />
  </a>
</p>
