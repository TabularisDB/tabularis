<div align="center">
  <img src="public/logo-sm.png" width="120" height="120" />
</div>

# tabularis

<p align="center">
  <strong>Клиент баз данных с открытым исходным кодом для PostgreSQL, MySQL/MariaDB и SQLite.<br />
  SQL-блокноты, Visual EXPLAIN, AI и MCP уже встроены. Всё остальное добавляют плагины.</strong>
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
| Баз данных «из коробки» | 3 (+ любые через плагины) | 100+ | 20+ | ~10 |

> Сравнение по состоянию на июнь 2026 года; возможности других инструментов с тех пор могли измениться. Если вам нужны десятки драйверов, используйте DBeaver — tabularis сосредоточен на том, чтобы хорошо поддерживать несколько баз данных.

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

При установке напрямую из релиза может потребоваться выполнить:

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
