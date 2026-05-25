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

Open-source десктоп-клиент для современных баз данных. Поддерживает PostgreSQL, MySQL/MariaDB и SQLite. Включает SQL-блокноты, AI-функции, интеграцию MCP и систему внешних плагинов.

**Discord** — [присоединиться к серверу](https://discord.com/invite/K2hmhfHRSt), чтобы общаться с мейнтейнерами, делиться обратной связью и получать помощь от сообщества.

> Это переведённая версия документации. Актуальный и официальный источник — [README на английском](./README.md).

## Скачать

[![Windows](https://img.shields.io/badge/Windows-Download-blue?logo=windows)](https://github.com/TabularisDB/tabularis/releases/download/v0.11.0/tabularis_0.11.0_x64-setup.exe)
[![macOS](https://img.shields.io/badge/macOS-Download-black?logo=apple)](https://github.com/TabularisDB/tabularis/releases/download/v0.11.0/tabularis_0.11.0_x64.dmg)
[![Linux AppImage](https://img.shields.io/badge/Linux-AppImage-green?logo=linux)](https://github.com/TabularisDB/tabularis/releases/download/v0.11.0/tabularis_0.11.0_amd64.AppImage)
[![Linux .deb](https://img.shields.io/badge/Linux-.deb-orange?logo=debian)](https://github.com/TabularisDB/tabularis/releases/download/v0.11.0/tabularis_0.11.0_amd64.deb)
[![Linux .rpm](https://img.shields.io/badge/Linux-.rpm-red?logo=redhat)](https://github.com/TabularisDB/tabularis/releases/download/v0.11.0/tabularis-0.9.7-1.x86_64.rpm)

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

## Лицензия

Apache License 2.0
