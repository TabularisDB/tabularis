<div align="center">
  <img src="public/logo-sm.png" width="120" height="120" />
</div>

# tabularis

<p align="center">
  <strong>Tabularis es un espacio de trabajo SQL de escritorio open source para PostgreSQL, MySQL/MariaDB, SQLite y más de 12 bases de datos adicionales como DuckDB, ClickHouse, Redis y Firestore.<br />
  Su servidor MCP integrado permite que Claude, Cursor y Devin (antes Windsurf) lean tu esquema y ejecuten consultas en la misma app que ya usas.</strong>
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

**Discord** - [Únete al servidor](https://discord.com/invite/K2hmhfHRSt) para hablar con los mantenedores, compartir feedback y pedir ayuda.

> Documento traducido. Para la versión de referencia más actualizada, consulta también el [README en inglés](./README.md).

## Descargas

```bash
winget install Debba.Tabularis                                   # Windows
brew tap TabularisDB/tabularis && brew install --cask tabularis  # macOS
sudo snap install tabularis                                      # Linux
```

O descarga un instalador directamente:

[![Windows](https://img.shields.io/badge/Windows-Download-blue?logo=windows)](https://github.com/TabularisDB/tabularis/releases/download/v0.13.1/tabularis_0.13.1_x64-setup.exe) [![macOS (Apple Silicon)](https://img.shields.io/badge/macOS-Apple%20Silicon-black?logo=apple)](https://github.com/TabularisDB/tabularis/releases/download/v0.13.1/tabularis_0.13.1_aarch64.dmg) [![macOS (Intel)](https://img.shields.io/badge/macOS-Intel-black?logo=apple)](https://github.com/TabularisDB/tabularis/releases/download/v0.13.1/tabularis_0.13.1_x64.dmg) [![Linux AppImage](https://img.shields.io/badge/Linux-AppImage-green?logo=linux)](https://github.com/TabularisDB/tabularis/releases/download/v0.13.1/tabularis_0.13.1_amd64.AppImage) [![Linux .deb](https://img.shields.io/badge/Linux-.deb-orange?logo=debian)](https://github.com/TabularisDB/tabularis/releases/download/v0.13.1/tabularis_0.13.1_amd64.deb) [![Linux .rpm](https://img.shields.io/badge/Linux-.rpm-red?logo=redhat)](https://github.com/TabularisDB/tabularis/releases/download/v0.13.1/tabularis-0.13.1-1.x86_64.rpm)

La interfaz de la aplicación está disponible en inglés, italiano, español, chino (simplificado), francés, alemán, japonés y ruso.

## ¿Por qué tabularis?

|  | **tabularis** | DBeaver CE | TablePlus | Beekeeper Studio |
|---|---|---|---|---|
| Licencia | Apache 2.0, gratis | Apache 2.0, gratis (Pro es de pago) | Comercial | GPLv3 (ediciones de pago) |
| Notebooks SQL (celdas SQL + Markdown, variables entre celdas, gráficos) | ✅ | ❌ | ❌ | ❌ |
| Servidor MCP integrado para agentes de IA | ✅ | ❌ | ❌ | ❌ |
| Plugins en **cualquier lenguaje** (JSON-RPC sobre stdio) | ✅ | Plugins Java/Eclipse | Plugins JavaScript | ❌ |
| Text-to-SQL con IA usando **modelos locales** (Ollama) | ✅ | Asistente de IA en la nube | ❌ | ❌ |
| EXPLAIN visual con grafos de plan interactivos | ✅ | ✅ | ❌ | ❌ |
| Bases de datos soportadas de serie | 3 integradas + 12 plugins oficiales | 100+ | 20+ | ~10 |

> Comparativa a junio de 2026; las funcionalidades de las otras herramientas pueden haber cambiado desde entonces. Si necesitas decenas de drivers, usa DBeaver — tabularis se centra en hacer bien unas pocas bases de datos.

### Bases de datos soportadas

PostgreSQL, MySQL/MariaDB y SQLite vienen integradas. Todo lo demás es un plugin — aquí está el estado actual de cada integración, reflejando la [cobertura de drivers y plugins](https://tabularis.dev/#driver-coverage) del sitio web.

Más allá de las integradas: ClickHouse (disponible), Cloudflare D1 (disponible), DuckDB (disponible), Firestore (disponible), IBM Db2 (disponible), IBM Informix (disponible), Redis (disponible), CSV Folder (disponible), Google Sheets (disponible), HackerNews (disponible), Google BigQuery (reclamado), LibSQL / Turso (reclamado), Meilisearch (reclamado), MongoDB (reclamado), Oracle (reclamado), SQL Server (reclamado), Amazon Redshift (planificado), CockroachDB (planificado), TiDB (planificado), DynamoDB (próximamente), Snowflake (próximamente), Cassandra (abierto), Elasticsearch (abierto), Etcd (abierto), Firebird (abierto), ScyllaDB (abierto), SQL Anywhere (abierto), SurrealDB (abierto) y Trino / Presto (abierto).

> Los drivers **disponibles** se instalan desde el [registro de plugins](https://tabularis.dev/plugins). Todo lo demás está en el [tablón de recompensas](https://tabularis.dev/plugins/bounties) — reclama uno, patrocina uno o [solicita una base de datos](https://github.com/TabularisDB/tabularis/discussions).

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

Las builds desde la **v0.13.1** en adelante están firmadas y notarizadas por Apple, así que se abren sin pasos adicionales.

Las siguientes notas solo aplican a releases anteriores (antes de la v0.13.1) descargadas directamente:

- Debes permitir el acceso de accesibilidad (Privacidad y seguridad) a la app tabularis. Si estás actualizando y ya tienes tabularis en la lista de permitidos, elimínalo manualmente antes de poder conceder el acceso de accesibilidad a la nueva versión.
- Puede ser necesario ejecutar `xattr -c /Applications/tabularis.app`.

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

## Contribuir

Las contribuciones son bienvenidas — consulta [CONTRIBUTING.md](./CONTRIBUTING.md). Buenos puntos para empezar:

- [Driver de SQL Server — hoja de ruta de implementación y llamada a contribuidores](https://github.com/TabularisDB/tabularis/issues/150)
- [Sistema de diseño de UI e identidad visual — llamada a contribuidores](https://github.com/TabularisDB/tabularis/issues/195)
- Escribe un plugin de driver en cualquier lenguaje — consulta la [Guía de Plugins](./plugins/PLUGIN_GUIDE.md)

## Historia del proyecto

Tabularis empezó como un experimento: ¿hasta dónde podía llegar el desarrollo asistido por IA construyendo una herramienta funcional desde cero? Más lejos de lo esperado — hoy es un proyecto mantenido activamente, con releases regulares y un ecosistema de plugins.

## Licencia

Apache License 2.0

---

<p align="center">
  ¿Te gusta tabularis? <a href="https://github.com/TabularisDB/tabularis">Dale una estrella al repo</a> ⭐ — ayuda mucho al proyecto.
</p>

<p align="center">
  <a href="https://repostars.dev/?repos=TabularisDB%2Ftabularis&theme=dark">
    <img src="https://repostars.dev/api/embed?repo=TabularisDB%2Ftabularis&theme=dark" alt="RepoStars" />
  </a>
</p>
