<br />
<p align="center">
  <img src=".github/assets/banner-light.es.png#gh-light-mode-only" alt="Tabularis" width="100%">
  <img src=".github/assets/banner-dark.es.png#gh-dark-mode-only" alt="Tabularis" width="100%">
</p>

# Tabularis

Tabularis es un espacio de trabajo SQL de escritorio open source con 3 drivers de bases de datos integrados y 21 plugins publicados, entre ellos DuckDB, ClickHouse, Redis y Firestore. Su servidor MCP integrado permite que Claude, Cursor y Devin (antes Windsurf) lean tu esquema y ejecuten consultas en la misma app que ya usas.

<p align="center">
  <b><a href="https://tabularis.dev">Sitio web</a></b> ·
  <b><a href="https://tabularis.dev/wiki">Documentación</a></b> ·
  <b><a href="https://tabularis.dev/download">Descarga</a></b> ·
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
> Documento traducido. Para la versión de referencia más actualizada, consulta el [README en inglés](./README.md).

<br />

<div align="center">
  <img src="https://raw.githubusercontent.com/TabularisDB/website/main/public/img/overview.gif" alt="Tabularis, un espacio de trabajo SQL de escritorio, con el editor de consultas y la cuadrícula de datos" />
</div>

## Descargas

```bash
winget install Debba.Tabularis    # Windows
brew install --cask tabularis     # macOS
sudo snap install tabularis       # Linux
```

O descarga un instalador directamente:

- **Windows:** &nbsp;[![Windows](https://img.shields.io/badge/Windows-Download-blue?logo=windows)](https://github.com/TabularisDB/tabularis/releases/download/v0.26.0/tabularis_0.26.0_x64-setup.exe)

- **macOS:** &nbsp;[![macOS (Apple Silicon)](https://img.shields.io/badge/macOS-Apple%20Silicon-black?logo=apple)](https://github.com/TabularisDB/tabularis/releases/download/v0.26.0/tabularis_0.26.0_aarch64.dmg)&nbsp;[![macOS (Intel)](https://img.shields.io/badge/macOS-Intel-black?logo=apple)](https://github.com/TabularisDB/tabularis/releases/download/v0.26.0/tabularis_0.26.0_x64.dmg)

- **Linux:** &nbsp;[![Linux AppImage](https://img.shields.io/badge/Linux-AppImage-green?logo=linux)](https://github.com/TabularisDB/tabularis/releases/download/v0.26.0/tabularis_0.26.0_amd64.AppImage)&nbsp;[![Linux .deb](https://img.shields.io/badge/Linux-.deb-orange?logo=debian)](https://github.com/TabularisDB/tabularis/releases/download/v0.26.0/tabularis_0.26.0_amd64.deb)&nbsp;[![Linux .rpm](https://img.shields.io/badge/Linux-.rpm-red?logo=redhat)](https://github.com/TabularisDB/tabularis/releases/download/v0.26.0/tabularis-0.26.0-1.x86_64.rpm)

La interfaz de la aplicación está disponible en inglés, italiano, español, chino (simplificado), francés, alemán, japonés, ruso, coreano, tagalo y portugués (brasileño).

> [!TIP]
> **Discord:** [Únete al servidor](https://discord.com/invite/K2hmhfHRSt) para hablar con los mantenedores, compartir feedback y pedir ayuda.

## ¿Por qué tabularis?

|                                                                         |            **tabularis**            |             DBeaver CE              |     TablePlus      |     Beekeeper Studio      |
| ----------------------------------------------------------------------- | :---------------------------------: | :---------------------------------: | :----------------: | :-----------------------: |
| Licencia                                                                |         Apache 2.0, gratis          | Apache 2.0, gratis (Pro es de pago) |     Comercial      | GPLv3 (ediciones de pago) |
| Notebooks SQL (celdas SQL + Markdown, variables entre celdas, gráficos) |                 ✅                  |                 ❌                  |         ❌         |            ❌             |
| Servidor MCP integrado para agentes de IA                               |                 ✅                  |                 ❌                  |         ❌         |            ❌             |
| Plugins en **cualquier lenguaje** (JSON-RPC sobre stdio)                |                 ✅                  |        Plugins Java/Eclipse         | Plugins JavaScript |            ❌             |
| Text-to-SQL con IA usando **modelos locales** (Ollama)                  |                 ✅                  |     Asistente de IA en la nube      |         ❌         |            ❌             |
| EXPLAIN visual con grafos de plan interactivos                          |                 ✅                  |                 ✅                  |         ❌         |            ❌             |
| Bases de datos soportadas de serie                                      | 3 integradas + 21 plugins oficiales |                100+                 |        20+         |            ~10            |

> [!NOTE]
> Comparativa a junio de 2026; las funcionalidades de las otras herramientas pueden haber cambiado desde entonces. Si necesitas decenas de drivers, usa DBeaver. Tabularis se centra en hacer bien unas pocas bases de datos.

### Bases de datos soportadas

PostgreSQL, MySQL/MariaDB y SQLite vienen integradas. El driver de PostgreSQL integrado está obsoleto en favor del [plugin de PostgreSQL](https://github.com/TabularisDB/tabularis-postgresql-plugin), que Tabularis instala automáticamente. Todo lo demás es un plugin. El estado actual refleja la [cobertura de drivers y plugins](https://tabularis.dev/#driver-coverage) del sitio web:

**Disponibles**

| Base de datos            | Plugin                                                                                          | Base de datos  | Plugin                                                                                          |
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

**En el tablón de recompensas**

| Estado       | Bases de datos                                                               |
| ------------ | ---------------------------------------------------------------------------- |
| Reclamado    | Google BigQuery, Meilisearch                                                 |
| Planificado  | Amazon Redshift, CockroachDB, TiDB                                           |
| Próximamente | Snowflake                                                                    |
| Abierto      | Cassandra, Etcd, Firebird, ScyllaDB, SQL Anywhere, SurrealDB, Trino / Presto |

> [!NOTE]
> Los drivers **disponibles** se instalan desde el [registro de plugins](https://tabularis.dev/plugins). Todo lo demás está en el [tablón de recompensas](https://tabularis.dev/plugins/bounties): reclama uno, patrocina uno o [solicita una base de datos](https://github.com/TabularisDB/tabularis/discussions).

## Instalación

### Windows

```bash
winget install Debba.Tabularis
```

O descarga el instalador desde la [página de Releases](https://github.com/TabularisDB/tabularis/releases).

### macOS

```bash
brew install --cask tabularis
```

Las builds desde la **v0.13.1** en adelante están firmadas y notarizadas por Apple, así que se abren sin pasos adicionales.

<details>
<summary>Notas para releases anteriores a la v0.13.1</summary>

<br />

Las siguientes notas solo aplican a releases anteriores (antes de la v0.13.1) descargadas directamente:

- Debes permitir el acceso de accesibilidad (Privacidad y seguridad) a la app tabularis. Si estás actualizando y ya tienes tabularis en la lista de permitidos, elimínalo manualmente antes de poder conceder el acceso de accesibilidad a la nueva versión.
- Después de copiar la app a la carpeta Aplicaciones, puede ser necesario ejecutar:

```bash
xattr -c /Applications/tabularis.app
```

</details>

### Linux

**Snap**

```bash
sudo snap install tabularis
sudo snap connect tabularis:password-manager-service   # acceso al llavero para las credenciales guardadas
```

> [!IMPORTANT]
> La Snap Store todavía no conecta automáticamente la interfaz `password-manager-service`. Sin ella, guardar una conexión falla con el error `Platform secure storage failure`.

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

## Actualizaciones

- Comprobación automática de actualizaciones al iniciar la app.
- Posibilidad de actualizar manualmente desde las releases de GitHub.

## Galería

La galería completa está en [tabularis.dev](https://tabularis.dev).

## Funcionalidades

### Conexiones

<sub>[Referencia completa en tabularis.dev →](https://tabularis.dev/wiki/connections)</sub>

- Soporte para PostgreSQL, MySQL/MariaDB y SQLite.
- Perfiles de conexión guardados localmente.
- Túneles SSH y almacenamiento de contraseñas en el llavero del sistema.
- Página de conexiones con vista de cuadrícula/lista y búsqueda en tiempo real.
- Apariencia personalizada por conexión: icono propio (Lucide, emoji o imagen) y color de acento.

### Explorador de base de datos

<sub>[Referencia completa en tabularis.dev →](https://tabularis.dev/wiki/schema-management)</sub>

- Navegación de tablas, columnas, claves, índices, vistas y rutinas.
- Edición inline de partes del esquema.
- Diagrama ER interactivo.
- Acciones rápidas desde menús contextuales.

### Editor SQL

<sub>[Referencia completa en tabularis.dev →](https://tabularis.dev/wiki/editor)</sub>

- Monaco Editor con resaltado y autocompletado.
- Múltiples pestañas con conexiones aisladas.
- Ejecución multi-query con resultados separados.
- Consultas guardadas y overlay de IA dentro del editor.

### Notebooks SQL

<sub>[Referencia completa en tabularis.dev →](https://tabularis.dev/wiki/notebooks)</sub>

- Celdas SQL y Markdown en un mismo documento.
- Resultados inline y gráficos.
- Variables entre celdas y parámetros globales.
- Ejecución secuencial de todas las celdas.

### Constructor visual de consultas

<sub>[Referencia completa en tabularis.dev →](https://tabularis.dev/wiki/visual-query-builder)</sub>

- Construcción drag-and-drop.
- JOINs visuales, filtros, agregaciones, ordenación y límites.
- SQL generado en tiempo real.

### Visual EXPLAIN

<sub>[Referencia completa en tabularis.dev →](https://tabularis.dev/wiki/visual-explain)</sub>

- Planes de ejecución como grafos navegables.
- Vistas tabular, raw y análisis opcional con IA.
- Compatible con PostgreSQL, MySQL/MariaDB y SQLite.

### Data Grid

<sub>[Referencia completa en tabularis.dev →](https://tabularis.dev/wiki/data-grid)</sub>

- Edición inline y por lotes.
- Creación, selección y borrado de filas.
- Exportación a CSV o JSON.
- Soporte inicial para datos espaciales.
- Celdas JSON/JSONB con resaltado y ventana de edición dedicada (Árbol / Monaco / Raw). Opcional por conexión: detectar JSON en columnas de texto.

### Logging

- Logs en tiempo real desde los ajustes.
- Filtros por nivel.
- Exportación a archivos `.log`.
- Modo debug por CLI: `tabularis --debug`.

### Plugins

<sub>[Referencia completa en tabularis.dev →](https://tabularis.dev/wiki/plugins)</sub>

- Sistema externo vía JSON-RPC 2.0 por stdin/stdout.
- Instalación de drivers comunitarios sin reiniciar.
- Registro oficial en [`plugins/registry.json`](./plugins/registry.json).
- Guía para desarrolladores en [`plugins/PLUGIN_GUIDE.md`](./plugins/PLUGIN_GUIDE.md).

## Configuración

<sub>[Referencia completa en tabularis.dev →](https://tabularis.dev/wiki/configuration)</sub>

La configuración se guarda en:

- Linux: `~/.config/tabularis/`
- macOS: `~/Library/Application Support/tabularis/`
- Windows: `%APPDATA%\tabularis\`

Archivos principales:

- `connections.json`
- `saved_queries.json`
- `config.json`
- `themes/`
- `preferences/`
- `connection-icons/` (imágenes personalizadas para iconos de conexiones)

En `config.json`, el campo `language` admite `auto`, `en`, `it`, `es`, `zh`, `fr`, `de`, `ja`, `ru`, `ko`, `tl` y `pt-BR`.

## IA

<sub>[Referencia completa en tabularis.dev →](https://tabularis.dev/wiki/ai-assistant)</sub>

Funciones opcionales de text-to-SQL y explicación de consultas con:

- OpenAI
- Anthropic
- MiniMax
- OpenRouter
- Ollama
- APIs compatibles con OpenAI

La lista de modelos se obtiene dinámicamente y se cachea localmente.

## MCP

<sub>[Referencia completa en tabularis.dev →](https://tabularis.dev/wiki/mcp-server)</sub>

Iniciar el servidor MCP integrado:

```bash
tabularis --mcp
```

Clientes soportados:

- Claude Desktop
- Cursor
- Windsurf

Herramientas disponibles:

| Herramienta        | Descripción                                                            |
| ------------------ | ---------------------------------------------------------------------- |
| `list_connections` | Lista todas las conexiones guardadas                                   |
| `list_databases`   | Lista todas las bases de datos de una conexión                         |
| `list_tables`      | Lista las tablas de una conexión (opcionalmente filtradas por esquema) |
| `describe_table`   | Obtiene el esquema completo: columnas, índices, claves foráneas        |
| `run_query`        | Ejecuta cualquier consulta SQL y devuelve los resultados               |

## Stack Tecnológico

| Capa     | Stack                                 |
| -------- | ------------------------------------- |
| Frontend | React 19, TypeScript, Tailwind CSS v4 |
| Backend  | Rust, Tauri v2, SQLx                  |

## Desarrollo

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

El roadmap se genera automáticamente a partir de las issues de GitHub. Consulta el estado actual en el [README en inglés](./README.md#roadmap).

## Contribuir

Las contribuciones son bienvenidas, consulta [CONTRIBUTING.md](./CONTRIBUTING.md). Buenos puntos para empezar:

- [Plugin de driver de SQL Server: prueba el driver y reclama issues abiertas](https://github.com/TabularisDB/tabularis-sqlserver-plugin)
- [Sistema de diseño de UI e identidad visual: llamada a contribuidores](https://github.com/TabularisDB/tabularis/issues/195)
- Escribe un plugin de driver en cualquier lenguaje con la [Guía de Plugins](./plugins/PLUGIN_GUIDE.md)

## Patrocinadores y colaboradores

Tabularis cuenta con el apoyo de patrocinadores y colaboradores increíbles. Consulta la lista completa en el [README en inglés](./README.md#sponsors-and-supporters) y en [tabularis.dev/sponsors](https://tabularis.dev/sponsors).

## Historia del proyecto

Tabularis empezó como un experimento: ¿hasta dónde podía llegar el desarrollo asistido por IA construyendo una herramienta funcional desde cero? Más lejos de lo esperado: hoy es un proyecto mantenido activamente, con releases regulares y un ecosistema de plugins.

## Licencia

[Apache License 2.0](./LICENSE)

---

<p align="center">
  ¿Te gusta tabularis? <a href="https://github.com/TabularisDB/tabularis">Dale una estrella al repo</a> ⭐, ayuda mucho al proyecto.
</p>

<p align="center">
  <a href="https://repostars.dev/?repos=TabularisDB%2Ftabularis&theme=dark">
    <img src="https://repostars.dev/api/embed?repo=TabularisDB%2Ftabularis&theme=dark" alt="RepoStars" />
  </a>
</p>
