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

モダンなデータベース向けのオープンソースデスクトップクライアントです。PostgreSQL、MySQL/MariaDB、SQLite に対応し、SQL ノートブック、AI 機能、MCP 連携、外部プラグインシステムを備えています。

**Discord** - [サーバーに参加](https://discord.com/invite/K2hmhfHRSt) して、メンテナーと交流したり、フィードバックを共有したり、コミュニティからサポートを得たりできます。

> これは翻訳版のドキュメントです。最新かつ正式な内容は [英語版 README](./README.md) を参照してください。

## ダウンロード

[![Windows](https://img.shields.io/badge/Windows-Download-blue?logo=windows)](https://github.com/TabularisDB/tabularis/releases/download/v0.11.0/tabularis_0.11.0_x64-setup.exe)
[![macOS](https://img.shields.io/badge/macOS-Download-black?logo=apple)](https://github.com/TabularisDB/tabularis/releases/download/v0.11.0/tabularis_0.11.0_x64.dmg)
[![Linux AppImage](https://img.shields.io/badge/Linux-AppImage-green?logo=linux)](https://github.com/TabularisDB/tabularis/releases/download/v0.11.0/tabularis_0.11.0_amd64.AppImage)
[![Linux .deb](https://img.shields.io/badge/Linux-.deb-orange?logo=debian)](https://github.com/TabularisDB/tabularis/releases/download/v0.11.0/tabularis_0.11.0_amd64.deb)
[![Linux .rpm](https://img.shields.io/badge/Linux-.rpm-red?logo=redhat)](https://github.com/TabularisDB/tabularis/releases/download/v0.11.0/tabularis-0.9.7-1.x86_64.rpm)

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

## ライセンス

Apache License 2.0
