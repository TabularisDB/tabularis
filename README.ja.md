<br />
<p align="center">
  <img src=".github/assets/banner-light.ja.png#gh-light-mode-only" alt="Tabularis" width="100%">
  <img src=".github/assets/banner-dark.ja.png#gh-dark-mode-only" alt="Tabularis" width="100%">
</p>

# Tabularis

Tabularis は、3 つの標準搭載データベースドライバーと、DuckDB、ClickHouse、Redis、Firestore を含む 21 の公開済みプラグインを備えた、オープンソースのデスクトップ SQL ワークスペースです。組み込みの MCP サーバーにより、Claude、Cursor、Devin（旧 Windsurf）が、あなたが普段使っているアプリの中でスキーマを読み取り、クエリを実行できます。

<p align="center">
  <b><a href="https://tabularis.dev">ウェブサイト</a></b> ·
  <b><a href="https://tabularis.dev/wiki">ドキュメント</a></b> ·
  <b><a href="https://tabularis.dev/download">ダウンロード</a></b> ·
  <b><a href="./CHANGELOG.md">変更履歴</a></b>
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
> これは翻訳版のドキュメントです。最新かつ正式な内容は [英語版 README](./README.md) を参照してください。

<br />

<div align="center">
  <img src="https://raw.githubusercontent.com/TabularisDB/website/main/public/img/overview.gif" alt="クエリエディターとデータグリッドを表示したデスクトップ SQL ワークスペース Tabularis" />
</div>

## ダウンロード

```bash
winget install Debba.Tabularis    # Windows
brew install --cask tabularis     # macOS
sudo snap install tabularis       # Linux
```

または、インストーラーを直接ダウンロードしてください。

- **Windows:** &nbsp;[![Windows](https://img.shields.io/badge/Windows-Download-blue?logo=windows)](https://github.com/TabularisDB/tabularis/releases/download/v0.26.0/tabularis_0.26.0_x64-setup.exe)

- **macOS:** &nbsp;[![macOS (Apple Silicon)](https://img.shields.io/badge/macOS-Apple%20Silicon-black?logo=apple)](https://github.com/TabularisDB/tabularis/releases/download/v0.26.0/tabularis_0.26.0_aarch64.dmg)&nbsp;[![macOS (Intel)](https://img.shields.io/badge/macOS-Intel-black?logo=apple)](https://github.com/TabularisDB/tabularis/releases/download/v0.26.0/tabularis_0.26.0_x64.dmg)

- **Linux:** &nbsp;[![Linux AppImage](https://img.shields.io/badge/Linux-AppImage-green?logo=linux)](https://github.com/TabularisDB/tabularis/releases/download/v0.26.0/tabularis_0.26.0_amd64.AppImage)&nbsp;[![Linux .deb](https://img.shields.io/badge/Linux-.deb-orange?logo=debian)](https://github.com/TabularisDB/tabularis/releases/download/v0.26.0/tabularis_0.26.0_amd64.deb)&nbsp;[![Linux .rpm](https://img.shields.io/badge/Linux-.rpm-red?logo=redhat)](https://github.com/TabularisDB/tabularis/releases/download/v0.26.0/tabularis-0.26.0-1.x86_64.rpm)

アプリの UI は英語、イタリア語、スペイン語、中国語（簡体字）、フランス語、ドイツ語、日本語、ロシア語、韓国語、タガログ語、ポルトガル語（ブラジル）に対応しています。

> [!TIP]
> **Discord:** [サーバーに参加](https://discord.com/invite/K2hmhfHRSt)して、メンテナーと交流したり、フィードバックを共有したり、サポートを得たりできます。

## なぜ tabularis なのか？

|                                                               |         **tabularis**          |            DBeaver CE            |       TablePlus       |       Beekeeper Studio        |
| ------------------------------------------------------------- | :----------------------------: | :------------------------------: | :-------------------: | :---------------------------: |
| ライセンス                                                    |        Apache 2.0、無料        |  Apache 2.0、無料（Pro は有料）  |         商用          | GPLv3（有料エディションあり） |
| SQL ノートブック（SQL + Markdown セル、セル間変数、チャート） |               ✅               |                ❌                |          ❌           |              ❌               |
| AI エージェント向けの組み込み MCP サーバー                    |               ✅               |                ❌                |          ❌           |              ❌               |
| **任意の言語**でプラグイン開発（stdio 経由の JSON-RPC）       |               ✅               |     Java/Eclipse プラグイン      | JavaScript プラグイン |              ❌               |
| **ローカルモデル**（Ollama）対応の AI テキストから SQL 変換   |               ✅               | クラウドベースの AI アシスタント |          ❌           |              ❌               |
| インタラクティブなプラングラフ付き Visual EXPLAIN             |               ✅               |                ✅                |          ❌           |              ❌               |
| 標準対応データベース数                                        | 標準搭載 3 + 公式プラグイン 21 |               100+               |          20+          |             約 10             |

> [!NOTE]
> 比較は 2026 年 6 月時点のものです。他ツールの機能はその後変わっている可能性があります。数十のドライバーが必要な場合は DBeaver を使ってください。tabularis は、少数のデータベースをしっかりサポートすることに注力しています。

### 対応データベース

PostgreSQL、MySQL/MariaDB、SQLite は標準搭載されています。標準搭載の PostgreSQL ドライバーは非推奨となり、Tabularis が自動でインストールする [PostgreSQL プラグイン](https://github.com/TabularisDB/tabularis-postgresql-plugin)に置き換えられます。それ以外はすべてプラグインです。以下は、ウェブサイトの[ドライバー＆プラグイン対応状況](https://tabularis.dev/#driver-coverage)に合わせた現在の状況です。

**提供中**

| データベース             | プラグイン                                                                                      | データベース   | プラグイン                                                                                      |
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

**バウンティボード掲載中**

| ステータス   | データベース                                                                 |
| ------------ | ---------------------------------------------------------------------------- |
| 担当者決定   | Google BigQuery, Meilisearch                                                 |
| 計画策定済み | Amazon Redshift, CockroachDB, TiDB                                           |
| 近日対応     | Snowflake                                                                    |
| 募集中       | Cassandra, Etcd, Firebird, ScyllaDB, SQL Anywhere, SurrealDB, Trino / Presto |

> [!NOTE]
> **提供中**のドライバーは[プラグインレジストリ](https://tabularis.dev/plugins)からインストールできます。それ以外は[バウンティボード](https://tabularis.dev/plugins/bounties)に掲載されています。担当として名乗り出るか、スポンサーになるか、[データベースをリクエスト](https://github.com/TabularisDB/tabularis/discussions)してください。

## インストール

### Windows

```bash
winget install Debba.Tabularis
```

または [Releases ページ](https://github.com/TabularisDB/tabularis/releases) からインストーラーをダウンロードしてください。

### macOS

```bash
brew install --cask tabularis
```

**v0.13.1** 以降のビルドは Apple による署名と公証（notarization）が行われているため、追加の手順なしでそのまま開けます。

<details>
<summary>v0.13.1 より前のリリースに関する注意事項</summary>

<br />

以下の手順は、v0.13.1 より前の古いリリースを直接ダウンロードした場合にのみ必要です。

- tabularis アプリにアクセシビリティアクセス（プライバシーとセキュリティ）を許可する必要があります。アップグレードする際に、すでに tabularis が許可リストに登録されている場合は、新しいバージョンにアクセシビリティアクセスを許可する前に手動で削除してください。
- アプリを Applications ディレクトリにコピーした後、次のコマンドの実行が必要になる場合があります:

```bash
xattr -c /Applications/tabularis.app
```

</details>

### Linux

**Snap**

```bash
sudo snap install tabularis
sudo snap connect tabularis:password-manager-service   # 保存した認証情報のためのキーチェーンアクセス
```

> [!IMPORTANT]
> `password-manager-service` インターフェースは、Snap Store によってまだ自動接続されません。接続しないと、接続情報の保存が `Platform secure storage failure` エラーで失敗します。

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

## アップデート

- 起動時に自動でアップデートを確認します。
- GitHub Releases から手動でアップデートすることもできます。

## ギャラリー

完全なギャラリーは [tabularis.dev](https://tabularis.dev) で確認できます。

## 機能

### 接続管理

<sub>[tabularis.dev の完全なリファレンス →](https://tabularis.dev/wiki/connections)</sub>

- PostgreSQL、MySQL/MariaDB、SQLite に対応。
- 接続プロファイルをローカルに保存。
- SSH トンネルとシステムキーチェーンによるパスワード保存。
- グリッド／リスト表示とリアルタイム検索を備えた接続ページ。
- 接続ごとの外観カスタマイズ：アイコン（Lucide／絵文字／画像）とアクセントカラーを個別に設定可能。

### データベースエクスプローラー

<sub>[tabularis.dev の完全なリファレンス →](https://tabularis.dev/wiki/schema-management)</sub>

- テーブル、カラム、キー、インデックス、ビュー、ルーチンの参照。
- スキーマ要素のインライン編集。
- インタラクティブな ER 図。
- コンテキストメニューによるクイックアクション。

### SQL エディター

<sub>[tabularis.dev の完全なリファレンス →](https://tabularis.dev/wiki/editor)</sub>

- シンタックスハイライトと自動補完を備えた Monaco Editor。
- 接続ごとに分離された複数タブ。
- 結果を分離して表示するマルチクエリ実行。
- 保存済みクエリとエディター内 AI オーバーレイ。

### SQL ノートブック

<sub>[tabularis.dev の完全なリファレンス →](https://tabularis.dev/wiki/notebooks)</sub>

- 同一ドキュメント内で SQL と Markdown のセルを併用。
- インライン結果とチャート表示。
- セル間変数とグローバルパラメーター。
- 全セルの順次実行。

### ビジュアルクエリビルダー

<sub>[tabularis.dev の完全なリファレンス →](https://tabularis.dev/wiki/visual-query-builder)</sub>

- ドラッグ＆ドロップでクエリを構築。
- ビジュアル JOIN、フィルター、集計、ソート、リミット。
- SQL をリアルタイムに生成。

### Visual EXPLAIN

<sub>[tabularis.dev の完全なリファレンス →](https://tabularis.dev/wiki/visual-explain)</sub>

- 実行計画をナビゲート可能なグラフとして表示。
- テーブル表示、生データ表示、任意の AI 分析。
- PostgreSQL、MySQL/MariaDB、SQLite に対応。

### データグリッド

<sub>[tabularis.dev の完全なリファレンス →](https://tabularis.dev/wiki/data-grid)</sub>

- インラインおよびバッチ編集。
- 行の作成、選択、削除。
- CSV または JSON でのエクスポート。
- 空間データ（ジオメトリ）の初期サポート。
- JSON/JSONB セルのハイライトと専用エディターウィンドウ（Tree / Monaco / Raw）。接続ごとにテキストカラムでの JSON 検出を有効化可能。

### ロギング

- 設定画面でリアルタイムにログを表示。
- レベルによるフィルタリング。
- `.log` ファイルへのエクスポート。
- CLI デバッグモード: `tabularis --debug`。

### プラグイン

<sub>[tabularis.dev の完全なリファレンス →](https://tabularis.dev/wiki/plugins)</sub>

- stdin/stdout 経由の JSON-RPC 2.0 による外部プラグインシステム。
- コミュニティドライバーを再起動なしでインストール可能。
- 公式レジストリ: [`plugins/registry.json`](./plugins/registry.json)。
- 開発者ガイド: [`plugins/PLUGIN_GUIDE.md`](./plugins/PLUGIN_GUIDE.md)。

## 設定

<sub>[tabularis.dev の完全なリファレンス →](https://tabularis.dev/wiki/configuration)</sub>

設定は以下の場所に保存されます。

- Linux: `~/.config/tabularis/`
- macOS: `~/Library/Application Support/tabularis/`
- Windows: `%APPDATA%\tabularis\`

主なファイル:

- `connections.json`
- `saved_queries.json`
- `config.json`
- `themes/`
- `preferences/`
- `connection-icons/`（接続アイコン用のカスタム画像）

`config.json` の `language` フィールドは `auto`、`en`、`it`、`es`、`zh`、`fr`、`de`、`ja`、`ru`、`ko`、`tl`、`pt-BR` をサポートします。

## AI

<sub>[tabularis.dev の完全なリファレンス →](https://tabularis.dev/wiki/ai-assistant)</sub>

オプションのテキストから SQL への変換とクエリ説明機能は、以下のプロバイダーに対応しています。

- OpenAI
- Anthropic
- MiniMax
- OpenRouter
- Ollama
- OpenAI 互換 API

モデルは動的に取得され、ローカルにキャッシュされます。

## MCP

<sub>[tabularis.dev の完全なリファレンス →](https://tabularis.dev/wiki/mcp-server)</sub>

組み込みの MCP サーバーを起動します。

```bash
tabularis --mcp
```

対応クライアント:

- Claude Desktop
- Cursor
- Windsurf

利用可能なツール:

| ツール             | 説明                                                 |
| ------------------ | ---------------------------------------------------- |
| `list_connections` | 保存済みのすべての接続を一覧表示                     |
| `list_databases`   | 接続内のすべてのデータベースを一覧表示               |
| `list_tables`      | 接続内のテーブルを一覧表示（スキーマで絞り込み可能） |
| `describe_table`   | 完全なスキーマを取得: カラム、インデックス、外部キー |
| `run_query`        | 任意の SQL クエリを実行して結果を返す                |

## 技術スタック

| レイヤー       | スタック                              |
| -------------- | ------------------------------------- |
| フロントエンド | React 19, TypeScript, Tailwind CSS v4 |
| バックエンド   | Rust, Tauri v2, SQLx                  |

## 開発

**セットアップ**

```bash
pnpm install
pnpm tauri dev
```

**ビルド**

```bash
pnpm tauri build
```

## ロードマップ

ロードマップは GitHub の Issue から自動生成されます。最新の状況は[英語版 README](./README.md#roadmap) を参照してください。

## コントリビューション

コントリビューションを歓迎します。詳しくは [CONTRIBUTING.md](./CONTRIBUTING.md) をご覧ください。始めやすいテーマは次のとおりです。

- [SQL Server ドライバープラグイン: ドライバーをテストし、未解決の Issue に取り組む](https://github.com/TabularisDB/tabularis-sqlserver-plugin)
- [UI デザインシステムとビジュアルアイデンティティ: コントリビューター募集](https://github.com/TabularisDB/tabularis/issues/195)
- [プラグインガイド](./plugins/PLUGIN_GUIDE.md)を参考に、好きな言語でドライバープラグインを書く

## スポンサーとサポーター

Tabularis は素晴らしいスポンサーとサポーターに支えられています。全リストは[英語版 README](./README.md#sponsors-and-supporters) と [tabularis.dev/sponsors](https://tabularis.dev/sponsors) で確認できます。

## プロジェクトの成り立ち

Tabularis は、AI 支援開発でゼロから動くツールをどこまで作れるかという実験として始まりました。結果は予想以上で、現在では定期的なリリースとプラグインエコシステムを持つ、活発にメンテナンスされているプロジェクトになっています。

## ライセンス

[Apache License 2.0](./LICENSE)

---

<p align="center">
  tabularis を気に入ったら、<a href="https://github.com/TabularisDB/tabularis">リポジトリにスター</a>を付けてください ⭐。プロジェクトの大きな助けになります。
</p>

<p align="center">
  <a href="https://repostars.dev/?repos=TabularisDB%2Ftabularis&theme=dark">
    <img src="https://repostars.dev/api/embed?repo=TabularisDB%2Ftabularis&theme=dark" alt="RepoStars" />
  </a>
</p>
