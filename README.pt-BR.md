<br />
<p align="center">
  <img src=".github/assets/banner-light.pt-BR.png#gh-light-mode-only" alt="Tabularis" width="100%">
  <img src=".github/assets/banner-dark.pt-BR.png#gh-dark-mode-only" alt="Tabularis" width="100%">
</p>

# Tabularis

Tabularis é um workspace SQL de desktop, de código aberto, com 3 drivers de banco de dados integrados e 21 plugins disponíveis, incluindo DuckDB, ClickHouse, Redis e Firestore. Seu servidor MCP integrado permite que Claude, Cursor e Devin (antigo Windsurf) leiam seu esquema e executem consultas no mesmo aplicativo que você já usa.

<p align="center">
  <b><a href="https://tabularis.dev">Site</a></b> ·
  <b><a href="https://tabularis.dev/wiki">Documentação</a></b> ·
  <b><a href="https://tabularis.dev/download">Download</a></b> ·
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
> Este é um documento traduzido. Para a versão mais atual e oficial, consulte o [README em inglês](./README.md).

<br />

<div align="center">
  <img src="https://raw.githubusercontent.com/TabularisDB/website/main/public/img/overview.gif" alt="Tabularis, um workspace SQL de desktop, com editor de consultas e grade de dados" />
</div>

## Download

```bash
winget install Debba.Tabularis    # Windows
brew install --cask tabularis     # macOS
sudo snap install tabularis       # Linux
```

Ou baixe um instalador diretamente:

- **Windows:** &nbsp;[![Windows](https://img.shields.io/badge/Windows-Download-blue?logo=windows)](https://github.com/TabularisDB/tabularis/releases/download/v0.26.0/tabularis_0.26.0_x64-setup.exe)

- **macOS:** &nbsp;[![macOS (Apple Silicon)](https://img.shields.io/badge/macOS-Apple%20Silicon-black?logo=apple)](https://github.com/TabularisDB/tabularis/releases/download/v0.26.0/tabularis_0.26.0_aarch64.dmg)&nbsp;[![macOS (Intel)](https://img.shields.io/badge/macOS-Intel-black?logo=apple)](https://github.com/TabularisDB/tabularis/releases/download/v0.26.0/tabularis_0.26.0_x64.dmg)

- **Linux:** &nbsp;[![Linux AppImage](https://img.shields.io/badge/Linux-AppImage-green?logo=linux)](https://github.com/TabularisDB/tabularis/releases/download/v0.26.0/tabularis_0.26.0_amd64.AppImage)&nbsp;[![Linux .deb](https://img.shields.io/badge/Linux-.deb-orange?logo=debian)](https://github.com/TabularisDB/tabularis/releases/download/v0.26.0/tabularis_0.26.0_amd64.deb)&nbsp;[![Linux .rpm](https://img.shields.io/badge/Linux-.rpm-red?logo=redhat)](https://github.com/TabularisDB/tabularis/releases/download/v0.26.0/tabularis-0.26.0-1.x86_64.rpm)

A interface do aplicativo está disponível em inglês, italiano, espanhol, chinês (simplificado), francês, alemão, japonês, russo, coreano, tagalo e português (Brasil).

> [!TIP]
> **Discord:** [Junte-se ao nosso servidor](https://discord.com/invite/K2hmhfHRSt) para conversar com os mantenedores, compartilhar feedback e obter ajuda.

## Por que tabularis?

|                                                                           |           **tabularis**            |            DBeaver CE             |     TablePlus      |   Beekeeper Studio    |
| ------------------------------------------------------------------------- | :--------------------------------: | :-------------------------------: | :----------------: | :-------------------: |
| Licença                                                                   |        Apache 2.0, gratuito        | Apache 2.0, gratuito (Pro é pago) |     Comercial      | GPLv3 (edições pagas) |
| Notebooks SQL (células SQL + Markdown, variáveis entre células, gráficos) |                 ✅                 |                ❌                 |         ❌         |          ❌           |
| Servidor MCP integrado para agentes de IA                                 |                 ✅                 |                ❌                 |         ❌         |          ❌           |
| Plugins em **qualquer linguagem** (JSON-RPC via stdio)                    |                 ✅                 |       Plugins Java/Eclipse        | Plugins JavaScript |          ❌           |
| IA text-to-SQL com **modelos locais** (Ollama)                            |                 ✅                 |     Assistente de IA na nuvem     |         ❌         |          ❌           |
| EXPLAIN Visual com gráficos de plano interativos                          |                 ✅                 |                ✅                 |         ❌         |          ❌           |
| Bancos de dados prontos para uso                                          | 3 integrados + 21 plugins oficiais |               100+                |        20+         |          ~10          |

> [!NOTE]
> Comparação de junho de 2026; os recursos de outras ferramentas podem ter mudado desde então. Se você precisa de dezenas de drivers, use o DBeaver. O Tabularis foca em fazer bem um número menor de bancos de dados.

### Suporte a bancos de dados

PostgreSQL, MySQL/MariaDB e SQLite já vêm integrados. O driver PostgreSQL integrado está obsoleto em favor do [plugin PostgreSQL](https://github.com/TabularisDB/tabularis-postgresql-plugin), que o Tabularis instala automaticamente. Todo o resto é um plugin. A cobertura atual espelha a [cobertura de drivers e plugins](https://tabularis.dev/#driver-coverage) no site:

**Disponíveis**

| Banco de dados           | Plugin                                                                                          | Banco de dados | Plugin                                                                                          |
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

**No quadro de recompensas**

| Status       | Bancos de dados                                                              |
| ------------ | ---------------------------------------------------------------------------- |
| Reivindicado | Google BigQuery, Meilisearch                                                 |
| Planejado    | Amazon Redshift, CockroachDB, TiDB                                           |
| Em breve     | Snowflake                                                                    |
| Aberto       | Cassandra, Etcd, Firebird, ScyllaDB, SQL Anywhere, SurrealDB, Trino / Presto |

> [!NOTE]
> Os drivers **disponíveis** podem ser instalados a partir do [registro de plugins](https://tabularis.dev/plugins). Todo o resto está no [quadro de recompensas](https://tabularis.dev/plugins/bounties): reivindique um, patrocine um ou [solicite um banco de dados](https://github.com/TabularisDB/tabularis/discussions).

## Instalação

### Windows

```bash
winget install Debba.Tabularis
```

Ou baixe o instalador na [página de Releases](https://github.com/TabularisDB/tabularis/releases).

### macOS

```bash
brew install --cask tabularis
```

Builds a partir da **v0.13.1** são assinados e notarizados pela Apple, então abrem sem nenhuma etapa extra.

<details>
<summary>Observações para versões anteriores à v0.13.1</summary>

<br />

As observações abaixo se aplicam apenas a versões antigas (anteriores à v0.13.1) baixadas diretamente:

- Você precisa permitir o acesso de acessibilidade (Privacidade e Segurança) ao aplicativo tabularis. Se estiver atualizando e já tiver o tabularis na lista de permitidos, remova-o manualmente antes que o acesso de acessibilidade possa ser concedido à nova versão.
- Depois de copiar o aplicativo para o diretório Applications, você também pode precisar executar:

```bash
xattr -c /Applications/tabularis.app
```

</details>

### Linux

**Snap**

```bash
sudo snap install tabularis
sudo snap connect tabularis:password-manager-service   # acesso ao Keychain para credenciais salvas
```

> [!IMPORTANT]
> A interface `password-manager-service` ainda não é conectada automaticamente pela Snap Store. Sem ela, salvar uma conexão falha com o erro `Platform secure storage failure`.

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

## Atualizações

- Verificação automática de atualizações ao iniciar.
- Atualização manual possível pelo GitHub Releases.

## Galeria

Veja a galeria completa em [tabularis.dev](https://tabularis.dev).

## Funcionalidades

### Gerenciamento de Conexões

<sub>[Referência completa em tabularis.dev →](https://tabularis.dev/wiki/connections)</sub>

- Suporte para PostgreSQL, MySQL/MariaDB e SQLite.
- Perfis de conexão salvos localmente.
- Túnel SSH e armazenamento de senhas no Keychain do sistema.
- Página de conexões com visualização em grade/lista e busca em tempo real.
- Aparência por conexão: ícone personalizado (Lucide, emoji ou imagem personalizada) e cor de destaque.

### Explorador de Banco de Dados

<sub>[Referência completa em tabularis.dev →](https://tabularis.dev/wiki/schema-management)</sub>

- Navegue por tabelas, colunas, chaves, índices, views e rotinas.
- Edição em linha de elementos selecionados do esquema.
- Diagrama ER interativo.
- Ações rápidas pelos menus de contexto.

### Editor SQL

<sub>[Referência completa em tabularis.dev →](https://tabularis.dev/wiki/editor)</sub>

- Editor Monaco com destaque de sintaxe e autocompletar.
- Várias abas com conexões isoladas.
- Execução de múltiplas consultas com resultados separados.
- Consultas salvas e sobreposição de IA no editor.

### Notebooks SQL

<sub>[Referência completa em tabularis.dev →](https://tabularis.dev/wiki/notebooks)</sub>

- Células SQL e Markdown no mesmo documento.
- Resultados em linha e gráficos.
- Variáveis entre células e parâmetros globais.
- Execução sequencial de todas as células.

### Construtor Visual de Consultas

<sub>[Referência completa em tabularis.dev →](https://tabularis.dev/wiki/visual-query-builder)</sub>

- Construção de consultas por arrastar e soltar.
- JOINs visuais, filtros, agregações, ordenação e limites.
- SQL gerado em tempo real.

### EXPLAIN Visual

<sub>[Referência completa em tabularis.dev →](https://tabularis.dev/wiki/visual-explain)</sub>

- Planos de execução como grafos navegáveis.
- Visão em tabela, visão bruta e análise opcional por IA.
- Suporte para PostgreSQL, MySQL/MariaDB e SQLite.

### Grade de Dados

<sub>[Referência completa em tabularis.dev →](https://tabularis.dev/wiki/data-grid)</sub>

- Edição em linha e em lote.
- Criação, seleção e exclusão de linhas.
- Exportação como CSV ou JSON.
- Suporte inicial a dados espaciais.
- Células JSON/JSONB com destaque e janela de editor dedicada (Árvore / Monaco / Bruto). Opcional por conexão: detectar JSON em colunas de texto.

### Logs

- Visualizador de logs em tempo real nas Configurações.
- Filtragem por nível.
- Exportação para arquivos `.log`.
- Modo Debug via CLI: `tabularis --debug`.

### Plugins

<sub>[Referência completa em tabularis.dev →](https://tabularis.dev/wiki/plugins)</sub>

- Sistema de plugins externo via JSON-RPC 2.0 pelo stdin/stdout.
- Drivers da comunidade instaláveis sem reiniciar.
- Registro oficial: [`plugins/registry.json`](./plugins/registry.json).
- Guia do desenvolvedor: [`plugins/PLUGIN_GUIDE.md`](./plugins/PLUGIN_GUIDE.md).

## Configuração

<sub>[Referência completa em tabularis.dev →](https://tabularis.dev/wiki/configuration)</sub>

A configuração é armazenada em:

- Linux: `~/.config/tabularis/`
- macOS: `~/Library/Application Support/tabularis/`
- Windows: `%APPDATA%\tabularis\`

Arquivos principais:

- `connections.json`
- `saved_queries.json`
- `config.json`
- `themes/`
- `preferences/`
- `connection-icons/` (imagens personalizadas para os ícones de conexão)

Em `config.json`, o campo `language` aceita os valores `auto`, `en`, `it`, `es`, `zh`, `fr`, `de`, `ja`, `ru`, `ko`, `tl` e `pt-BR`.

## IA

<sub>[Referência completa em tabularis.dev →](https://tabularis.dev/wiki/ai-assistant)</sub>

Text-to-SQL opcional e explicação de consultas com:

- OpenAI
- Anthropic
- MiniMax
- OpenRouter
- Ollama
- APIs compatíveis com OpenAI

Os modelos são carregados dinamicamente e armazenados em cache localmente.

## MCP

<sub>[Referência completa em tabularis.dev →](https://tabularis.dev/wiki/mcp-server)</sub>

Inicie o servidor MCP integrado:

```bash
tabularis --mcp
```

Clientes suportados:

- Claude Desktop
- Cursor
- Windsurf

Ferramentas disponíveis:

| Ferramenta         | Descrição                                                       |
| ------------------ | --------------------------------------------------------------- |
| `list_connections` | Lista todas as conexões de banco de dados salvas                |
| `list_databases`   | Lista todos os bancos de dados disponíveis para uma conexão     |
| `list_tables`      | Lista tabelas em uma conexão (com filtro de esquema opcional)   |
| `describe_table`   | Obtém o esquema completo: colunas, índices, chaves estrangeiras |
| `run_query`        | Executa qualquer consulta SQL e retorna os resultados           |

## Stack Tecnológica

| Camada   | Stack                                 |
| -------- | ------------------------------------- |
| Frontend | React 19, TypeScript, Tailwind CSS v4 |
| Backend  | Rust, Tauri v2, SQLx                  |

## Desenvolvimento

**Configuração**

```bash
pnpm install
pnpm tauri dev
```

**Build**

```bash
pnpm tauri build
```

## Roadmap

O roadmap é gerado automaticamente a partir das issues do GitHub. Veja o estado atual no [README em inglês](./README.md#roadmap).

## Contribuindo

Contribuições são bem-vindas, veja [CONTRIBUTING.md](./CONTRIBUTING.md). Bons pontos de partida:

- [Plugin de driver SQL Server: teste o driver e assuma issues abertas](https://github.com/TabularisDB/tabularis-sqlserver-plugin)
- [Sistema de design da UI e identidade visual: chamada para contribuidores](https://github.com/TabularisDB/tabularis/issues/195)
- Escreva um plugin de driver em qualquer linguagem com o [Guia de Plugins](./plugins/PLUGIN_GUIDE.md)

## Patrocinadores e apoiadores

O Tabularis é apoiado por patrocinadores e apoiadores incríveis. Veja a lista completa no [README em inglês](./README.md#sponsors-and-supporters) e em [tabularis.dev/sponsors](https://tabularis.dev/sponsors).

## História de Origem

O Tabularis começou como um experimento: até onde o desenvolvimento assistido por IA poderia chegar na construção de uma ferramenta funcional do zero? Mais longe do que o esperado: hoje é um projeto ativamente mantido, com lançamentos regulares e um ecossistema de plugins.

## Licença

[Apache License 2.0](./LICENSE)

---

<p align="center">
  Gosta do tabularis? <a href="https://github.com/TabularisDB/tabularis">Dê uma estrela no repositório</a> ⭐, isso ajuda muito o projeto.
</p>

<p align="center">
  <a href="https://repostars.dev/?repos=TabularisDB%2Ftabularis&theme=dark">
    <img src="https://repostars.dev/api/embed?repo=TabularisDB%2Ftabularis&theme=dark" alt="RepoStars" />
  </a>
</p>
