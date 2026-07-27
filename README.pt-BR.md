<div align="center">
  <img src="public/logo-sm.png" width="120" height="120" />
</div>

# tabularis

<p align="center">
  <strong>Tabularis é um workspace SQL de desktop, de código aberto, para PostgreSQL, MySQL/MariaDB, SQLite e mais de 15 outros bancos de dados como DuckDB, ClickHouse, Redis e Firestore.<br />
  Seu servidor MCP integrado permite que Claude, Cursor e Devin (antigo Windsurf) leiam seu esquema e executem consultas no mesmo aplicativo que você já usa.</strong>
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
  <a href="./README.ru.md">Русский</a> |
  <a href="./README.tl.md">Tagalog</a> |
  <a href="./README.ko.md">한국어</a> |
  <a href="./README.pt-BR.md">Português (Brasil)</a>
</p>

<p align="center">
  
![](https://img.shields.io/github/release/TabularisDB/tabularis.svg?style=flat)
![](https://img.shields.io/github/stars/TabularisDB/tabularis?style=flat)
![](https://img.shields.io/github/downloads/TabularisDB/tabularis/total.svg?style=flat)
![Build & Release](https://github.com/TabularisDB/tabularis/workflows/Release/badge.svg)
[![Discord](https://img.shields.io/discord/1502944695808950282?color=5865F2&logo=discord&logoColor=white)](https://discord.com/invite/K2hmhfHRSt)
[![Gitster](https://gitster.dev/api/repositories/badge/cmlko1jr60005ne4yh7i7oy3e)](https://gitster.dev/repo/TabularisDB/tabularis)
<br />
<br />
<a href="https://vercel.com/open-source-program">
  <img alt="Vercel OSS Program" src="https://vercel.com/oss/program-badge-2026.svg" />
</a>

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

> Este é um documento traduzido. Para a versão mais atual e oficial, consulte também o [README em inglês](./README.md).

## Download

```bash
winget install Debba.Tabularis                                   # Windows
brew tap TabularisDB/tabularis && brew install --cask tabularis  # macOS
sudo snap install tabularis                                      # Linux
```

Ou baixe um instalador diretamente:

[![Windows](https://img.shields.io/badge/Windows-Download-blue?logo=windows)](https://github.com/TabularisDB/tabularis/releases/download/v0.16.0/tabularis_0.16.0_x64-setup.exe) [![macOS (Apple Silicon)](https://img.shields.io/badge/macOS-Apple%20Silicon-black?logo=apple)](https://github.com/TabularisDB/tabularis/releases/download/v0.16.0/tabularis_0.16.0_aarch64.dmg) [![macOS (Intel)](https://img.shields.io/badge/macOS-Intel-black?logo=apple)](https://github.com/TabularisDB/tabularis/releases/download/v0.16.0/tabularis_0.16.0_x64.dmg) [![Linux AppImage](https://img.shields.io/badge/Linux-AppImage-green?logo=linux)](https://github.com/TabularisDB/tabularis/releases/download/v0.16.0/tabularis_0.16.0_amd64.AppImage) [![Linux .deb](https://img.shields.io/badge/Linux-.deb-orange?logo=debian)](https://github.com/TabularisDB/tabularis/releases/download/v0.16.0/tabularis_0.16.0_amd64.deb) [![Linux .rpm](https://img.shields.io/badge/Linux-.rpm-red?logo=redhat)](https://github.com/TabularisDB/tabularis/releases/download/v0.16.0/tabularis-0.16.0-1.x86_64.rpm)

A interface do aplicativo está disponível em inglês, italiano, espanhol, chinês (simplificado), francês, alemão, japonês, russo, tagalo e português (Brasil).

**Discord** — [Junte-se ao nosso servidor no Discord](https://discord.com/invite/K2hmhfHRSt) para conversar com os mantenedores, compartilhar feedback e obter ajuda da comunidade.

## Sumário

- [Por que tabularis?](#por-que-tabularis)
  - [Suporte a bancos de dados](#suporte-a-bancos-de-dados)
- [Instalação](#instalação)
  - [Windows](#windows)
  - [macOS](#macos)
  - [Linux (Snap)](#linux-snap)
  - [Linux (Flatpak)](#linux-flatpak)
  - [Linux (AppImage)](#linux-appimage)
  - [Arch Linux (AUR)](#arch-linux-aur)
- [Atualizações](#atualizações)
- [Discord](#discord)
- [Changelog](#changelog)
- [Funcionalidades](#funcionalidades)
  - [Gerenciamento de Conexões](#gerenciamento-de-conexões)
  - [Explorador de Banco de Dados](#explorador-de-banco-de-dados)
  - [Editor SQL](#editor-sql)
  - [Notebooks SQL](#notebooks-sql)
  - [Atalhos de Teclado](#atalhos-de-teclado)
  - [Construtor Visual de Consultas](#construtor-visual-de-consultas)
  - [EXPLAIN Visual](#explain-visual)
  - [Grade de Dados](#grade-de-dados)
  - [Logs](#logs)
  - [Sistema de Plugins](#sistema-de-plugins)
- [Armazenamento de Configuração](#armazenamento-de-configuração)
  - [Recursos de IA (Opcional)](#recursos-de-ia-opcional)
  - [Servidor MCP — Integração com Agentes de IA](#servidor-mcp--integração-com-agentes-de-ia)
- [Stack Tecnológica](#stack-tecnológica)
- [Desenvolvimento](#desenvolvimento)
- [Roadmap](#roadmap)
- [Contribuindo](#contribuindo)
- [Patrocinadores](#patrocinadores)
- [História de Origem](#história-de-origem)
- [Licença](#licença)

## Por que tabularis?

|  | **tabularis** | DBeaver CE | TablePlus | Beekeeper Studio |
|---|---|---|---|---|
| Licença | Apache 2.0, gratuito | Apache 2.0, gratuito (Pro é pago) | Comercial | GPLv3 (edições pagas) |
| Notebooks SQL (células SQL + Markdown, variáveis entre células, gráficos) | ✅ | ❌ | ❌ | ❌ |
| Servidor MCP integrado para agentes de IA | ✅ | ❌ | ❌ | ❌ |
| Plugins em **qualquer linguagem** (JSON-RPC via stdio) | ✅ | Plugins Java/Eclipse | Plugins JavaScript | ❌ |
| IA text-to-SQL com **modelos locais** (Ollama) | ✅ | Assistente de IA na nuvem | ❌ | ❌ |
| EXPLAIN Visual com gráficos de plano interativos | ✅ | ✅ | ❌ | ❌ |
| Bancos de dados prontos para uso | 3 integrados + 15 plugins oficiais | 100+ | 20+ | ~10 |

> Comparação de junho de 2026; os recursos de outras ferramentas podem ter mudado desde então. Se você precisa de dezenas de drivers, use o DBeaver — o tabularis foca em fazer bem um número menor de bancos de dados.

### Suporte a bancos de dados

PostgreSQL, MySQL/MariaDB e SQLite já vêm integrados. Tudo o mais é um plugin — a cobertura atual (espelhando a [cobertura de drivers e plugins](https://tabularis.dev/#driver-coverage) no site):

ClickHouse (disponível), Cloudflare D1 (disponível), DM / Dameng (disponível), DuckDB (disponível), Firestore (disponível), IBM Db2 (disponível), IBM Informix (disponível), Redis (disponível), CSV Folder (disponível), Google Sheets (disponível), HackerNews (disponível), Google BigQuery (reivindicado), LibSQL / Turso (reivindicado), Meilisearch (reivindicado), MongoDB (reivindicado), Oracle (reivindicado), SQL Server (reivindicado), Amazon Redshift (planejado), CockroachDB (planejado), TiDB (planejado), DynamoDB (em breve), Snowflake (em breve), Cassandra (aberto), Elasticsearch (aberto), Etcd (aberto), Firebird (aberto), ScyllaDB (aberto), SQL Anywhere (aberto), SurrealDB (aberto), Trino / Presto (aberto).

> Os drivers **disponíveis** podem ser instalados a partir do [registro de plugins](https://tabularis.dev/plugins). Todo o resto está no [quadro de recompensas](https://tabularis.dev/plugins/bounties) — reivindique um, patrocine um, ou [solicite um banco de dados](https://github.com/TabularisDB/tabularis/discussions).

## Instalação

### Windows

#### WinGet (Recomendado)

```bash
winget install Debba.Tabularis
```

#### Download Direto

Baixe o instalador na [página de Releases](https://github.com/TabularisDB/tabularis/releases) e execute-o:

```
tabularis_x.x.x_x64-setup.exe
```

Siga as instruções na tela para concluir a instalação.

### macOS

#### Homebrew (Recomendado)

Para adicionar nosso tap, execute:

```bash
brew tap TabularisDB/tabularis
```

Depois instale:

```bash
brew install --cask tabularis
```

[![Homebrew](https://img.shields.io/badge/Homebrew-Repository-orange?logo=homebrew)](https://github.com/debba/homebrew-tabularis)

#### Download Direto

Builds a partir da **v0.13.1** são assinados e notarizados pela Apple, então abrem sem nenhuma etapa extra.

As observações abaixo se aplicam apenas a **versões antigas (anteriores à v0.13.1)** baixadas diretamente:

- Você precisa permitir o acesso de acessibilidade (Privacidade e Segurança) ao aplicativo tabularis. Se estiver atualizando e já tiver o tabularis na lista de permitidos, remova-o manualmente antes que o acesso de acessibilidade possa ser concedido à nova versão.
- Você pode precisar executar `xattr -c /Applications/tabularis.app` depois de copiar o aplicativo para o diretório Applications.

### Linux (Snap)

```bash
sudo snap install tabularis
```

[![Snap Store](https://img.shields.io/badge/snap-tabularis-blue?logo=snapcraft)](https://snapcraft.io/tabularis)

### Linux (Flatpak)

```bash
flatpak remote-add --if-not-exists flatpark https://dl.flatpark.org/flatpark.flatpakrepo
flatpak install flatpark dev.tabularis.Tabularis
```

[![Flatpak (Flatpark)](https://img.shields.io/badge/flatpak-tabularis-4A90D9?logo=flatpak&logoColor=white)](https://flatpark.org/apps/dev.tabularis.Tabularis/)

### Linux (AppImage)

Baixe o arquivo `.AppImage` na [página de Releases](https://github.com/TabularisDB/tabularis/releases), torne-o executável e execute-o:

```bash
chmod +x tabularis_x.x.x_amd64.AppImage
./tabularis_x.x.x_amd64.AppImage
```

### Arch Linux (AUR)

```bash
yay -S tabularis-bin
```

## Atualizações

O Tabularis verifica automaticamente se há atualizações ao iniciar e notifica você quando uma nova versão está disponível. Você também pode baixar a versão mais recente diretamente na [página de Releases](https://github.com/TabularisDB/tabularis/releases).

## Discord

Junte-se ao nosso [servidor no Discord](https://discord.com/invite/K2hmhfHRSt) para conversar com os mantenedores, compartilhar feedback, sugerir recursos ou obter ajuda da comunidade.

## [Changelog](./CHANGELOG.md)

## Funcionalidades

### Gerenciamento de Conexões

> [Referência completa em tabularis.dev →](https://tabularis.dev/wiki/connections)

- Suporte para **MySQL/MariaDB**, **PostgreSQL** (com suporte a múltiplos esquemas) e **SQLite**, com seleção de múltiplos bancos de dados por conexão.
- Salve, gerencie e clone perfis de conexão, com armazenamento seguro opcional de senha no **Keychain** do sistema.
- **Túnel SSH** com detecção automática de prontidão.
- **Aparência por Conexão:** personalize o ícone ([Lucide](https://lucide.dev/icons/), emoji ou imagem personalizada) e a cor de destaque de cada conexão salva.

### Explorador de Banco de Dados

> [Referência completa em tabularis.dev →](https://tabularis.dev/wiki/schema-management)

- **Visualização em Árvore:** Navegue por tabelas, colunas, chaves, índices, views e rotinas armazenadas — com edição em linha a partir da barra lateral.
- **Diagrama ER:** Visualização interativa de Entidade-Relacionamento (arrastar, zoom, layout) com geração seletiva de diagrama de tabelas.
- **Ações de Contexto:** Mostrar dados, contar linhas, modificar esquema, duplicar/excluir tabelas.
- **Dump e Importação SQL:** Exporte e restaure bancos de dados em um único fluxo.

### Editor SQL

> [Referência completa em tabularis.dev →](https://tabularis.dev/wiki/editor)

- **Editor Monaco** com destaque de sintaxe e autocompletar, em uma interface com abas com conexões isoladas por aba e **visualização dividida** redimensionável.
- **Execução Multi-Instrução:** Execute Tudo, Execute Selecionado ou escolha consultas individuais — os resultados aparecem em abas separadas com paginação independente.
- **Divisão Inteligente de Consultas:** Trata corretamente stored procedures, funções e blocos delimitados por `$$`.
- **Consultas Salvas** e uma **sobreposição de assistente de IA** diretamente no editor.

### Notebooks SQL

> [Referência completa em tabularis.dev →](https://tabularis.dev/wiki/notebooks)

- **Workspace Multi-Célula:** Combine células SQL e Markdown em um único documento, com resultados em linha e gráficos de barras/linhas/pizza.
- **Variáveis Entre Células:** Referencie resultados de outras células com `{{cellName.columnName}}`, além de parâmetros globais `{{$paramName}}`.
- **Executar Tudo:** Execução sequencial com opção de parar em caso de erro e resumo de conclusão.
- **Persistência e Exportação:** Salvo automaticamente como arquivos `.tabularis-notebook`; exporte como HTML, CSV ou JSON.
- Painel de estrutura, reordenação de células por arrastar e soltar, e nomes de células gerados por IA.

### Atalhos de Teclado

> [Referência completa em tabularis.dev →](https://tabularis.dev/wiki/keyboard-shortcuts)

- **Atalhos integrados** para navegação, editor e ações da grade de dados — cientes da plataforma (`Cmd` no macOS, `Ctrl` no Windows/Linux).
- **Totalmente personalizável:** Remapeie qualquer atalho não bloqueado em **Configurações → Atalhos de Teclado**; as substituições são persistidas em `keybindings.json`.
- Segure `Ctrl+Shift` na barra lateral para revelar emblemas numerados (1–9) para troca instantânea de conexão.

### Construtor Visual de Consultas

> [Referência completa em tabularis.dev →](https://tabularis.dev/wiki/visual-query-builder)

- **Arrastar e Soltar:** Construa consultas visualmente com o ReactFlow.
- **JOINs Visuais:** Conecte tabelas para criar relacionamentos.
- **Lógica Avançada:** Filtros WHERE/HAVING, agregações (COUNT, SUM, AVG), ordenação e limites.
- **SQL em Tempo Real:** Geração instantânea de código.

### EXPLAIN Visual

> [Referência completa em tabularis.dev →](https://tabularis.dev/wiki/visual-explain)

- **Gráficos de Plano Interativos:** Inspecione planos de execução como grafos de nós navegáveis em vez de texto bruto.
- **Visões em Tabela, Bruta e IA:** Alterne entre métricas exatas de nós, saída original do banco de dados e análise opcional assistida por IA.
- **Suporte Multi-Banco de Dados:** Funciona com PostgreSQL, MySQL/MariaDB e SQLite usando o melhor formato de `EXPLAIN` disponível por driver.
- **Ciclos de Otimização Mais Rápidos:** Identifique varreduras custosas, diferenças de estimativa, comportamento de join e escolhas do otimizador sem sair do editor.

### Grade de Dados

> [Referência completa em tabularis.dev →](https://tabularis.dev/wiki/data-grid)

- **Edição em Linha e em Lote:** Modifique células e envie várias alterações de uma vez; crie, exclua e selecione múltiplas linhas.
- **Exportação:** Salve resultados como CSV ou JSON, ou copie linhas selecionadas direto para a área de transferência.
- **Células JSON e JSONB:** Com destaque de sintaxe na grade, com uma janela de editor dedicada (modos Árvore / Monaco / Bruto).
- **Dados Espaciais:** Suporte inicial a GEOMETRY para MySQL.

### Sistema de Plugins

> [Referência completa em tabularis.dev →](https://tabularis.dev/wiki/plugins)

O Tabularis é **hackeável com um sistema de plugins externo**. Plugins são executáveis independentes que se comunicam com o aplicativo via **JSON-RPC 2.0 pelo stdin/stdout**, e podem ser escritos em qualquer linguagem.

- **Instalar Plugins:** Explore e instale drivers da comunidade em **Configurações → Plugins Disponíveis** — sem necessidade de reiniciar.
- **Gerenciar Drivers:** Veja todos os drivers registrados (integrados e plugins) em **Configurações → Drivers Instalados** e desinstale plugins com um clique.
- **Qualquer Banco de Dados:** Adicione suporte para DuckDB, MongoDB ou qualquer outro banco de dados escrevendo ou instalando um plugin.
- **Registro de Plugins:** Os plugins oficiais estão listados em [`plugins/registry.json`](./plugins/registry.json).
- **Guia do Desenvolvedor:** Veja [`plugins/PLUGIN_GUIDE.md`](./plugins/PLUGIN_GUIDE.md) para construir seu próprio driver em qualquer linguagem.

### Logs

- Visualizador de logs em tempo real nas Configurações, com filtragem por nível e exportação para arquivos `.log`.
- Expanda e inspecione consultas SQL nos logs automaticamente.
- **Modo Debug via CLI:** Inicie com `tabularis --debug` para logs detalhados desde a inicialização.

### Armazenamento de Configuração

> [Referência completa em tabularis.dev →](https://tabularis.dev/wiki/configuration)

A configuração é armazenada em `~/.config/tabularis/` (Linux), `~/Library/Application Support/tabularis/` (macOS) ou `%APPDATA%\tabularis\` (Windows): perfis de conexão, consultas salvas, configurações do aplicativo (`config.json`), temas personalizados e preferências de editor por conexão — abas e consultas são restauradas ao reabrir uma conexão. A wiki cobre todo o layout de arquivos e cada opção de `config.json`, incluindo substituições de modelo de IA personalizadas.

### Recursos de IA (Opcional)

> [Referência completa em tabularis.dev →](https://tabularis.dev/wiki/ai-assistant)

Text-to-SQL opcional e explicação de consultas com **OpenAI**, **Anthropic**, **MiniMax**, **OpenRouter**, **Ollama** (modelos locais, sem chave de API, total privacidade), e qualquer **API compatível com OpenAI** (Groq, Perplexity, Azure OpenAI, LocalAI, ...). As listas de modelos são obtidas do seu provedor e armazenadas em cache localmente; modelos personalizados podem ser configurados por provedor.

### Servidor MCP — Integração com Agentes de IA

> [Referência completa em tabularis.dev →](https://tabularis.dev/wiki/mcp-server)

O Tabularis inclui um **servidor MCP (Model Context Protocol)** integrado que permite que agentes de IA leiam o esquema do seu banco de dados e executem consultas diretamente pela interface de chat deles.

```bash
tabularis --mcp
```

**Configuração em um clique** para Claude Desktop, Cursor e Windsurf: abra **Configurações → Integração com Servidor MCP**, clique em **Instalar Configuração** ao lado do seu cliente e reinicie-o. A configuração manual está descrita na wiki.

#### Ferramentas disponíveis

Depois de conectado, seu agente de IA pode:

| Ferramenta | Descrição |
|------|-------------|
| `list_connections` | Lista todas as conexões de banco de dados salvas |
| `list_databases` | Lista todos os bancos de dados disponíveis para uma conexão |
| `list_tables` | Lista tabelas em uma conexão (com filtro de esquema opcional) |
| `describe_table` | Obtém o esquema completo: colunas, índices, chaves estrangeiras |
| `run_query` | Executa qualquer consulta SQL e retorna os resultados |

#### Exemplos de prompts

> "Mostre todas as tabelas no meu banco de dados de produção e descreva a tabela `orders`"

> "Escreva e execute uma consulta para encontrar os 10 principais clientes por valor total de pedidos este mês"

> "Verifique se há algum índice faltando na tabela `users`"

## Stack Tecnológica

- **Frontend:** React 19, TypeScript, Tailwind CSS v4.
- **Backend:** Rust, Tauri v2, SQLx.

## Desenvolvimento

### Configuração

```bash
pnpm install
pnpm tauri dev
```

### Build

```bash
pnpm tauri build
```

## Roadmap

- [x] [[Feat]: Allow loading of multiple Databases per connection](https://github.com/TabularisDB/tabularis/issues/47)
- [x] [JSON/JSONB Editor & Viewer](https://github.com/TabularisDB/tabularis/issues/24)
- [x] [Visual Explain Analyze](https://github.com/TabularisDB/tabularis/issues/22)
- [x] [Plugin System](https://github.com/TabularisDB/tabularis/issues/19)
- [x] [Query History](https://github.com/TabularisDB/tabularis/issues/18)
- [ ] [Plugin registry platform — OAuth publishing, release sync, download analytics](https://github.com/TabularisDB/tabularis/issues/196)
- [ ] [UI design system & visual identity — call for contributors](https://github.com/TabularisDB/tabularis/issues/195)
- [ ] [SQL Server driver — implementation roadmap & call for contributors](https://github.com/TabularisDB/tabularis/issues/150)
- [ ] [Feature: Remote Control](https://github.com/TabularisDB/tabularis/issues/46)
- [ ] [Command Palette](https://github.com/TabularisDB/tabularis/issues/25)
- [ ] [SQL Formatting / Prettier](https://github.com/TabularisDB/tabularis/issues/23)
- [ ] [Data Compare / Diff Tool](https://github.com/TabularisDB/tabularis/issues/21)
- [ ] [Team Collaboration](https://github.com/TabularisDB/tabularis/issues/20)
- [ ] [Better SQLite Support](https://github.com/TabularisDB/tabularis/issues/17)
- [ ] [Better PostgreSQL Support](https://github.com/TabularisDB/tabularis/issues/16)

## Contribuindo

Contribuições são bem-vindas — veja [CONTRIBUTING.md](./CONTRIBUTING.md). Bons pontos de partida:

- [SQL Server driver — implementation roadmap & call for contributors](https://github.com/TabularisDB/tabularis/issues/150)
- [UI design system & visual identity — call for contributors](https://github.com/TabularisDB/tabularis/issues/195)
- Escreva um plugin de driver em qualquer linguagem — veja o [Guia de Plugins](./plugins/PLUGIN_GUIDE.md)

<!-- SPONSORS:START -->

## Patrocinadores

- <a href="https://www.serversmtp.com/?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor" target="_blank"><img src="https://tabularis.dev/img/sponsors/turbosmtp_compact.png" height="28" alt="turboSMTP" /></a> **[turboSMTP](https://www.serversmtp.com/?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor)** — Relay SMTP profissional — seus e-mails entregues direto na caixa de entrada, nunca no spam
- <a href="https://www.kilo.ai/?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor" target="_blank"><img src="https://tabularis.dev/img/sponsors/kilocode_compact.png" height="28" alt="Kilo Code" /></a> **[Kilo Code](https://www.kilo.ai/?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor)** — Agente de codificação com IA de código aberto — construa, publique e itere mais rápido com mais de 500 modelos
- <a href="https://m.do.co/c/f6ab3d158275?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor" target="_blank"><img src="https://tabularis.dev/img/sponsors/digitalocean_compact.png" height="28" alt="DigitalOcean" /></a> **[DigitalOcean](https://m.do.co/c/f6ab3d158275?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor)** — Infraestrutura em nuvem simples e previsível para desenvolvedores e equipes em crescimento.
- <a href="https://vercel.com/?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor" target="_blank"><img src="https://tabularis.dev/img/sponsors/vercel_compact.svg" height="28" alt="Vercel" /></a> **[Vercel](https://vercel.com/?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor)** — A plataforma para a web moderna — publique, visualize e escale aplicações frontend sem configuração.
- <a href="https://usero.io/?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor" target="_blank"><img src="https://tabularis.dev/img/sponsors/usero_compact.png" height="28" alt="Usero" /></a> **[Usero](https://usero.io/?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor)** — Feedback vira código. Automaticamente.
- <a href="https://devglobe.app/?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor" target="_blank"><img src="https://tabularis.dev/img/sponsors/devglobe_compact.png" height="28" alt="DevGlobe" /></a> **[DevGlobe](https://devglobe.app/?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor)** — Conecte seu IDE, apareça no globo e mostre seus projetos para uma comunidade de desenvolvedores.
- <a href="https://tolgee.io/?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor" target="_blank"><img src="https://tabularis.dev/img/sponsors/tolgee_compact.svg" height="28" alt="Tolgee" /></a> **[Tolgee](https://tolgee.io/?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor)** — Plataforma de localização de código aberto — traduza seu aplicativo em contexto, sem o caos de planilhas.
- <a href="https://1password.com/developers?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor" target="_blank"><img src="https://tabularis.dev/img/sponsors/1password_compact.png" height="28" alt="1Password" /></a> **[1Password](https://1password.com/developers?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor)** — O gerenciador de senhas e segredos em que os desenvolvedores confiam — gratuito para projetos de código aberto.
- <a href="https://www.jetbrains.com/?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor" target="_blank"><img src="https://tabularis.dev/img/sponsors/jetbrains_compact.png" height="28" alt="JetBrains" /></a> **[JetBrains](https://www.jetbrains.com/?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor)** — Ferramentas profissionais para desenvolvedores — IntelliJ IDEA, WebStorm, DataGrip e o restante do All Products Pack.
- <a href="https://signpath.io/?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor" target="_blank"><img src="https://tabularis.dev/img/sponsors/signpath_compact.png" height="28" alt="SignPath" /></a> **[SignPath](https://signpath.io/?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor)** — Assinatura de código para projetos de código aberto — releases assinados para Windows sem a conta do certificado.

_[Torne-se um patrocinador →](https://tabularis.dev/sponsors)_

<!-- SPONSORS:END -->

## História de Origem

O Tabularis começou como um experimento: até onde o desenvolvimento assistido por IA poderia chegar na construção de uma ferramenta funcional do zero? Mais longe do que o esperado — hoje é um projeto ativamente mantido, com lançamentos regulares e um ecossistema de plugins.

## Licença

Apache License 2.0

---

<p align="center">
  Gosta do tabularis? <a href="https://github.com/TabularisDB/tabularis">Dê uma estrela no repositório</a> ⭐ — isso ajuda muito o projeto.
</p>

<p align="center">
  <a href="https://repostars.dev/?repos=TabularisDB%2Ftabularis&theme=dark">
    <img src="https://repostars.dev/api/embed?repo=TabularisDB%2Ftabularis&theme=dark" alt="RepoStars" />
  </a>
</p>
