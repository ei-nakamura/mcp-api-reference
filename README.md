# mcp-api-reference

API リファレンスドキュメントを自動でクロール・インデックス化し、LLM から検索・参照できるようにする MCP (Model Context Protocol) サーバーです。

## 課題と解決策

LLM が API を利用するコードを生成する際、以下の問題が発生します。

- **ハルシネーション**: 存在しないエンドポイントやパラメータを生成してしまう
- **情報の陳腐化**: トレーニングデータに含まれない最新の API 仕様を参照できない
- **非効率なコンテキスト消費**: ドキュメント全文を渡すとトークンを浪費する

本ツールは、API リファレンスサイトの URL を指定するだけで、自動的にドキュメントをクロール・解析・インデックス化し、MCP ツール経由でトークン効率の良い検索結果を提供します。

## 提供する MCP ツール

| ツール | 説明 | 主な入力 |
|--------|------|----------|
| `search_docs` | キーワードで全文検索 | `query`, `api`(任意), `limit`(1-20) |
| `get_endpoint` | 特定エンドポイントの詳細取得 | `api`, `endpoint`(パス), `method` |
| `list_apis` | 利用可能な API・カテゴリ一覧 | `api`(任意) |

## 必要要件

- Node.js >= 18.0.0

## インストール

```bash
npm install
npm run build
```

## 使い方

### MCP サーバーとして起動

```bash
node dist/index.js
```

### CLI オプション

```bash
# カスタム設定ファイルを指定
node dist/index.js --config ./my-sites.json

# 特定 API のキャッシュを更新
node dist/index.js --refresh kintone

# キャッシュを全削除
node dist/index.js --clear-cache
```

| オプション | 短縮形 | 説明 |
|-----------|--------|------|
| `--config <path>` | `-c` | カスタムサイト設定ファイルのパス |
| `--refresh <api-id>` | `-r` | 指定 API のドキュメントを再取得 |
| `--clear-cache` | - | キャッシュを全削除して終了 |

### Claude Desktop との連携

`claude_desktop_config.json` に以下を追加します。

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

kintone REST API のパーサーがプリセットとして組み込まれています。追加設定なしで利用できます。

## カスタムサイトの追加

`--config` オプションで JSON ファイルを指定することで、任意の API ドキュメントサイトを追加できます。

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
├── index.ts              # CLI エントリポイント
├── server.ts             # MCP サーバー初期化・ツール登録
├── core/
│   ├── crawler.ts        # robots.txt 対応の Web クローラー
│   ├── parser.ts         # パーサーレジストリ
│   ├── indexer.ts        # MiniSearch による全文検索インデックス
│   ├── store.ts          # ドキュメントストア
│   ├── cache.ts          # TTL ベースのキャッシュ管理
│   └── pipeline.ts       # クロール → 解析 → インデックスのパイプライン
├── tools/
│   ├── search-docs.ts    # search_docs ツール
│   ├── get-endpoint.ts   # get_endpoint ツール
│   └── list-apis.ts      # list_apis ツール
├── presets/
│   └── kintone/          # kintone プリセット
├── formatters/
│   └── response.ts       # MCP レスポンスフォーマッター
├── types/                # 型定義
└── utils/                # ユーティリティ (ロガー, glob, ハッシュ)
```

## 開発

```bash
# ウォッチモードでビルド
npm run dev

# テスト実行
npm test

# テスト (ウォッチモード)
npm run test:watch

# 型チェック
npm run typecheck

# リント
npm run lint
```

## 技術スタック

- **@modelcontextprotocol/sdk** - MCP サーバー実装
- **cheerio** - HTML パーサー
- **minisearch** - 全文検索エンジン (日本語トークナイズ対応)
- **zod** - スキーマバリデーション
- **tsup** - TypeScript バンドラー
- **vitest** - テストフレームワーク

## 環境変数

| 変数名 | 説明 | デフォルト |
|--------|------|-----------|
| `MCP_API_REF_CACHE_DIR` | キャッシュディレクトリのパス | `~/.mcp-api-reference/cache/` |
| `MCP_API_REF_CONFIG` | サイト設定ファイルのパス | - |

## ライセンス

MIT
