<div align="center">
  <img src="public/logo-sm.png" width="120" height="120" />
</div>

# tabularis

<p align="center">
  <strong>PostgreSQL、MySQL/MariaDB、SQLite に対応したオープンソースのデータベースクライアント。<br />
  SQL ノートブック、Visual EXPLAIN、AI、MCP を標準搭載。それ以外はプラグインで追加できます。</strong>
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

**Discord** - [サーバーに参加](https://discord.com/invite/K2hmhfHRSt) して、メンテナーと交流したり、フィードバックを共有したり、コミュニティからサポートを得たりできます。

> これは翻訳版のドキュメントです。最新かつ正式な内容は [英語版 README](./README.md) を参照してください。

## ダウンロード

```bash
winget install Debba.Tabularis                                   # Windows
brew tap TabularisDB/tabularis && brew install --cask tabularis  # macOS
sudo snap install tabularis                                      # Linux
```

または、インストーラーを直接ダウンロードしてください。

[![Windows](https://img.shields.io/badge/Windows-Download-blue?logo=windows)](https://github.com/TabularisDB/tabularis/releases/download/v0.13.1/tabularis_0.13.1_x64-setup.exe) [![macOS (Apple Silicon)](https://img.shields.io/badge/macOS-Apple%20Silicon-black?logo=apple)](https://github.com/TabularisDB/tabularis/releases/download/v0.13.1/tabularis_0.13.1_aarch64.dmg) [![macOS (Intel)](https://img.shields.io/badge/macOS-Intel-black?logo=apple)](https://github.com/TabularisDB/tabularis/releases/download/v0.13.1/tabularis_0.13.1_x64.dmg) [![Linux AppImage](https://img.shields.io/badge/Linux-AppImage-green?logo=linux)](https://github.com/TabularisDB/tabularis/releases/download/v0.13.1/tabularis_0.13.1_amd64.AppImage) [![Linux .deb](https://img.shields.io/badge/Linux-.deb-orange?logo=debian)](https://github.com/TabularisDB/tabularis/releases/download/v0.13.1/tabularis_0.13.1_amd64.deb) [![Linux .rpm](https://img.shields.io/badge/Linux-.rpm-red?logo=redhat)](https://github.com/TabularisDB/tabularis/releases/download/v0.13.1/tabularis-0.13.1-1.x86_64.rpm)

アプリの UI は英語、イタリア語、スペイン語、中国語（簡体字）、フランス語、ドイツ語、日本語、ロシア語に対応しています。

## なぜ tabularis なのか？

|  | **tabularis** | DBeaver CE | TablePlus | Beekeeper Studio |
|---|---|---|---|---|
| ライセンス | Apache 2.0、無料 | Apache 2.0、無料（Pro は有料） | 商用 | GPLv3（有料エディションあり） |
| SQL ノートブック（SQL + Markdown セル、セル間変数、チャート） | ✅ | ❌ | ❌ | ❌ |
| AI エージェント向けの組み込み MCP サーバー | ✅ | ❌ | ❌ | ❌ |
| **任意の言語**でプラグイン開発（stdio 経由の JSON-RPC） | ✅ | Java/Eclipse プラグイン | JavaScript プラグイン | ❌ |
| **ローカルモデル**（Ollama）対応の AI テキストから SQL 変換 | ✅ | クラウドベースの AI アシスタント | ❌ | ❌ |
| インタラクティブなプラングラフ付き Visual EXPLAIN | ✅ | ✅ | ❌ | ❌ |
| 標準対応データベース数 | 3（+ プラグインで任意に追加） | 100+ | 20+ | 約 10 |

> 比較は 2026 年 6 月時点のものです。他ツールの機能はその後変わっている可能性があります。数十のドライバーが必要な場合は DBeaver を使ってください。tabularis は、少数のデータベースをしっかりサポートすることに注力しています。

## インストール

### Windows

```bash
winget install Debba.Tabularis
```

または [Releases ページ](https://github.com/TabularisDB/tabularis/releases) からインストーラーをダウンロードしてください。

### macOS

```bash
brew tap TabularisDB/tabularis
brew install --cask tabularis
```

Release から直接インストールした場合は、次のコマンドが必要になることがあります。

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

## アップデート

- 起動時に自動でアップデートを確認します。
- GitHub Releases から手動でアップデートすることもできます。

## ギャラリー

完全なギャラリーは [tabularis.dev](https://tabularis.dev) で確認できます。

## 機能

### 接続管理

- PostgreSQL、MySQL/MariaDB、SQLite に対応。
- 接続プロファイルをローカルに保存。
- SSH トンネルとシステムキーチェーンによるパスワード保存。
- グリッド／リスト表示とリアルタイム検索を備えた接続ページ。
- 接続ごとの外観カスタマイズ：アイコン（Lucide／絵文字／画像）とアクセントカラーを個別に設定可能。

### データベースエクスプローラー

- テーブル、カラム、キー、インデックス、ビュー、ルーチンの参照。
- スキーマ要素のインライン編集。
- インタラクティブな ER 図。
- コンテキストメニューによるクイックアクション。

### SQL エディター

- シンタックスハイライトと自動補完を備えた Monaco Editor。
- 接続ごとに分離された複数タブ。
- 結果を分離して表示するマルチクエリ実行。
- 保存済みクエリとエディター内 AI オーバーレイ。

### SQL ノートブック

- 同一ドキュメント内で SQL と Markdown のセルを併用。
- インライン結果とチャート表示。
- セル間変数とグローバルパラメーター。
- 全セルの順次実行。

### ビジュアルクエリビルダー

- ドラッグ＆ドロップでクエリを構築。
- ビジュアル JOIN、フィルター、集計、ソート、リミット。
- SQL をリアルタイムに生成。

### Visual EXPLAIN

- 実行計画をナビゲート可能なグラフとして表示。
- テーブル表示、生データ表示、任意の AI 分析。
- PostgreSQL、MySQL/MariaDB、SQLite に対応。

### データグリッド

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

- stdin/stdout 経由の JSON-RPC 2.0 による外部プラグインシステム。
- コミュニティドライバーを再起動なしでインストール可能。
- 公式レジストリ: [`plugins/registry.json`](./plugins/registry.json)。
- 開発者ガイド: [`plugins/PLUGIN_GUIDE.md`](./plugins/PLUGIN_GUIDE.md)。

## 設定

設定は以下の場所に保存されます。

- Linux: `~/.config/tabularis/`
- macOS: `~/Library/Application Support/tabularis/`
- Windows: `%APPDATA%\\tabularis\\`

主なファイル:

- `connections.json`
- `saved_queries.json`
- `config.json`
- `themes/`
- `preferences/`
- `connection-icons/`（接続アイコン用のカスタム画像）

`config.json` の `language` フィールドは `auto`、`en`、`it`、`es`、`zh`、`fr`、`de` をサポートします。

## AI

オプションのテキストから SQL への変換とクエリ説明機能は、以下のプロバイダーに対応しています。

- OpenAI
- Anthropic
- MiniMax
- OpenRouter
- Ollama
- OpenAI 互換 API

モデルは動的に取得され、ローカルにキャッシュされます。

## MCP

組み込みの MCP サーバーを起動します。

```bash
tabularis --mcp
```

対応クライアント:

- Claude Desktop
- Cursor
- Windsurf

利用可能なツール:

- `list_connections`
- `list_tables`
- `describe_table`
- `run_query`

## 技術スタック

- フロントエンド: React 19、TypeScript、Tailwind CSS v4
- バックエンド: Rust、Tauri v2、SQLx

## 開発

セットアップ:

```bash
pnpm install
pnpm tauri dev
```

ビルド:

```bash
pnpm tauri build
```

## ロードマップ

- リモートコントロール
- コマンドパレット
- JSON/JSONB エディター＆ビューアー
- SQL フォーマット / Prettier
- データ比較 / 差分ツール
- チームコラボレーション

## コントリビューション

コントリビューションを歓迎します。詳しくは [CONTRIBUTING.md](./CONTRIBUTING.md) をご覧ください。始めやすいテーマは次のとおりです。

- [SQL Server ドライバー — 実装ロードマップとコントリビューター募集](https://github.com/TabularisDB/tabularis/issues/150)
- [UI デザインシステムとビジュアルアイデンティティ — コントリビューター募集](https://github.com/TabularisDB/tabularis/issues/195)
- 好きな言語でドライバープラグインを書く — [プラグインガイド](./plugins/PLUGIN_GUIDE.md) を参照

## プロジェクトの成り立ち

Tabularis は、AI 支援開発でゼロから動くツールをどこまで作れるかという実験として始まりました。結果は予想以上で、現在では定期的なリリースとプラグインエコシステムを持つ、活発にメンテナンスされているプロジェクトになっています。

## ライセンス

Apache License 2.0

---

<p align="center">
  tabularis を気に入ったら、<a href="https://github.com/TabularisDB/tabularis">リポジトリにスター</a>を付けてください ⭐。プロジェクトの大きな助けになります。
</p>

<p align="center">
  <a href="https://repostars.dev/?repos=TabularisDB%2Ftabularis&theme=dark">
    <img src="https://repostars.dev/api/embed?repo=TabularisDB%2Ftabularis&theme=dark" alt="RepoStars" />
  </a>
</p>
