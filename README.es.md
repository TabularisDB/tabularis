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

Cliente de escritorio open source para bases de datos modernas. Soporta PostgreSQL, MySQL/MariaDB y SQLite, con notebooks SQL, funciones de IA, integración MCP y sistema de plugins externo.

**Discord** - [Únete al servidor](https://discord.com/invite/K2hmhfHRSt) para hablar con los mantenedores, compartir feedback y pedir ayuda.

> Documento traducido. Para la versión de referencia más actualizada, consulta también el [README en inglés](./README.md).

## Descargas

[![Windows](https://img.shields.io/badge/Windows-Download-blue?logo=windows)](https://github.com/TabularisDB/tabularis/releases/download/v0.9.18/tabularis_0.9.18_x64-setup.exe)
[![macOS](https://img.shields.io/badge/macOS-Download-black?logo=apple)](https://github.com/TabularisDB/tabularis/releases/download/v0.9.18/tabularis_0.9.18_x64.dmg)
[![Linux AppImage](https://img.shields.io/badge/Linux-AppImage-green?logo=linux)](https://github.com/TabularisDB/tabularis/releases/download/v0.9.18/tabularis_0.9.18_amd64.AppImage)
[![Linux .deb](https://img.shields.io/badge/Linux-.deb-orange?logo=debian)](https://github.com/TabularisDB/tabularis/releases/download/v0.9.18/tabularis_0.9.18_amd64.deb)
[![Linux .rpm](https://img.shields.io/badge/Linux-.rpm-red?logo=redhat)](https://github.com/TabularisDB/tabularis/releases/download/v0.9.18/tabularis-0.9.7-1.x86_64.rpm)

## Instalación

### Windows

```bash
winget install Debba.Tabularis
```

O descarga el instalador desde la [página de Releases](https://github.com/TabularisDB/tabularis/releases).

### macOS

```bash
brew tap TabularisDB/tabularis
brew install --cask tabularis
```

Si instalas desde una release directa, puede ser necesario ejecutar:

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

## Actualizaciones

- Actualizaciones automáticas al iniciar la app.
- Posibilidad de comprobar manualmente desde las releases de GitHub.

## Galería

La galería completa está en [tabularis.dev](https://tabularis.dev).

## Funcionalidades

### Conexiones

- Soporte para PostgreSQL, MySQL/MariaDB y SQLite.
- Perfiles de conexión guardados localmente.
- Túneles SSH y almacenamiento de contraseñas en el llavero del sistema.
- Página de conexiones con vista de cuadrícula/lista y búsqueda en tiempo real.
- Apariencia personalizada por conexión: icono propio (Lucide, emoji o imagen) y color de acento.

### Explorador de base de datos

- Navegación de tablas, columnas, claves, índices, vistas y rutinas.
- Edición inline de partes del esquema.
- Diagrama ER interactivo.
- Acciones rápidas desde menús contextuales.

### Editor SQL

- Monaco Editor con resaltado y autocompletado.
- Múltiples pestañas con conexiones aisladas.
- Ejecución multi-query con resultados separados.
- Consultas guardadas y overlay de IA dentro del editor.

### Notebooks SQL

- Celdas SQL y Markdown en un mismo documento.
- Resultados inline y gráficos.
- Variables entre celdas y parámetros globales.
- Ejecución secuencial de todas las celdas.

### Constructor visual de consultas

- Construcción drag-and-drop.
- JOINs visuales, filtros, agregaciones, ordenación y límites.
- SQL generado en tiempo real.

### Visual EXPLAIN

- Planes de ejecución como grafos navegables.
- Vistas tabular, raw y análisis opcional con IA.
- Compatible con PostgreSQL, MySQL/MariaDB y SQLite.

### Data Grid

- Edición inline y por lotes.
- Creación, selección y borrado de filas.
- Exportación a CSV o JSON.
- Soporte inicial para datos espaciales.
- Celdas JSON/JSONB con resaltado y ventana de edición dedicada (Árbol / Monaco / Raw). Opcional por conexión: detectar JSON en columnas de texto.

### Logging

- Logs en tiempo real desde Settings.
- Filtros por nivel.
- Exportación a `.log`.
- Modo debug por CLI: `tabularis --debug`.

### Plugins

- Sistema externo vía JSON-RPC 2.0 por stdin/stdout.
- Instalación de drivers comunitarios sin reiniciar.
- Registro oficial en [`plugins/registry.json`](./plugins/registry.json).
- Guía para desarrolladores en [`plugins/PLUGIN_GUIDE.md`](./plugins/PLUGIN_GUIDE.md).

## Configuración

La configuración se guarda en:

- Linux: `~/.config/tabularis/`
- macOS: `~/Library/Application Support/tabularis/`
- Windows: `%APPDATA%\\tabularis\\`

Archivos principales:

- `connections.json`
- `saved_queries.json`
- `config.json`
- `themes/`
- `preferences/`
- `connection-icons/` (imágenes personalizadas para iconos de conexiones)

En `config.json`, el campo `language` admite `auto`, `en`, `it`, `es`, `zh`, `fr`, `de`.

## IA

Funciones opcionales de text-to-SQL y explicación de consultas con:

- OpenAI
- Anthropic
- MiniMax
- OpenRouter
- Ollama
- APIs compatibles con OpenAI

La lista de modelos se obtiene dinámicamente y se cachea localmente.

## MCP

Servidor MCP integrado:

```bash
tabularis --mcp
```

Clientes soportados:

- Claude Desktop
- Cursor
- Windsurf

Herramientas disponibles:

- `list_connections`
- `list_tables`
- `describe_table`
- `run_query`

## Stack Tecnológico

- Frontend: React 19, TypeScript, Tailwind CSS v4
- Backend: Rust, Tauri v2, SQLx

## Desarrollo

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
- Editor/Viewer JSON y JSONB
- SQL Formatting / Prettier
- Data Compare / Diff Tool
- Team Collaboration

## Licencia

Apache License 2.0
