<div align="center">
  <img src="public/logo-sm.png" width="120" height="120" />
</div>

# tabularis

<p align="center">
  <strong>Tabularis는 PostgreSQL, MySQL/MariaDB, SQLite 및 DuckDB, ClickHouse, Redis, Firestore 등 13종 이상의 데이터베이스를 지원하는 오픈소스 데스크톱 SQL 워크스페이스입니다.<br />
  내장 MCP 서버를 통해 Claude, Cursor, Devin(구 Windsurf)이 여러분이 이미 사용하는 앱에서 스키마를 읽고 쿼리를 실행할 수 있습니다.</strong>
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
  <a href="./README.ko.md">한국어</a>
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

**Discord** — [Discord 서버에 참여하세요](https://discord.com/invite/K2hmhfHRSt). 메인테이너와 이야기하고, 피드백을 공유하고, 커뮤니티의 도움을 받을 수 있습니다.

> 이 문서는 번역된 버전입니다. 가장 최신이자 공식적인 원본은 [영문 README](./README.md)입니다.

## 다운로드

```bash
winget install Debba.Tabularis                                   # Windows
brew tap TabularisDB/tabularis && brew install --cask tabularis  # macOS
sudo snap install tabularis                                      # Linux
```

또는 설치 프로그램을 직접 받으세요:

[![Windows](https://img.shields.io/badge/Windows-Download-blue?logo=windows)](https://github.com/TabularisDB/tabularis/releases/download/v0.14.0/tabularis_0.14.0_x64-setup.exe) [![macOS (Apple Silicon)](https://img.shields.io/badge/macOS-Apple%20Silicon-black?logo=apple)](https://github.com/TabularisDB/tabularis/releases/download/v0.14.0/tabularis_0.14.0_aarch64.dmg) [![macOS (Intel)](https://img.shields.io/badge/macOS-Intel-black?logo=apple)](https://github.com/TabularisDB/tabularis/releases/download/v0.14.0/tabularis_0.14.0_x64.dmg) [![Linux AppImage](https://img.shields.io/badge/Linux-AppImage-green?logo=linux)](https://github.com/TabularisDB/tabularis/releases/download/v0.14.0/tabularis_0.14.0_amd64.AppImage) [![Linux .deb](https://img.shields.io/badge/Linux-.deb-orange?logo=debian)](https://github.com/TabularisDB/tabularis/releases/download/v0.14.0/tabularis_0.14.0_amd64.deb) [![Linux .rpm](https://img.shields.io/badge/Linux-.rpm-red?logo=redhat)](https://github.com/TabularisDB/tabularis/releases/download/v0.14.0/tabularis-0.13.1-1.x86_64.rpm)

앱 UI는 영어, 이탈리아어, 스페인어, 중국어(간체), 프랑스어, 독일어, 일본어, 러시아어, 타갈로그어, 한국어로 제공됩니다.

## 왜 tabularis인가?

|  | **tabularis** | DBeaver CE | TablePlus | Beekeeper Studio |
|---|---|---|---|---|
| 라이선스 | Apache 2.0, 무료 | Apache 2.0, 무료 (Pro는 유료) | 상용 | GPLv3 (유료 에디션) |
| SQL 노트북 (SQL + Markdown 셀, 셀 간 변수, 차트) | ✅ | ❌ | ❌ | ❌ |
| AI 에이전트용 내장 MCP 서버 | ✅ | ❌ | ❌ | ❌ |
| **모든 언어**로 작성 가능한 플러그인 (stdio 기반 JSON-RPC) | ✅ | Java/Eclipse 플러그인 | JavaScript 플러그인 | ❌ |
| **로컬 모델**(Ollama)을 사용하는 AI text-to-SQL | ✅ | 클라우드 기반 AI 어시스턴트 | ❌ | ❌ |
| 인터랙티브 플랜 그래프가 있는 Visual EXPLAIN | ✅ | ✅ | ❌ | ❌ |
| 기본 제공 데이터베이스 | 내장 3종 + 공식 플러그인 13종 | 100종 이상 | 20종 이상 | 약 10종 |

> 2026년 6월 기준 비교이며, 다른 도구의 기능은 이후 변경되었을 수 있습니다. 수십 종의 드라이버가 필요하다면 DBeaver를 사용하세요 — tabularis는 소수의 데이터베이스를 제대로 지원하는 데 집중합니다.

### 데이터베이스 지원

PostgreSQL, MySQL/MariaDB, SQLite는 기본 내장되어 있습니다. 그 외 모든 것은 플러그인이며, 웹사이트의 [드라이버 및 플러그인 커버리지](https://tabularis.dev/#driver-coverage)를 반영해 각 통합의 현재 상태를 아래에 정리했습니다.

ClickHouse (출시됨), Cloudflare D1 (출시됨), DM / Dameng (출시됨), DuckDB (출시됨), Firestore (출시됨), IBM Db2 (출시됨), IBM Informix (출시됨), Redis (출시됨), CSV Folder (출시됨), Google Sheets (출시됨), HackerNews (출시됨), Google BigQuery (예정), LibSQL / Turso (예정), Meilisearch (예정), MongoDB (예정), Oracle (예정), SQL Server (예정), Amazon Redshift (계획됨), CockroachDB (계획됨), TiDB (계획됨), DynamoDB (곧 출시), Snowflake (곧 출시), Cassandra (오픈), Elasticsearch (오픈), Etcd (오픈), Firebird (오픈), ScyllaDB (오픈), SQL Anywhere (오픈), SurrealDB (오픈), Trino / Presto (오픈).

> **출시됨** 상태의 드라이버는 [플러그인 레지스트리](https://tabularis.dev/plugins)에서 설치할 수 있습니다. 그 외 모든 것은 [바운티 보드](https://tabularis.dev/plugins/bounties)에 있습니다 — 직접 맡거나, 후원하거나, [데이터베이스를 요청](https://github.com/TabularisDB/tabularis/discussions)하세요.

## 설치

### Windows

```bash
winget install Debba.Tabularis
```

또는 [Releases](https://github.com/TabularisDB/tabularis/releases)에서 설치 프로그램을 다운로드하세요.

### macOS

```bash
brew tap TabularisDB/tabularis
brew install --cask tabularis
```

**v0.13.1**부터의 빌드는 Apple에서 서명 및 공증되어 별도 절차 없이 실행됩니다.

아래 참고 사항은 직접 다운로드한 **구버전(v0.13.1 이전)**에만 해당합니다:

- tabularis 앱에 접근성 권한(개인정보 보호 및 보안)을 허용해야 할 수 있습니다. 업데이트 시 이미 허용 목록에 tabularis가 있다면, 새 버전에 접근성 권한을 부여하기 전에 수동으로 제거하세요.
- 다음 명령을 실행해야 할 수 있습니다:

```bash
xattr -c /Applications/tabularis.app
```

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

## 업데이트

- 앱이 시작 시 자동으로 업데이트를 확인합니다.
- [GitHub Releases](https://github.com/TabularisDB/tabularis/releases)에서 수동으로 업데이트할 수도 있습니다.

## 스크린샷 및 데모

기능별 스크린샷과 데모는 [tabularis.dev](https://tabularis.dev)의 Features 섹션에서 확인할 수 있습니다.

## 기능

### 연결 관리

- PostgreSQL, MySQL/MariaDB, SQLite 지원.
- 연결 프로필을 로컬에 저장.
- SSH 터널링 및 시스템 키체인에 비밀번호 저장.
- 그리드/리스트 뷰와 실시간 검색을 갖춘 연결 페이지.

### 데이터베이스 탐색기

- 테이블, 컬럼, 키, 인덱스, 뷰, 프로시저 탐색.
- 스키마 요소를 내장 편집 기능으로 수정.
- 인터랙티브 ER 다이어그램.
- 컨텍스트 메뉴를 통한 빠른 작업.

### SQL 편집기

- 구문 강조와 자동 완성을 제공하는 Monaco 편집기.
- 연결별로 격리된 탭.
- 개별 결과 표시를 지원하는 다중 문 실행.
- 저장된 쿼리 및 편집기 내장 AI 오버레이.

### SQL 노트북

- 하나의 문서에 SQL과 Markdown 셀.
- 인라인 결과 및 차트.
- 셀 간 변수 및 전역 파라미터.
- 모든 셀의 순차 실행.

### 비주얼 쿼리 빌더

- 드래그 앤 드롭으로 쿼리 구성.
- 비주얼 JOIN, 필터, 집계, 정렬, LIMIT.
- 실시간 SQL 생성.

### Visual EXPLAIN

- 실행 계획의 인터랙티브 그래프.
- 테이블 뷰, 원시 출력, 선택적 AI 분석.
- PostgreSQL, MySQL/MariaDB, SQLite 지원.

### 데이터 그리드

- 인라인 및 일괄 편집.
- 행 생성, 선택, 삭제.
- CSV 또는 JSON으로 내보내기.
- 공간 데이터(GEOMETRY) 초기 지원.
- JSON/JSONB 셀 강조 및 전용 편집 창(Tree / Monaco / Raw). 연결별 선택 옵션: 텍스트 컬럼의 JSON 자동 감지.

### 로깅

- Settings의 실시간 로그 뷰어.
- 레벨별 필터링.
- `.log` 파일로 내보내기.
- CLI 디버그 모드: `tabularis --debug`.

### 플러그인

- stdin/stdout 기반 JSON-RPC 2.0을 사용하는 외부 플러그인 시스템.
- 재시작 없이 커뮤니티 드라이버 설치.
- 공식 레지스트리: [`plugins/registry.json`](./plugins/registry.json).
- 개발자 가이드: [`plugins/PLUGIN_GUIDE.md`](./plugins/PLUGIN_GUIDE.md).

## 설정

설정은 다음 위치에 저장됩니다:

- Linux: `~/.config/tabularis/`
- macOS: `~/Library/Application Support/tabularis/`
- Windows: `%APPDATA%\tabularis\`

주요 파일:

- `connections.json`
- `saved_queries.json`
- `config.json`
- `themes/`
- `preferences/`

`config.json`의 `language` 필드는 `auto`, `en`, `it`, `es`, `zh`, `fr`, `de`, `ja`, `ru`, `tl`, `ko` 값을 지원합니다.

## AI

다음 제공자를 사용하는 선택적 Text-to-SQL 및 쿼리 설명 기능:

- OpenAI
- Anthropic
- MiniMax
- OpenRouter
- Ollama
- OpenAI 호환 API

모델 목록은 로컬에 다운로드되어 캐시됩니다.

## MCP

내장 MCP 서버 실행:

```bash
tabularis --mcp
```

지원 클라이언트:

- Claude Desktop
- Cursor
- Windsurf

사용 가능한 도구:

- `list_connections`
- `list_tables`
- `describe_table`
- `run_query`

## 기술 스택

- 프론트엔드: React 19, TypeScript, Tailwind CSS v4.
- 백엔드: Rust, Tauri v2, SQLx.

## 개발

의존성을 설치하고 실행하세요:

```bash
pnpm install
pnpm tauri dev
```

빌드:

```bash
pnpm tauri build
```

## 로드맵

- 원격 제어
- 커맨드 팔레트
- JSON/JSONB 편집기 및 뷰어
- SQL 포매팅 / Prettier
- 데이터 비교 및 diff
- 협업

## 기여하기

기여를 환영합니다 — [CONTRIBUTING.md](./CONTRIBUTING.md)를 참고하세요. 다음에서 시작할 수 있습니다:

- [SQL Server 드라이버 — 구현 로드맵 및 기여자 모집](https://github.com/TabularisDB/tabularis/issues/150)
- [UI 디자인 시스템 및 비주얼 아이덴티티 — 기여자 모집](https://github.com/TabularisDB/tabularis/issues/195)
- 원하는 언어로 드라이버 플러그인 작성 — [Plugin Guide](./plugins/PLUGIN_GUIDE.md) 참고

## 프로젝트 이야기

Tabularis는 하나의 실험으로 시작했습니다: AI 지원 개발이 처음부터 동작하는 도구를 만드는 데 얼마나 멀리 갈 수 있을까? 예상보다 훨씬 멀리 갔습니다 — 이제는 정기적인 릴리스와 플러그인 생태계를 갖춘 활발히 유지되는 프로젝트가 되었습니다.

## 라이선스

Apache License 2.0

---

<p align="center">
  tabularis가 마음에 드시나요? <a href="https://github.com/TabularisDB/tabularis">저장소에 별을 눌러주세요</a> ⭐ — 프로젝트에 큰 힘이 됩니다.
</p>

<p align="center">
  <a href="https://repostars.dev/?repos=TabularisDB%2Ftabularis&theme=dark">
    <img src="https://repostars.dev/api/embed?repo=TabularisDB%2Ftabularis&theme=dark" alt="RepoStars" />
  </a>
</p>
