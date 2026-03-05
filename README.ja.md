# mcp-api-reference

[English README](README.md)

LLM向けにAPIリファレンスドキュメントを自動クロール・インデックス化・提供するMCP（Model Context Protocol）サーバーです。

## 課題と解決策

LLMがAPIを使うコードを生成する際、以下の問題が発生します：

- **ハルシネーション**: 存在しないエンドポイントやパラメータを生成してしまう
- **情報の陳腐化**: 学習データに含まれていない最新のAPI仕様を参照できない
- **非効率なコンテキスト消費**: ドキュメント全体を渡すとトークンを大量に消費する

このツールはURLを指定するだけでAPIリファレンスサイトを自動クロール・パース・インデックス化し、MCPツール経由でトークン効率の良い検索結果を提供します。

## MCPツール

| ツール | 説明 | 主な入力 |
|--------|------|----------|
| `search_docs` | キーワードによる全文検索 | `query`, `api`（省略可）, `limit`（1〜20） |
| `get_endpoint` | 特定エンドポイントの詳細取得 | `api`, `endpoint`（パス）, `method` |
| `list_apis` | 利用可能なAPIとカテゴリの一覧表示 | `api`（省略可） |

## 必要要件

- Node.js >= 18.0.0

## インストール

```bash
npm install
npm run build
```

## 使用方法

### MCPサーバーとして起動

```bash
node dist/index.js
```

### CLIオプション

```bash
# カスタム設定ファイルを指定
node dist/index.js --config ./my-sites.json

# 特定APIのキャッシュをリフレッシュ
node dist/index.js --refresh kintone

# 全キャッシュをクリア
node dist/index.js --clear-cache
```

| オプション | 短縮形 | 説明 |
|------------|--------|------|
| `--config <path>` | `-c` | カスタムサイト設定ファイルのパス |
| `--refresh <api-id>` | `-r` | 指定したAPIのドキュメントを再取得 |
| `--clear-cache` | - | 全キャッシュをクリアして終了 |

### Claude Desktop連携

`claude_desktop_config.json` に以下を追加してください：

```json
{
  "mcpServers": {
    "api-reference": {
      "command": "node",
      "args": ["/path/to/mcp-reference-doc/dist/index.js"]
    }
  }
}
```

## プリセット

### kintone REST API

kintone REST API用のパーサーがプリセットとして組み込まれています。追加設定は不要です。

### Backlog API

Backlog API用のパーサーもプリセットとして利用可能です。追加設定は不要です。

### SmartHR API

SmartHR API用のパーサーもプリセットとして利用可能です。追加設定は不要です。

## カスタムサイト追加

`--config` オプションでJSONファイルを指定することで、任意のAPIドキュメントサイトを追加できます。

```json
{
  "sites": [
    {
      "id": "my-api",
      "name": "My API",
      "baseUrl": "https://api.example.com",
      "crawl": {
        "startUrl": "https://api.example.com/docs",
        "includePatterns": ["https://api.example.com/docs/**"],
        "excludePatterns": [],
        "maxPages": 500,
        "delayMs": 500
      },
      "parser": {
        "type": "generic",
        "selectors": {
          "endpointContainer": ".endpoint",
          "method": ".http-method",
          "path": ".api-path",
          "title": "h3",
          "description": ".description",
          "parameters": ".parameters",
          "responseFields": ".response"
        }
      }
    }
  ]
}
```

## プロジェクト構成

```
src/
├── index.ts              # CLIエントリポイント
├── server.ts             # MCPサーバー初期化とツール登録
├── core/
│   ├── crawler.ts        # robots.txt対応Webクローラー
│   ├── parser.ts         # パーサーレジストリ
│   ├── generic-parser.ts # 汎用HTMLパーサー（CSSセレクタ方式）
│   ├── indexer.ts        # MiniSearchによる全文検索インデックス
│   ├── store.ts          # ドキュメントストア
│   ├── cache.ts          # TTLベースのキャッシュ管理
│   └── pipeline.ts       # クロール → パース → インデックスパイプライン
├── tools/
│   ├── search-docs.ts    # search_docsツール
│   ├── get-endpoint.ts   # get_endpointツール
│   └── list-apis.ts      # list_apisツール
├── presets/
│   ├── kintone/          # kintoneプリセット
│   ├── backlog/          # Backlogプリセット
│   └── smarthr/          # SmartHRプリセット
├── formatters/
│   └── response.ts       # MCPレスポンスフォーマッター
├── types/                # 型定義
└── utils/                # ユーティリティ（logger, glob, hash）
```

## 開発コマンド

```bash
# ウォッチモードでビルド
npm run dev

# テスト実行
npm test

# テスト実行（ウォッチモード）
npm run test:watch

# 型チェック
npm run typecheck

# リント
npm run lint
```

## 技術スタック

- **@modelcontextprotocol/sdk** - MCPサーバー実装
- **cheerio** - HTMLパーサー
- **minisearch** - 全文検索エンジン（日本語トークナイズ対応）
- **zod** - スキーマバリデーション
- **tsup** - TypeScriptバンドラー
- **vitest** - テストフレームワーク

## 環境変数

| 変数名 | 説明 | デフォルト |
|--------|------|-----------|
| `MCP_API_REF_CACHE_DIR` | キャッシュディレクトリのパス | `~/.mcp-api-reference/cache/` |
| `MCP_API_REF_CONFIG` | サイト設定ファイルのパス | - |

## ライセンス

MIT
