# 要件定義書: API Reference MCP Server

> **Version**: 1.0.0
> **作成日**: 2026-03-01
> **対象**: 個人開発 OSS プロジェクト

---

## 1. プロジェクト概要

### 1.1 プロジェクト名の候補

| # | パッケージ名 | 説明 |
|---|---|---|
| 1 | `@anthropic-tools/apidocs-mcp` | Anthropic ツール系の名前空間。公式感がある |
| 2 | `mcp-api-reference` | 直球で機能を表す。検索性が高い |
| 3 | `refdoc-mcp` | 短く覚えやすい。"reference document" の略 |
| 4 | `apilens-mcp` | ブランド性がある。"API を覗き見る" イメージ |
| 5 | `docbase-mcp` | シンプルだが既存サービスと名前衝突の可能性あり |

**推奨**: `mcp-api-reference`
- npm の命名規約に準拠（`mcp-` プレフィックスで MCP サーバーであることが一目瞭然）
- `npx mcp-api-reference` で起動でき、直感的
- GitHub リポジトリ名としてもそのまま使える

### 1.2 エレベーターピッチ

**任意の API リファレンスサイトの URL を指定するだけで、ドキュメントを自動クロール・構造化し、MCP 経由で LLM から高速に検索・参照できるようにするオープンソースの MCP サーバー。** kintone や Backlog などの日本の SaaS API にもプリセット対応しており、セットアップ不要で即座に利用可能。

### 1.3 解決する課題

| 課題 | 詳細 |
|---|---|
| LLM のハルシネーション | パラメータ名、エンドポイントパス、レスポンス構造の細部で不正確な情報を生成する |
| 既存ツールのカバレッジ不足 | Context7 はコミュニティ登録制で日本の SaaS API 未対応。fetch MCP は生 HTML を返すだけでコンテキストを浪費する |
| セットアップの煩雑さ | API ドキュメントを手動でコピーして CLAUDE.md に貼り付けるなど、非効率なワークアラウンドが横行している |
| コンテキストウィンドウの圧迫 | 生 HTML や全文ドキュメントを渡すと、肝心のコーディング作業に使えるコンテキストが減少する |

---

## 2. 機能要件

### 2.1 MCP ツール定義

#### 2.1.1 `search_docs` — キーワードでAPIドキュメントを検索

```typescript
// 入力スキーマ
{
  name: "search_docs",
  description: "Search API documentation by keyword. Returns matching endpoints and descriptions.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query (e.g., 'create record', 'レコード登録')"
      },
      api: {
        type: "string",
        description: "Target API identifier (e.g., 'kintone', 'backlog'). If omitted, searches all indexed APIs."
      },
      limit: {
        type: "number",
        description: "Maximum number of results to return (default: 5, max: 20)"
      }
    },
    required: ["query"]
  }
}
```

```typescript
// レスポンス形式
{
  content: [{
    type: "text",
    text: `Found 3 results for "create record" in kintone API:

1. POST /k/v1/record.json — レコードを登録する
   Parameters: app (number, required), record (object)
   → Use get_endpoint("kintone", "/k/v1/record.json", "POST") for details

2. POST /k/v1/records.json — レコードを一括登録する
   Parameters: app (number, required), records (array, required)
   → Use get_endpoint("kintone", "/k/v1/records.json", "POST") for details

3. PUT /k/v1/record.json — レコードを更新する
   Parameters: app (number, required), id (number), record (object)
   → Use get_endpoint("kintone", "/k/v1/record.json", "PUT") for details`
  }]
}
```

**設計方針**:
- 検索結果は要約形式で返し、詳細は `get_endpoint` への誘導で遅延取得させる
- 1件あたり 2〜3 行に収め、5件でも約 500 トークン以内に抑える
- 検索結果には次のアクション（`get_endpoint` 呼び出し例）を含め、LLM が自律的に深掘りできるようにする

#### 2.1.2 `get_endpoint` — 特定エンドポイントの詳細情報を取得

```typescript
// 入力スキーマ
{
  name: "get_endpoint",
  description: "Get detailed information about a specific API endpoint including parameters, request/response examples, and authentication requirements.",
  inputSchema: {
    type: "object",
    properties: {
      api: {
        type: "string",
        description: "API identifier (e.g., 'kintone', 'backlog')"
      },
      endpoint: {
        type: "string",
        description: "Endpoint path (e.g., '/k/v1/record.json')"
      },
      method: {
        type: "string",
        enum: ["GET", "POST", "PUT", "DELETE", "PATCH"],
        description: "HTTP method"
      }
    },
    required: ["api", "endpoint", "method"]
  }
}
```

```typescript
// レスポンス形式
{
  content: [{
    type: "text",
    text: `## POST /k/v1/record.json — レコードを登録する

### Authentication
Password authentication, API token, Session authentication, OAuth

### Request Parameters
| Parameter | Type     | Required | Description                    |
|-----------|----------|----------|--------------------------------|
| app       | number   | Yes      | アプリのID                      |
| record    | object   | No       | フィールドコードと値のオブジェクト |

### record object format
{ "<fieldCode>": { "value": <value> } }

### Response
| Property | Type   | Description     |
|----------|--------|-----------------|
| id       | string | レコードのID     |
| revision | string | リビジョン番号    |

### Example Request
POST https://sample.cybozu.com/k/v1/record.json
Content-Type: application/json
{ "app": 1, "record": { "文字列__1行_": { "value": "test" } } }

### Example Response
{ "id": "100", "revision": "1" }

### Notes
- record を省略すると、各フィールドの初期値が設定される
- 登録できるフィールドの制限についてはドキュメント参照`
  }]
}
```

**設計方針**:
- 1 エンドポイントの情報を 1 回のレスポンスで完結させる
- Markdown テーブル形式でパラメータを整理し、LLM が即座にコード生成に使える形にする
- リクエスト/レスポンスの JSON 例を含め、型情報だけでは分からない構造を補完する
- 目標: 1 エンドポイントあたり約 500〜1500 トークン

#### 2.1.3 `list_apis` — 利用可能なAPI一覧を取得

```typescript
// 入力スキーマ
{
  name: "list_apis",
  description: "List all available APIs and their endpoint categories. Use this to discover what APIs are indexed and available for search.",
  inputSchema: {
    type: "object",
    properties: {
      api: {
        type: "string",
        description: "If specified, list endpoint categories for this API. If omitted, list all available APIs."
      }
    },
    required: []
  }
}
```

```typescript
// レスポンス形式（api 省略時）
{
  content: [{
    type: "text",
    text: `Available APIs:

1. kintone (85 endpoints) — Cybozu kintone REST API
   Categories: Records, Apps, Spaces, Files, Plugins, API Info
   Source: https://cybozu.dev/ja/kintone/docs/rest-api/
   Last updated: 2026-02-28

2. backlog (150 endpoints) — Nulab Backlog API v2
   Categories: Space, Users, Projects, Issues, Wiki, Git, Teams
   Source: https://developer.nulab.com/ja/docs/backlog/
   Last updated: 2026-02-28

Use search_docs(query, api) to search within a specific API.`
  }]
}
```

```typescript
// レスポンス形式（api 指定時）
{
  content: [{
    type: "text",
    text: `kintone REST API — 85 endpoints

## Records (20 endpoints)
- GET  /k/v1/record.json — レコードを取得する
- GET  /k/v1/records.json — レコードを一括取得する
- POST /k/v1/record.json — レコードを登録する
...

## Apps (35 endpoints)
- GET /k/v1/app.json — アプリの設定を取得する
...

(truncated — use search_docs to find specific endpoints)`
  }]
}
```

**設計方針**:
- `api` 省略時は API の概要だけを返す（約 200 トークン）
- `api` 指定時はカテゴリとエンドポイント一覧を返すが、多い場合は省略して `search_docs` へ誘導
- LLM が「どんな API が使えるか」を最初に把握するためのディスカバリーツール

### 2.2 プリセット機能の仕様

#### 2.2.1 プリセット定義ファイル

各プリセットは以下のインターフェースに準拠した設定ファイルとして定義する。

```typescript
interface PresetConfig {
  /** プリセット識別子（例: "kintone"） */
  id: string;

  /** 表示名 */
  name: string;

  /** API の説明 */
  description: string;

  /** ドキュメントのベース URL */
  baseUrl: string;

  /** クロール設定 */
  crawl: {
    /** クロール開始 URL（indexページ） */
    startUrl: string;
    /** クロール対象の URL パターン（glob or regex） */
    includePatterns: string[];
    /** クロール除外パターン */
    excludePatterns: string[];
    /** 最大クロールページ数 */
    maxPages: number;
    /** クロール間隔（ミリ秒）— サイトへの負荷軽減 */
    delayMs: number;
  };

  /** パース設定 */
  parser: {
    /** パーサータイプ（"preset" = カスタムパーサー使用, "generic" = 汎用パーサー） */
    type: "preset" | "generic";
    /** カスタムパーサーモジュールのパス（type: "preset" 時） */
    parserModule?: string;
    /** 汎用パーサー用のセレクタ設定（type: "generic" 時） */
    selectors?: GenericParserSelectors;
  };
}

interface GenericParserSelectors {
  /** メインコンテンツ領域のセレクタ */
  contentSelector: string;
  /** エンドポイントタイトルのセレクタ */
  titleSelector: string;
  /** HTTP メソッド + パスのセレクタ */
  endpointSelector: string;
  /** パラメータテーブルのセレクタ */
  parameterTableSelector: string;
  /** コードブロック（リクエスト/レスポンス例）のセレクタ */
  codeBlockSelector: string;
  /** 除外要素のセレクタ（ナビゲーション、フッターなど） */
  excludeSelectors: string[];
}
```

#### 2.2.2 プリセットディレクトリ構造

```
src/presets/
├── index.ts              # プリセットレジストリ
├── kintone/
│   ├── config.ts         # PresetConfig 定義
│   └── parser.ts         # kintone 専用パーサー
└── backlog/
    ├── config.ts         # PresetConfig 定義
    └── parser.ts         # Backlog 専用パーサー
```

#### 2.2.3 kintone プリセットのパース戦略

**サイト構造の調査結果**に基づく具体的な戦略:

```typescript
// kintone プリセット設定
const kintoneConfig: PresetConfig = {
  id: "kintone",
  name: "kintone REST API",
  description: "Cybozu kintone REST API documentation",
  baseUrl: "https://cybozu.dev",
  crawl: {
    startUrl: "https://cybozu.dev/ja/kintone/docs/rest-api/",
    includePatterns: [
      "https://cybozu.dev/ja/kintone/docs/rest-api/**"
    ],
    excludePatterns: [
      "**/changelog/**",
      "**/overview/**"
    ],
    maxPages: 200,
    delayMs: 1000,
  },
  parser: {
    type: "preset",
    parserModule: "./kintone/parser",
  },
};
```

**kintone パーサーの実装方針**:

1. **インデックスページ（一覧ページ）のパース**
   - URL: `/ja/kintone/docs/rest-api/`
   - サイドバーのアコーディオンナビゲーション（`.icon_accordion_toggle` / `.icon_accordion_child_toggle`）からカテゴリ構造を抽出
   - 各エンドポイントへのリンク（`a[href*="/ja/kintone/docs/rest-api/"]`）を収集

2. **個別エンドポイントページのパース**
   - H1 タグからエンドポイント名（日本語）を取得
   - 仕様テーブル（`vtable` テンプレート由来の `<table>`）から HTTP メソッド、URL パス、認証方式を抽出
   - パラメータテーブルを検出：ヘッダー行が「パラメーター名 | 型 | 必須 | 説明」の 4 列テーブル
   - レスポンステーブル：ヘッダー行が「プロパティ名 | 型 | 説明」の 3 列テーブル
   - アコーディオン内のコードブロック（`<pre><code>`）からリクエスト/レスポンス例を抽出
   - 注意事項は箇条書きリスト（`<ul><li>`）から取得

3. **正規化処理**
   - URL パス内の `sample.cybozu.com` を `{subdomain}.cybozu.com` に正規化
   - ゲストスペース用 URL のバリエーションも併記
   - パラメータの型名を統一（`文字列` → `string`, `数値` → `number`）

#### 2.2.4 Backlog プリセットのパース戦略

**サイト構造の調査結果**に基づく具体的な戦略:

```typescript
const backlogConfig: PresetConfig = {
  id: "backlog",
  name: "Backlog API v2",
  description: "Nulab Backlog API v2 documentation",
  baseUrl: "https://developer.nulab.com",
  crawl: {
    startUrl: "https://developer.nulab.com/ja/docs/backlog/",
    includePatterns: [
      "https://developer.nulab.com/ja/docs/backlog/api/2/**"
    ],
    excludePatterns: [],
    maxPages: 300,
    delayMs: 1000,
  },
  parser: {
    type: "preset",
    parserModule: "./backlog/parser",
  },
};
```

**Backlog パーサーの実装方針**:

1. **インデックスページのパース**
   - URL: `/ja/docs/backlog/`
   - `#markdownNavigation` 内のネストされた `<ul>` からカテゴリ構造を抽出
   - 個別 API ページへのリンクを収集（パターン: `/ja/docs/backlog/api/2/{endpoint-name}/`）

2. **個別エンドポイントページのパース**
   - Astro フレームワークで生成された静的 HTML を対象（`[data-astro-cid-*]` 属性付き）
   - H1 タグからエンドポイント名（日本語）を取得
   - 本文先頭のコードブロックまたはテキストから `GET/POST/PUT/DELETE /api/v2/...` パターンを抽出
   - H3 セクション構造に基づいてコンテンツを分割:
     - 「実行可能な権限」→ permissions
     - 「URL パラメーター」/「リクエストパラメーター」→ parameters テーブル
     - 「リクエストの例」→ request example（curl 形式）
     - 「レスポンス例」→ response example（JSON）
   - パラメータテーブル: 「パラメータ名 | 型 | 内容」の 3 列構造
   - 配列パラメータの `[]` 記法（例: `categoryId[]`）を検出して型情報に反映

3. **正規化処理**
   - ベース URL を `{spaceId}.backlog.com` に正規化
   - API キー認証のクエリパラメータ `?apiKey=` を認証情報として分離

### 2.3 ユーザー定義サイト追加の設定スキーマ

ユーザーは MCP サーバーの設定で独自のドキュメントサイトを追加できる。

#### 2.3.1 MCP サーバー設定（claude_desktop_config.json / settings.json）

```jsonc
{
  "mcpServers": {
    "api-reference": {
      "command": "npx",
      "args": ["-y", "mcp-api-reference"],
      "env": {
        // カスタムサイト定義ファイルのパス（オプション）
        "MCP_API_REF_CONFIG": "/path/to/custom-sites.json",
        // キャッシュディレクトリ（オプション、デフォルト: ~/.mcp-api-reference/cache）
        "MCP_API_REF_CACHE_DIR": "/path/to/cache",
        // 有効にするプリセット（カンマ区切り、デフォルト: 全プリセット）
        "MCP_API_REF_PRESETS": "kintone,backlog"
      }
    }
  }
}
```

#### 2.3.2 カスタムサイト定義ファイル（custom-sites.json）

```jsonc
{
  "sites": [
    {
      "id": "my-internal-api",
      "name": "社内 API",
      "description": "社内システムの REST API",
      "baseUrl": "https://docs.internal.example.com",
      "crawl": {
        "startUrl": "https://docs.internal.example.com/api/",
        "includePatterns": ["https://docs.internal.example.com/api/**"],
        "excludePatterns": ["**/changelog/**"],
        "maxPages": 100,
        "delayMs": 500
      },
      "parser": {
        "type": "generic",
        "selectors": {
          "contentSelector": "main, article, .content",
          "titleSelector": "h1",
          "endpointSelector": "code, .endpoint",
          "parameterTableSelector": "table",
          "codeBlockSelector": "pre code",
          "excludeSelectors": ["nav", "footer", ".sidebar", ".breadcrumb"]
        }
      }
    }
  ]
}
```

### 2.4 クローリング・パース処理のフロー

```
[起動時]
  │
  ├─ プリセット設定をロード
  ├─ カスタムサイト設定をロード（ENV から）
  │
  ▼
[各サイトについて]
  │
  ├─ キャッシュ確認 ──→ 有効なキャッシュあり ──→ インデックスをロード ──→ [完了]
  │
  ├─ キャッシュなし or 期限切れ
  │
  ▼
[クロールフェーズ]
  │
  ├─ startUrl を取得
  ├─ HTML をパース、リンクを収集
  ├─ includePatterns にマッチするリンクをキューに追加
  ├─ excludePatterns にマッチするリンクを除外
  ├─ delayMs 間隔で次ページを取得
  ├─ maxPages に達したら停止
  │
  ▼
[パースフェーズ]
  │
  ├─ 各ページの HTML を取得
  ├─ パーサー（preset or generic）で構造化データに変換:
  │   ├─ EndpointDocument {
  │   │     id, apiId, method, path, title, description,
  │   │     parameters[], responseFields[], examples[],
  │   │     authentication, permissions, notes, sourceUrl
  │   │   }
  │   └─
  │
  ▼
[インデックス構築フェーズ]
  │
  ├─ MiniSearch インデックスを構築
  │   ├─ フィールド: title, path, description, parameterNames
  │   ├─ 日本語トークナイザー: Intl.Segmenter('ja', { granularity: 'word' })
  │   └─
  ├─ インデックスを JSON シリアライズしてキャッシュに保存
  │
  ▼
[サーバー起動完了 — MCP ツール受付開始]
```

### 2.5 インデックス構築と検索の仕様

#### 2.5.1 インデックス対象データモデル

```typescript
interface EndpointDocument {
  /** 一意識別子: "{apiId}:{method}:{path}" */
  id: string;

  /** API 識別子（例: "kintone"） */
  apiId: string;

  /** カテゴリ（例: "Records", "Issues"） */
  category: string;

  /** HTTP メソッド */
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

  /** エンドポイントパス（例: "/k/v1/record.json"） */
  path: string;

  /** エンドポイント名（例: "レコードを取得する"） */
  title: string;

  /** 説明文 */
  description: string;

  /** パラメータ一覧 */
  parameters: ParameterInfo[];

  /** レスポンスフィールド一覧 */
  responseFields: FieldInfo[];

  /** リクエスト/レスポンス例 */
  examples: ExampleInfo[];

  /** 認証方式 */
  authentication: string[];

  /** 必要な権限 */
  permissions: string[];

  /** 補足事項 */
  notes: string[];

  /** 元ドキュメントの URL */
  sourceUrl: string;
}

interface ParameterInfo {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

interface FieldInfo {
  name: string;
  type: string;
  description: string;
}

interface ExampleInfo {
  type: "request" | "response";
  format: "json" | "curl" | "url";
  content: string;
}
```

#### 2.5.2 MiniSearch 設定

```typescript
const searchIndex = new MiniSearch<EndpointDocument>({
  fields: ["title", "path", "description", "parameterNames", "category"],
  storeFields: ["apiId", "method", "path", "title", "category"],
  tokenize: (text: string) => {
    // 日本語対応: Intl.Segmenter + ASCII ワード分割のハイブリッド
    const segmenter = new Intl.Segmenter("ja", { granularity: "word" });
    return [...segmenter.segment(text)]
      .filter((s) => s.isWordLike)
      .map((s) => s.segment.toLowerCase());
  },
  searchOptions: {
    boost: { title: 3, path: 2, parameterNames: 1.5 },
    fuzzy: 0.2,
    prefix: true,
  },
});
```

**検索フィールドの重み付け理由**:
- `title` (×3): エンドポイント名は最も重要な検索対象（「レコード取得」で目的の API を特定）
- `path` (×2): パス文字列での検索（`/record.json` で直接指定）
- `parameterNames` (×1.5): パラメータ名での逆引き（「assigneeId」で関連 API を発見）
- `description`, `category` (×1): 補助的な検索用

### 2.6 キャッシュ・更新戦略

#### 2.6.1 キャッシュ構造

```
~/.mcp-api-reference/
├── cache/
│   ├── kintone/
│   │   ├── index.json        # MiniSearch シリアライズ済みインデックス
│   │   ├── documents.json    # EndpointDocument の配列
│   │   └── meta.json         # クロール日時、バージョン情報
│   └── backlog/
│       ├── index.json
│       ├── documents.json
│       └── meta.json
└── config/
    └── custom-sites.json     # ユーザー定義サイト設定（コピー）
```

#### 2.6.2 更新ポリシー

| ポリシー | 値 | 説明 |
|---|---|---|
| キャッシュ有効期限 | 7 日 | `meta.json` の `crawledAt` から 7 日経過で再クロール |
| 手動更新 | CLI 引数 `--refresh` | 強制的に再クロール |
| 起動時の挙動 | キャッシュ優先 | 有効なキャッシュがあれば即座にサーバー起動（バックグラウンドで更新チェックしない） |
| 初回起動 | 同期クロール | キャッシュがない場合は起動前にクロール・インデックス構築を実行 |
| プリセット更新 | npm 更新時 | プリセット設定の変更はパッケージ更新で反映 |

#### 2.6.3 CLI オプション

```bash
# 通常起動（キャッシュ使用）
npx mcp-api-reference

# 特定 API のキャッシュを強制更新
npx mcp-api-reference --refresh kintone

# 全キャッシュクリア
npx mcp-api-reference --clear-cache

# カスタム設定ファイル指定
npx mcp-api-reference --config /path/to/custom-sites.json
```

---

## 3. 非機能要件

### 3.1 パフォーマンス

| 指標 | 目標値 | 備考 |
|---|---|---|
| 初回クロール時間（kintone, ~100 ページ） | 3 分以内 | delayMs=1000 前提 |
| 初回クロール時間（Backlog, ~150 ページ） | 5 分以内 | delayMs=1000 前提 |
| キャッシュからのインデックスロード | 1 秒以内 | JSON デシリアライズ |
| 検索レスポンス時間（search_docs） | 50ms 以内 | MiniSearch のインメモリ検索 |
| エンドポイント詳細取得（get_endpoint） | 10ms 以内 | メモリ上のドキュメント参照 |
| サーバー起動時間（キャッシュあり） | 2 秒以内 | インデックスロード含む |

### 3.2 ストレージ

| 項目 | 目安 |
|---|---|
| 1 API あたりのインデックスサイズ | 1〜5 MB |
| 1 API あたりのドキュメント保存サイズ | 2〜10 MB |
| 合計キャッシュサイズ（2 プリセット） | 10〜30 MB |
| 保存場所 | `~/.mcp-api-reference/cache/` |
| Windows の保存場所 | `%USERPROFILE%/.mcp-api-reference/cache/` |

### 3.3 セキュリティ

| 項目 | 方針 |
|---|---|
| 認証情報 | カスタムサイトの認証ヘッダーは環境変数経由でのみ受け付け、設定ファイルには保存しない |
| クロール対象の制限 | `includePatterns` で明示的に許可された URL のみクロール。オープンリダイレクトによる SSRF を防止 |
| ローカルファイルアクセス | `file://` プロトコルは拒否 |
| キャッシュデータ | ローカルファイルシステムにのみ保存。外部送信なし |
| 依存パッケージ | 最小限に抑え、既知の脆弱性がないことを CI で検証（`npm audit`） |

### 3.4 国際化（日本語対応）

| 項目 | 方針 |
|---|---|
| トークナイザー | `Intl.Segmenter('ja', { granularity: 'word' })` を使用（Node.js 16+ 標準搭載） |
| フォールバック | `Intl.Segmenter` 非対応環境では bigram トークナイズにフォールバック |
| 文字コード | UTF-8 前提。HTML の `<meta charset>` を尊重 |
| MCP レスポンス言語 | ドキュメント元の言語をそのまま使用（日本語サイトなら日本語で返す） |
| ツール説明文 | 英語で記述（MCP プロトコルの慣例に従う） |

---

## 4. 技術設計

### 4.1 アーキテクチャ概要

```
┌─────────────────────────────────────────────────────────────┐
│                      MCP Client                             │
│              (Claude Code / Cursor / Claude Desktop)        │
└──────────────────────┬──────────────────────────────────────┘
                       │ stdio (JSON-RPC)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                   MCP Server (本プロジェクト)                 │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │  Tool:       │  │  Tool:       │  │  Tool:            │  │
│  │  search_docs │  │  get_endpoint│  │  list_apis        │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬──────────┘  │
│         │                 │                    │             │
│         └────────┬────────┘────────────────────┘             │
│                  ▼                                           │
│  ┌─────────────────────────────────────┐                    │
│  │         Document Store              │                    │
│  │  (EndpointDocument[] in memory)     │                    │
│  └──────────────┬──────────────────────┘                    │
│                 │                                            │
│  ┌──────────────┴──────────────────────┐                    │
│  │         Search Engine               │                    │
│  │  (MiniSearch index in memory)       │                    │
│  └──────────────┬──────────────────────┘                    │
│                 │                                            │
│  ┌──────────────┴──────────────────────┐                    │
│  │         Cache Manager               │                    │
│  │  (JSON files on disk)               │                    │
│  └──────────────┬──────────────────────┘                    │
│                 │                                            │
│  ┌──────────────┴──────────────────────┐                    │
│  │       Crawler & Parser Pipeline     │                    │
│  │                                     │                    │
│  │  ┌──────────┐    ┌───────────────┐  │                    │
│  │  │ Crawler  │───▶│ Parser        │  │                    │
│  │  │ (HTTP)   │    │ (per-site)    │  │                    │
│  │  └──────────┘    └───────────────┘  │                    │
│  │                                     │                    │
│  │  ┌──────────────────────────────┐   │                    │
│  │  │ Preset Parsers               │   │                    │
│  │  │ ├── kintone/parser.ts        │   │                    │
│  │  │ └── backlog/parser.ts        │   │                    │
│  │  └──────────────────────────────┘   │                    │
│  │                                     │                    │
│  │  ┌──────────────────────────────┐   │                    │
│  │  │ Generic Parser               │   │                    │
│  │  │ (CSS selector based)         │   │                    │
│  │  └──────────────────────────────┘   │                    │
│  └─────────────────────────────────────┘                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
         │
         ▼ (初回 or 更新時のみ)
┌──────────────────┐
│  Target API Docs │
│  (外部サイト)     │
└──────────────────┘
```

### 4.2 ディレクトリ構成

```
mcp-api-reference/
├── src/
│   ├── index.ts                  # エントリポイント（MCP サーバー起動）
│   ├── server.ts                 # McpServer 定義、ツール登録
│   ├── tools/
│   │   ├── search-docs.ts        # search_docs ツール実装
│   │   ├── get-endpoint.ts       # get_endpoint ツール実装
│   │   └── list-apis.ts          # list_apis ツール実装
│   ├── core/
│   │   ├── crawler.ts            # HTTP クローラー
│   │   ├── parser.ts             # パーサーインターフェース & 汎用パーサー
│   │   ├── indexer.ts            # MiniSearch インデックス構築
│   │   ├── store.ts              # ドキュメントストア（メモリ & ディスク）
│   │   └── cache.ts              # キャッシュ管理
│   ├── presets/
│   │   ├── index.ts              # プリセットレジストリ
│   │   ├── kintone/
│   │   │   ├── config.ts         # kintone 設定
│   │   │   └── parser.ts         # kintone 専用パーサー
│   │   └── backlog/
│   │       ├── config.ts         # Backlog 設定
│   │       └── parser.ts         # Backlog 専用パーサー
│   ├── formatters/
│   │   └── response.ts           # MCP レスポンスフォーマッター
│   └── types/
│       ├── config.ts             # 設定型定義
│       └── document.ts           # ドキュメント型定義
├── tests/
│   ├── tools/
│   │   ├── search-docs.test.ts
│   │   ├── get-endpoint.test.ts
│   │   └── list-apis.test.ts
│   ├── core/
│   │   ├── crawler.test.ts
│   │   ├── parser.test.ts
│   │   └── indexer.test.ts
│   ├── presets/
│   │   ├── kintone.test.ts
│   │   └── backlog.test.ts
│   └── fixtures/
│       ├── kintone/              # kintone HTML スナップショット
│       └── backlog/              # Backlog HTML スナップショット
├── docs/
│   └── requirements.md           # 本ドキュメント
├── .github/
│   └── workflows/
│       ├── ci.yml                # lint, test, build
│       └── publish.yml           # npm publish (tag push)
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── eslint.config.js
├── .prettierrc
├── README.md                     # 英語
├── README.ja.md                  # 日本語
├── CONTRIBUTING.md
├── LICENSE                       # MIT
└── .gitignore
```

### 4.3 主要な依存ライブラリの選定

| ライブラリ | 用途 | 選定理由 |
|---|---|---|
| `@modelcontextprotocol/sdk` | MCP サーバー実装 | 公式 SDK。Zod ベースのツール定義、stdio トランスポート標準搭載 |
| `zod` | 入力バリデーション | MCP SDK が依存。ツールパラメータのスキーマ定義に使用 |
| `minisearch` | 全文検索エンジン | ゼロ依存、7KB、インメモリ高速検索、シリアライズ対応。日本語はカスタムトークナイザーで対応 |
| `cheerio` | HTML パース | jQuery ライクな API で DOM 操作。Node.js で最も広く使われる HTML パーサー。軽量 |
| `undici` | HTTP クライアント | Node.js 組み込みの `fetch` を補完。タイムアウト・リトライ制御が容易 |
| `vitest` | テストフレームワーク | 高速、TypeScript ネイティブ対応、ESM 対応 |
| `typescript` | 言語 | 型安全性。MCP SDK が TypeScript 前提 |
| `eslint` + `prettier` | コード品質 | 一貫したコードスタイルの維持 |
| `tsup` | バンドル | TypeScript プロジェクトの簡潔なビルド設定。ESM + CJS 同時出力 |

**意図的に採用しないもの**:
- `puppeteer` / `playwright`: ヘッドレスブラウザは重すぎる。対象サイトは SSR されており、静的 HTML で十分
- `axios`: `undici` / Node.js 組み込み `fetch` で十分
- `lunr`: MiniSearch の方が API が直感的で、日本語カスタマイズが容易
- `elasticsearch` / `sqlite`: 外部プロセス依存を避け、ローカル完結を維持

### 4.4 データモデル（インデックスのスキーマ）

#### 4.4.1 ドキュメントストア（documents.json）

```typescript
// ディスク保存形式
interface DocumentStore {
  version: 1;
  apiId: string;
  crawledAt: string;    // ISO 8601
  endpointCount: number;
  categories: CategoryInfo[];
  documents: EndpointDocument[];
}

interface CategoryInfo {
  name: string;
  endpointCount: number;
}
```

#### 4.4.2 MiniSearch インデックス用中間データ

```typescript
// MiniSearch に投入するドキュメント形式
interface SearchableDocument {
  id: string;                   // "{apiId}:{method}:{path}"
  title: string;                // "レコードを取得する"
  path: string;                 // "/k/v1/record.json"
  method: string;               // "GET"
  description: string;          // 説明文（200文字以内に切り詰め）
  parameterNames: string;       // "app id fields" (スペース区切り)
  category: string;             // "Records"
  apiId: string;                // "kintone"
}
```

#### 4.4.3 メタデータ（meta.json）

```typescript
interface CacheMeta {
  version: 1;
  apiId: string;
  crawledAt: string;           // ISO 8601
  crawlDurationMs: number;
  pagesCrawled: number;
  endpointsParsed: number;
  indexSizeBytes: number;
  serverVersion: string;       // パッケージバージョン
  configHash: string;          // 設定のハッシュ（変更検知用）
}
```

---

## 5. 開発ロードマップ

### Phase 1: MVP（最小実行可能製品）

**ゴール**: kintone プリセットのみで `search_docs` と `get_endpoint` が動作し、npm 公開して `npx` で起動可能な状態

**完了条件**:
- [ ] MCP サーバーが stdio で起動し、Claude Code から接続可能
- [ ] kintone REST API の全エンドポイント（約 85 件）をクロール・パース可能
- [ ] `search_docs` でキーワード検索し、関連エンドポイントを返せる
- [ ] `get_endpoint` で特定エンドポイントの詳細（パラメータ、例）を返せる
- [ ] `list_apis` で利用可能 API 一覧を返せる
- [ ] キャッシュが機能し、2 回目以降の起動が高速
- [ ] npm パッケージとして公開済み
- [ ] README.md（英語）が存在
- [ ] 基本的なテスト（パーサー、検索）が通る

**主要タスク**:
1. プロジェクト初期化（TypeScript, ESLint, Vitest, tsup）
2. MCP サーバー骨格の実装（`@modelcontextprotocol/sdk`）
3. クローラーの実装（HTTP fetch + リンク収集 + ディレイ制御）
4. kintone 専用パーサーの実装（HTML → EndpointDocument）
5. MiniSearch インデックス構築（日本語トークナイザー含む）
6. キャッシュマネージャーの実装（JSON ファイル読み書き）
7. 3 つの MCP ツール実装
8. レスポンスフォーマッターの実装
9. テスト作成（HTML フィクスチャベース）
10. npm パッケージ設定・公開

### Phase 2: プリセット拡充 & ユーザー定義サイト対応

**ゴール**: Backlog プリセット追加、汎用パーサーで任意サイトに対応、日英 README 完備

**完了条件**:
- [ ] Backlog API プリセットが動作
- [ ] 汎用パーサー（CSS セレクタベース）が実装済み
- [ ] ユーザーが `custom-sites.json` で独自サイトを追加可能
- [ ] README.ja.md（日本語）が存在
- [ ] CONTRIBUTING.md でプリセット追加手順を説明
- [ ] GitHub Actions CI（lint, test, build, npm publish）が稼働
- [ ] MITライセンスファイルが存在

**主要タスク**:
1. Backlog 専用パーサーの実装
2. 汎用パーサー（GenericParser）の実装
3. カスタムサイト設定の読み込み機構
4. CLI オプション（`--refresh`, `--clear-cache`, `--config`）の実装
5. README.ja.md の作成
6. CONTRIBUTING.md の作成
7. GitHub Actions ワークフロー構築
8. テスト拡充

### Phase 3: 品質向上 & コミュニティ形成

**ゴール**: セマンティック検索の設計、コントリビューション受け入れ体制、ポートフォリオとしての完成度

**完了条件**:
- [ ] セマンティック検索のインターフェース設計が完了（実装は任意）
- [ ] プリセット追加の Pull Request テンプレートが存在
- [ ] 使用例の GIF/動画が README に含まれる
- [ ] エラーハンドリングが堅牢（ネットワークエラー、パースエラーの graceful degradation）
- [ ] 追加プリセット 1〜2 件（コミュニティ or 自作）

**主要タスク**:
1. SearchEngine インターフェースの抽象化（MiniSearch 以外のバックエンド差し替え可能に）
2. セマンティック検索アダプターのインターフェース設計
3. PR テンプレート、Issue テンプレートの作成
4. デモ GIF/動画の作成
5. エラーハンドリングの強化
6. ドキュメント整備（アーキテクチャ説明、API リファレンス）
7. 追加プリセット候補の検討と実装

---

## 6. 競合・類似ツールとの差別化

### 6.1 比較表

| 特徴 | **本プロジェクト** | Context7 | fetch MCP | Google Dev Knowledge MCP | Apidog MCP |
|---|---|---|---|---|---|
| **対応範囲** | 任意の API ドキュメントサイト | OSS ライブラリ（コミュニティ登録制） | 任意の URL | Google 公式ドキュメントのみ | Apidog プロジェクトのみ |
| **セットアップ** | URL 指定 or プリセット選択 | ライブラリ名指定 | URL 直接指定 | 設定不要 | Apidog アカウント + API キー |
| **構造化** | エンドポイント単位で構造化 | チャンク化済み | 生 Markdown（構造化なし） | 構造化済み | OpenAPI 準拠で構造化 |
| **検索機能** | 全文検索（MiniSearch） | セマンティック検索（クラウド） | なし（URL 直接指定のみ） | Google 検索ベース | API 名検索 |
| **日本語対応** | ネイティブ対応（Intl.Segmenter） | 限定的 | パススルー（処理なし） | 非対応 | 限定的 |
| **オフライン動作** | 可能（初回クロール後） | 不可（クラウド依存） | 不可（リアルタイム fetch） | 不可 | 不可 |
| **プリセット** | kintone, Backlog（初期） | 数千の OSS ライブラリ | なし | Google 製品群 | なし |
| **カスタマイズ** | CSS セレクタで汎用設定可能 | 不可 | 不可 | 不可 | Apidog 内で定義 |
| **コンテキスト効率** | 高い（必要な情報のみ返す） | 高い | 低い（ページ全文） | 中程度 | 高い |
| **外部依存** | なし（ローカル完結） | Upstash クラウド | なし | Google API | Apidog API |
| **GitHub Stars 目安** | — | ~6,000〜8,000 | ~15,000（モノレポ） | ~100〜200 | ~500〜1,500 |

### 6.2 本プロジェクトのポジショニング

```
          カスタマイズ性 高い
               ▲
               │
    本プロジェクト ●
               │          ● Apidog MCP
               │            (API 特化だが Apidog 依存)
               │
    ● fetch MCP │
    (任意URLだが│構造化なし)
               │
               │         ● Context7
               │           (充実したコーパスだがクローズド)
               │
               ├──────────────────────────▶ コーパス規模
               │
               │  ● Google Dev Knowledge MCP
               │    (Google 限定)
               │
          カスタマイズ性 低い
```

**差別化のコアバリュー**:
1. **「任意のサイト」を「構造化して」提供**: fetch MCP の柔軟性と Context7 の構造化を両立
2. **日本の SaaS API にフォーカス**: kintone, Backlog など、英語圏のツールがカバーしないニッチ
3. **ローカル完結**: クラウドサービスへの依存なし。機密性の高い社内 API ドキュメントにも対応可能

---

## 7. リスクと対策

### 7.1 対象サイトの構造変更への対応

| リスク | 影響 | 対策 |
|---|---|---|
| HTML 構造の変更（CSS クラス名、DOM 構造） | プリセットパーサーが動作しなくなる | テストに HTML スナップショットを使用し、CI でパーサーの動作を検証。構造変更を検知したら Issue を自動作成 |
| URL 構造の変更 | クロール対象ページの発見に失敗 | `includePatterns` を広めに設定。404 レスポンスを検知してログ出力 |
| サイトのリニューアル | 全面的なパーサー書き直し | プリセットパーサーをモジュール化し、影響範囲を限定。汎用パーサーをフォールバックとして用意 |

**軽減策の具体的実装**:
- パーサーのテストは実際の HTML をスナップショットとしてリポジトリに含め、実サイトに依存しないユニットテストを作成
- パーサーの出力に `confidence` スコアを付与し、構造化に失敗した場合はフォールバック（生テキスト抽出）に切り替え

### 7.2 クロール頻度とサイトへの負荷

| リスク | 影響 | 対策 |
|---|---|---|
| 過度なクロールによるサイト負荷 | 対象サイトの運営者からのブロック・苦情 | `delayMs` のデフォルトを 1000ms に設定。`robots.txt` を尊重 |
| 大量ユーザーによる同時クロール | 対象サイトへの DDoS 的な負荷 | キャッシュのデフォルト有効期限を 7 日に設定。プリセットには推奨 `delayMs` を明記 |

**具体的な実装**:
- `robots.txt` のパース: クロール前に `robots.txt` を取得し、`Disallow` パスを除外
- User-Agent: `mcp-api-reference/x.x.x (+https://github.com/{user}/mcp-api-reference)` を設定
- レート制限: `delayMs` 設定を厳守し、並列リクエストは行わない（逐次処理）

### 7.3 ドキュメントの著作権・利用規約への配慮

| リスク | 影響 | 対策 |
|---|---|---|
| ドキュメントの著作権侵害 | 法的問題 | コンテンツの**キャッシュはローカルのみ**。再配布なし。プリセットには元サイトの利用規約を確認した結果を記載 |
| 利用規約でのクロール禁止 | プリセットの提供不可 | プリセット追加時に利用規約を確認するチェックリストを CONTRIBUTING.md に明記 |
| 商用利用の制限 | MIT ライセンスとの矛盾 | ツール自体は MIT。コンテンツの権利はそれぞれの提供元に帰属する旨を README に明記 |

**留意事項**:
- kintone (cybozu.dev): Cybozu Developer Network は開発者向けに公開されたドキュメント。API ドキュメントの参照・利用は開発者向けに想定されている
- Backlog (developer.nulab.com): Nulab Developer API は開発者向け公開ドキュメント。利用規約を確認の上、プリセット提供
- README に「本ツールはドキュメントの参照を効率化するもので、コンテンツの再配布を目的としない」旨を明記

---

## 8. 評価指標（ポートフォリオとしての成功基準）

### 8.1 定量目標

| 指標 | 3ヶ月目標 | 6ヶ月目標 | 1年目標 |
|---|---|---|---|
| GitHub Stars | 50 | 200 | 500 |
| npm 週間ダウンロード数 | 50 | 200 | 1,000 |
| コントリビューター数 | 1（自分） | 3 | 10 |
| ビルトインプリセット数 | 2 | 5 | 10 |
| Issue / PR 対応 | — | 平均 3 日以内に初回レスポンス | 同左 |

### 8.2 定性目標

- **技術ブログ記事**: 開発過程を記事化し、Zenn / Qiita で公開（最低 2 本）
- **LT/登壇**: MCP 関連の勉強会で発表（1 回以上）
- **Claude Code 公式コミュニティへの紹介**: MCP サーバー一覧への掲載を目指す

### 8.3 技術的なアピールポイント

| ポイント | 説明 |
|---|---|
| MCP プロトコルの実践的実装 | 公式 SDK を使った stdio サーバーの構築、ツール設計のベストプラクティス |
| HTML パーシング & 構造化 | 多様なサイト構造を統一的なデータモデルに変換するパーサー設計 |
| 検索エンジン設計 | 日本語対応の全文検索、フィールド重み付け、将来のセマンティック検索への拡張性 |
| DX（開発者体験）設計 | `npx` 一発起動、プリセットによるゼロコンフィグ、LLM フレンドリーなレスポンス設計 |
| OSS 運営 | CI/CD、コントリビューションガイド、Issue/PR テンプレート、多言語 README |
| 実用的な課題解決 | 「LLM のハルシネーション」という実際の課題に対する具体的なソリューション |

---

## 付録 A: kintone サイト構造の調査結果

### インデックスページ（/ja/kintone/docs/rest-api/）
- アコーディオン型サイドバーナビゲーション
- カテゴリ: Records, Files, Apps, Spaces, Plugins, API Info
- 各エンドポイントへのリンクはアイコン（`icon_document_kintone.svg`）付き
- 約 85〜90 エンドポイント

### 個別エンドポイントページの構造
- **H1**: エンドポイント名（日本語）
- **仕様テーブル**: HTTP メソッド、URL、認証方式、Content-Type
- **パラメータテーブル**: 4 列（パラメーター名 / 型 / 必須 / 説明）
- **レスポンステーブル**: 3 列（プロパティ名 / 型 / 説明）
- **コード例**: アコーディオン内にプレーンテキスト、JSON、JavaScript、curl の例
- **補足事項**: 箇条書きリスト

### URL パターン
- 一般: `https://cybozu.dev/ja/kintone/docs/rest-api/{category}/{endpoint-name}/`
- API パス: `/k/v1/{resource}.json`
- プレビュー環境: `/k/v1/preview/{resource}.json`

## 付録 B: Backlog サイト構造の調査結果

### インデックスページ（/ja/docs/backlog/）
- Astro フレームワークで構築された静的サイト
- `#markdownNavigation` 内のネスト `<ul>` でカテゴリ構造を表現
- 約 150 以上のエンドポイント
- カテゴリ: Space, Users, Projects, Issues, Wiki, Git, Teams 等

### 個別エンドポイントページの構造
- **H1**: エンドポイント名（日本語）
- **メソッド + パス**: テキストまたはコードブロックで `GET /api/v2/issues/:issueIdOrKey` 形式
- **H3 セクション**: 実行可能な権限、URL パラメーター、リクエストパラメーター、リクエストの例、レスポンス例、エラーレスポンス
- **パラメータテーブル**: 3 列（パラメータ名 / 型 / 内容）
- **配列パラメータ**: `categoryId[]` 記法
- **リクエスト例**: curl コマンド（form-urlencoded）
- **レスポンス例**: HTTP ステータス + JSON

### URL パターン
- 個別ページ: `/ja/docs/backlog/api/2/{endpoint-name}/`
- エンドポイント名はハイフン区切りの英語小文字（例: `get-issue`, `add-issue`）
- API パス: `/api/v2/{resource}`
