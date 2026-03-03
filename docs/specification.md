# 詳細仕様書: mcp-api-reference

> **Version**: 1.0.0
> **作成日**: 2026-03-01
> **前提ドキュメント**: [docs/requirements.md](./requirements.md)

---

## 目次

1. [モジュール構成と依存関係](#1-モジュール構成と依存関係)
2. [エントリポイントと起動シーケンス](#2-エントリポイントと起動シーケンス)
3. [MCP サーバー・ツール層](#3-mcp-サーバーツール層)
4. [クローラーモジュール](#4-クローラーモジュール)
5. [パーサーモジュール](#5-パーサーモジュール)
6. [インデクサーモジュール](#6-インデクサーモジュール)
7. [ドキュメントストア](#7-ドキュメントストア)
8. [キャッシュマネージャー](#8-キャッシュマネージャー)
9. [レスポンスフォーマッター](#9-レスポンスフォーマッター)
10. [プリセット仕様](#10-プリセット仕様)
11. [設定とバリデーション](#11-設定とバリデーション)
12. [エラーハンドリング](#12-エラーハンドリング)
13. [ロギング](#13-ロギング)
14. [テスト戦略](#14-テスト戦略)
15. [ビルド・パッケージング・CI/CD](#15-ビルドパッケージングcicd)
16. [package.json 定義](#16-packagejson-定義)

---

## 1. モジュール構成と依存関係

### 1.1 モジュール依存関係図

```
src/index.ts
  └─► src/server.ts
        ├─► src/tools/search-docs.ts
        │     ├─► src/core/indexer.ts
        │     └─► src/formatters/response.ts
        ├─► src/tools/get-endpoint.ts
        │     ├─► src/core/store.ts
        │     └─► src/formatters/response.ts
        ├─► src/tools/list-apis.ts
        │     ├─► src/core/store.ts
        │     └─► src/formatters/response.ts
        └─► src/core/cache.ts
              ├─► src/core/crawler.ts
              │     └─► (external: undici / node:fetch)
              ├─► src/core/parser.ts
              │     ├─► src/presets/kintone/parser.ts
              │     ├─► src/presets/backlog/parser.ts
              │     └─► (external: cheerio)
              ├─► src/core/indexer.ts
              │     └─► (external: minisearch)
              └─► src/core/store.ts
                    └─► (external: node:fs/promises)
```

### 1.2 各モジュールの責務

| モジュール | ファイル | 責務 |
|---|---|---|
| EntryPoint | `src/index.ts` | CLI 引数パース、プロセス起動 |
| Server | `src/server.ts` | McpServer インスタンス生成、ツール登録、初期化オーケストレーション |
| SearchDocs | `src/tools/search-docs.ts` | `search_docs` ツールのハンドラ |
| GetEndpoint | `src/tools/get-endpoint.ts` | `get_endpoint` ツールのハンドラ |
| ListApis | `src/tools/list-apis.ts` | `list_apis` ツールのハンドラ |
| Crawler | `src/core/crawler.ts` | HTTP リクエスト、リンク収集、robots.txt 解釈 |
| Parser | `src/core/parser.ts` | パーサーインターフェース定義、汎用パーサー実装、パーサー解決 |
| Indexer | `src/core/indexer.ts` | MiniSearch インデックスの構築・検索・シリアライズ |
| Store | `src/core/store.ts` | EndpointDocument のメモリ保持とディスク永続化 |
| Cache | `src/core/cache.ts` | キャッシュ有効期限管理、クロール→パース→インデックスのパイプライン制御 |
| ResponseFormatter | `src/formatters/response.ts` | EndpointDocument → MCP レスポンステキスト変換 |
| PresetRegistry | `src/presets/index.ts` | ビルトインプリセット設定の一覧管理 |
| KintoneParser | `src/presets/kintone/parser.ts` | kintone 固有の HTML → EndpointDocument 変換 |
| BacklogParser | `src/presets/backlog/parser.ts` | Backlog 固有の HTML → EndpointDocument 変換 |
| Types | `src/types/*.ts` | 共有型定義 |

---

## 2. エントリポイントと起動シーケンス

### 2.1 `src/index.ts`

```typescript
#!/usr/bin/env node

import { parseArgs } from "node:util";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      refresh: { type: "string", short: "r" },
      "clear-cache": { type: "boolean" },
      config: { type: "string", short: "c" },
    },
    allowPositionals: false,
  });

  if (values["clear-cache"]) {
    await clearAllCache();
    console.error("[mcp-api-reference] Cache cleared.");
    process.exit(0);
  }

  const server = await createServer({
    refreshTarget: values.refresh as string | undefined,
    configPath: values.config as string | undefined,
  });

  await server.start();
}

main().catch((err) => {
  console.error("[mcp-api-reference] Fatal:", err);
  process.exit(1);
});
```

**仕様**:
- `node:util` の `parseArgs` を使用（外部依存なし）
- shebang 付きで `npx` 実行に対応
- `--clear-cache` は即時終了。MCP サーバーとしては起動しない
- すべてのログは `console.error`（stderr）に出力。stdout は MCP プロトコル専用

### 2.2 起動シーケンス図

```
main()
  │
  ├── parseArgs()
  │
  ├── createServer(options)
  │     │
  │     ├── loadPresets()
  │     │     └── 全ビルトインプリセットの PresetConfig を収集
  │     │
  │     ├── loadCustomSites(configPath | ENV)
  │     │     └── custom-sites.json をパースし SiteConfig[] を返す
  │     │
  │     ├── mergedConfigs = [...presets, ...customSites]
  │     │
  │     ├── for each config:
  │     │     ├── cacheManager.isCacheValid(config)
  │     │     │     ├── true  → store.loadFromDisk(config.id)
  │     │     │     │           indexer.loadFromDisk(config.id)
  │     │     │     └── false → pipeline.run(config)
  │     │     │                   ├── crawler.crawl(config.crawl)
  │     │     │                   ├── parser.parseAll(html[], config.parser)
  │     │     │                   ├── store.set(config.id, documents)
  │     │     │                   ├── indexer.build(config.id, documents)
  │     │     │                   └── cacheManager.save(config.id)
  │     │     └── (refreshTarget 指定時は該当 API のみ強制再クロール)
  │     │
  │     ├── registerTools(mcpServer, { indexer, store })
  │     │
  │     └── return server
  │
  └── server.start()
        └── new StdioServerTransport() → mcpServer.connect(transport)
```

### 2.3 `src/server.ts` のインターフェース

```typescript
interface ServerOptions {
  refreshTarget?: string;
  configPath?: string;
}

interface ServerContext {
  indexer: Indexer;
  store: DocumentStore;
  configs: SiteConfig[];
}

/** McpServer を生成し、全サイトの初期化を完了した状態で返す */
export async function createServer(options: ServerOptions): Promise<{
  start: () => Promise<void>;
}>;
```

---

## 3. MCP サーバー・ツール層

### 3.1 McpServer の構成

```typescript
// src/server.ts 内部
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const mcpServer = new McpServer({
  name: "mcp-api-reference",
  version: packageVersion, // package.json から読み取り
});
```

### 3.2 `search_docs` ツール仕様

#### 入力バリデーション

```typescript
// Zod スキーマ
{
  query: z.string()
    .min(1, "query must not be empty")
    .max(200, "query must be 200 characters or less"),
  api: z.string().optional(),
  limit: z.number().int().min(1).max(20).default(5),
}
```

#### 処理フロー

```
search_docs(query, api?, limit?)
  │
  ├── api が指定されていれば、その API のインデックスのみ検索
  │   api が未指定なら、全 API のインデックスを統合検索
  │
  ├── indexer.search(query, { apiId?, limit })
  │     │
  │     ├── MiniSearch.search(query, options)
  │     │     options = {
  │     │       filter: apiId ? (result) => result.apiId === apiId : undefined,
  │     │       boost: { title: 3, path: 2, parameterNames: 1.5 },
  │     │       fuzzy: 0.2,
  │     │       prefix: true,
  │     │     }
  │     │
  │     └── return SearchResult[]
  │
  ├── 各 SearchResult について store から概要情報を取得
  │     ├── method, path, title
  │     └── parameters の name + type + required のみ（1行要約）
  │
  └── responseFormatter.formatSearchResults(results)
        └── テキスト形式の MCP レスポンスを生成
```

#### 検索結果が 0 件の場合

```typescript
// isError ではなく通常レスポンスとして返す（LLM が次の行動を判断できるように）
{
  content: [{
    type: "text",
    text: `No results found for "${query}"${api ? ` in ${api} API` : ""}.

Suggestions:
- Try different keywords (e.g., Japanese: "レコード", English: "record")
- Use list_apis() to see available APIs
- Check spelling or try broader terms`
  }]
}
```

### 3.3 `get_endpoint` ツール仕様

#### 入力バリデーション

```typescript
{
  api: z.string().min(1),
  endpoint: z.string().min(1),
  method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]),
}
```

#### 処理フロー

```
get_endpoint(api, endpoint, method)
  │
  ├── documentId = `${api}:${method}:${endpoint}`
  │
  ├── doc = store.get(documentId)
  │     │
  │     ├── found → responseFormatter.formatEndpointDetail(doc)
  │     │
  │     └── not found → エンドポイントのあいまい検索を試みる
  │           │
  │           ├── store.findSimilar(api, endpoint)
  │           │     パス末尾一致 or 部分一致で候補を検索
  │           │
  │           ├── 候補あり → 候補リストをサジェスト
  │           └── 候補なし → エラーレスポンス
  │
  └── return MCP response
```

#### あいまいマッチングのロジック

```typescript
function findSimilar(
  apiId: string,
  endpoint: string
): EndpointDocument[] {
  const docs = this.getByApi(apiId);
  const normalizedInput = endpoint.toLowerCase().replace(/^\//, "");

  return docs
    .filter((doc) => {
      const normalizedPath = doc.path.toLowerCase().replace(/^\//, "");
      // 末尾一致: "/record.json" → "record.json"
      if (normalizedPath.endsWith(normalizedInput)) return true;
      // 部分一致: "record" → "/k/v1/record.json"
      if (normalizedPath.includes(normalizedInput)) return true;
      return false;
    })
    .slice(0, 5);
}
```

#### エンドポイント未検出時のレスポンス

```
Endpoint not found: GET /k/v1/reccord.json in kintone API.

Did you mean:
- GET  /k/v1/record.json — レコードを取得する
- POST /k/v1/record.json — レコードを登録する
- PUT  /k/v1/record.json — レコードを更新する

Use search_docs("record", "kintone") to search by keyword.
```

### 3.4 `list_apis` ツール仕様

#### 入力バリデーション

```typescript
{
  api: z.string().optional(),
}
```

#### 処理フロー

```
list_apis(api?)
  │
  ├── api 未指定
  │     └── store.getAllApiSummaries()
  │           各 API について:
  │             - id, name, description
  │             - endpointCount
  │             - categories (名前のみ)
  │             - sourceUrl
  │             - lastUpdated (meta.crawledAt)
  │
  ├── api 指定（存在する）
  │     └── store.getApiDetail(api)
  │           - カテゴリごとにエンドポイントをグループ化
  │           - カテゴリあたり最大 10 件表示
  │           - 10 件を超えるカテゴリは件数のみ表示し search_docs を案内
  │
  └── api 指定（存在しない）
        └── エラーレスポンス + 利用可能な API 一覧を付与
```

#### カテゴリ内エンドポイント表示の打ち切り仕様

```typescript
const MAX_ENDPOINTS_PER_CATEGORY = 10;
const MAX_TOTAL_ENDPOINTS_IN_LIST = 50;

// カテゴリ内の表示:
// - 10件以下: 全件表示
// - 11件以上: 先頭10件 + "... and N more (use search_docs to find)"
//
// 全体の表示:
// - 50件を超えた時点で残りのカテゴリは件数サマリーのみ
```

---

## 4. クローラーモジュール

### 4.1 インターフェース定義

```typescript
// src/core/crawler.ts

interface CrawlConfig {
  startUrl: string;
  includePatterns: string[];
  excludePatterns: string[];
  maxPages: number;
  delayMs: number;
}

interface CrawlResult {
  /** URL → HTML 文字列のマップ */
  pages: Map<string, string>;
  /** クロール統計 */
  stats: CrawlStats;
}

interface CrawlStats {
  totalRequests: number;
  successCount: number;
  errorCount: number;
  skippedCount: number;
  durationMs: number;
}

interface CrawlProgress {
  current: number;
  total: number;
  url: string;
}

export class Crawler {
  constructor(private userAgent: string);

  /** サイトをクロールし、全ページの HTML を返す */
  async crawl(
    config: CrawlConfig,
    onProgress?: (progress: CrawlProgress) => void
  ): Promise<CrawlResult>;
}
```

### 4.2 クロール処理の詳細フロー

```
crawl(config)
  │
  ├── 1. robots.txt の取得と解析
  │     url = new URL(config.startUrl).origin + "/robots.txt"
  │     fetch(url) → パース → disallowedPaths: Set<string>
  │     ※ 取得失敗時は空セット（制限なしとして扱う）
  │
  ├── 2. URL キューの初期化
  │     queue = [config.startUrl]
  │     visited = new Set<string>()
  │     pages = new Map<string, string>()
  │
  ├── 3. キュー処理ループ
  │     while (queue.length > 0 && pages.size < config.maxPages):
  │       │
  │       ├── url = queue.shift()
  │       │
  │       ├── skip if: visited.has(url)
  │       ├── skip if: !matchesInclude(url, config.includePatterns)
  │       ├── skip if: matchesExclude(url, config.excludePatterns)
  │       ├── skip if: isDisallowed(url, disallowedPaths)
  │       │
  │       ├── visited.add(url)
  │       │
  │       ├── html = await fetchPage(url)
  │       │     timeout: 30秒
  │       │     リトライ: 最大 2 回（5xx or ネットワークエラー時）
  │       │     リトライ間隔: 3 秒
  │       │
  │       ├── pages.set(url, html)
  │       │
  │       ├── links = extractLinks(html, url)
  │       │     <a href="..."> を全収集
  │       │     相対 URL を絶対 URL に変換
  │       │     フラグメント (#) を除去
  │       │     重複を排除
  │       │
  │       ├── for link of links:
  │       │     if !visited.has(link) && matchesInclude(link):
  │       │       queue.push(link)
  │       │
  │       ├── onProgress?.({ current: pages.size, total: config.maxPages, url })
  │       │
  │       └── await delay(config.delayMs)
  │
  └── 4. return { pages, stats }
```

### 4.3 URL パターンマッチング

```typescript
import { minimatch } from "minimatch"; // ← ライブラリ不使用、自前実装

/**
 * glob パターンを正規表現に変換する簡易実装。
 * サポートするパターン:
 *   - `*`   → 1 セグメント内の任意文字列
 *   - `**`  → 複数セグメントにまたがる任意文字列
 *   - リテラル文字列
 *
 * 外部ライブラリを使わず、最小限の glob 対応で十分。
 */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function matchesInclude(url: string, patterns: string[]): boolean {
  return patterns.some((p) => globToRegex(p).test(url));
}

function matchesExclude(url: string, patterns: string[]): boolean {
  return patterns.some((p) => globToRegex(p).test(url));
}
```

### 4.4 robots.txt パーサー

```typescript
interface RobotsRule {
  userAgent: string;
  disallow: string[];
  allow: string[];
  crawlDelay?: number;
}

/**
 * 簡易 robots.txt パーサー。
 * User-Agent: * と User-Agent: mcp-api-reference のルールのみ参照。
 * 複雑なワイルドカードパターン（$, *）は非対応（将来拡張）。
 */
function parseRobotsTxt(content: string): RobotsRule[];

function isDisallowed(url: string, rules: RobotsRule[]): boolean;
```

### 4.5 HTTP リクエスト仕様

| 項目 | 値 |
|---|---|
| User-Agent | `mcp-api-reference/{version} (+https://github.com/{user}/mcp-api-reference)` |
| Accept | `text/html,application/xhtml+xml` |
| Accept-Language | `ja,en;q=0.9` |
| タイムアウト | 30,000 ms |
| リダイレクト | 最大 5 回まで自動追従 |
| リトライ | 最大 2 回（5xx / ECONNRESET / ETIMEDOUT のみ） |
| リトライ間隔 | 3,000 ms（固定） |
| 同時接続数 | 1（逐次処理） |
| Cookie | 送信しない |
| カスタムヘッダー | 環境変数 `MCP_API_REF_HEADERS_{API_ID}` で追加可能 |

---

## 5. パーサーモジュール

### 5.1 パーサーインターフェース

```typescript
// src/core/parser.ts

import type { CheerioAPI } from "cheerio";

/**
 * 1 ページの HTML から 0 個以上の EndpointDocument を抽出するパーサー。
 * 1 ページに複数のエンドポイントが記載されている場合（一覧ページなど）も対応。
 */
interface SiteParser {
  /** パーサーの識別名（ログ用） */
  readonly name: string;

  /**
   * インデックスページ（一覧ページ）から、
   * クロール対象の個別ページ URL を抽出する。
   * クローラーのリンク収集と併用されるが、
   * パーサーがより精度の高いリンクリストを提供できる場合に使用。
   */
  extractEndpointUrls?(
    $: CheerioAPI,
    pageUrl: string
  ): EndpointUrl[];

  /**
   * 個別ページの HTML から EndpointDocument を抽出する。
   * 1 ページ 1 エンドポイントが基本だが、
   * 複数返すことも可能（同一パスで GET/POST が同一ページに記載される場合など）。
   */
  parseEndpoint(
    $: CheerioAPI,
    pageUrl: string,
    apiId: string
  ): ParseResult;
}

interface EndpointUrl {
  url: string;
  category?: string;
}

interface ParseResult {
  /** パース成功時のドキュメント */
  documents: EndpointDocument[];
  /** パースの確信度（0.0〜1.0） */
  confidence: number;
  /** パース時の警告 */
  warnings: string[];
}
```

### 5.2 汎用パーサー（GenericParser）

```typescript
// src/core/parser.ts

class GenericParser implements SiteParser {
  readonly name = "generic";

  constructor(private selectors: GenericParserSelectors) {}

  parseEndpoint($: CheerioAPI, pageUrl: string, apiId: string): ParseResult {
    const warnings: string[] = [];

    // 1. 除外要素を削除
    for (const sel of this.selectors.excludeSelectors) {
      $(sel).remove();
    }

    // 2. メインコンテンツ領域を特定
    const $content = $(this.selectors.contentSelector).first();
    if ($content.length === 0) {
      return { documents: [], confidence: 0, warnings: ["Content area not found"] };
    }

    // 3. タイトル抽出
    const title = $content.find(this.selectors.titleSelector).first().text().trim();

    // 4. エンドポイント（メソッド + パス）抽出
    const endpointText = $content.find(this.selectors.endpointSelector).first().text().trim();
    const { method, path } = this.parseMethodAndPath(endpointText);

    // 5. パラメータテーブル抽出
    const parameters = this.parseParameterTable(
      $content.find(this.selectors.parameterTableSelector)
    );

    // 6. コードブロック抽出
    const examples = this.parseCodeBlocks(
      $content.find(this.selectors.codeBlockSelector)
    );

    // 7. 説明文抽出（最初の段落）
    const description = $content.find("p").first().text().trim().slice(0, 500);

    // 8. confidence の計算
    let confidence = 0;
    if (title) confidence += 0.2;
    if (method && path) confidence += 0.4;
    if (parameters.length > 0) confidence += 0.2;
    if (examples.length > 0) confidence += 0.2;

    if (!method || !path) {
      warnings.push("Could not extract HTTP method and path");
      return { documents: [], confidence, warnings };
    }

    const doc: EndpointDocument = {
      id: `${apiId}:${method}:${path}`,
      apiId,
      category: "General",
      method: method as EndpointDocument["method"],
      path,
      title: title || `${method} ${path}`,
      description,
      parameters,
      responseFields: [],
      examples,
      authentication: [],
      permissions: [],
      notes: [],
      sourceUrl: pageUrl,
    };

    return { documents: [doc], confidence, warnings };
  }

  /**
   * "GET /api/v2/issues" や "POST https://example.com/k/v1/record.json"
   * のようなテキストからメソッドとパスを分離する。
   */
  private parseMethodAndPath(text: string): { method: string; path: string } {
    // パターン1: "GET /api/v2/issues"
    const match1 = text.match(
      /\b(GET|POST|PUT|DELETE|PATCH)\s+(\/\S+)/i
    );
    if (match1) {
      return { method: match1[1].toUpperCase(), path: match1[2] };
    }

    // パターン2: "GET https://example.com/path"
    const match2 = text.match(
      /\b(GET|POST|PUT|DELETE|PATCH)\s+https?:\/\/[^/\s]+(\/\S+)/i
    );
    if (match2) {
      return { method: match2[1].toUpperCase(), path: match2[2] };
    }

    return { method: "", path: "" };
  }

  /**
   * HTML テーブルからパラメータ情報を抽出する。
   * 列の特定はヘッダー行のテキストから推測する。
   */
  private parseParameterTable(
    $tables: cheerio.Cheerio
  ): ParameterInfo[] {
    const results: ParameterInfo[] = [];

    $tables.each((_, table) => {
      const $table = $(table);
      const headers = $table
        .find("thead th, tr:first-child th, tr:first-child td")
        .map((_, el) => $(el).text().trim().toLowerCase())
        .get();

      // ヘッダーからカラムインデックスを推測
      const nameCol = headers.findIndex((h) =>
        /name|名|パラメータ/.test(h)
      );
      const typeCol = headers.findIndex((h) =>
        /type|型/.test(h)
      );
      const requiredCol = headers.findIndex((h) =>
        /required|必須/.test(h)
      );
      const descCol = headers.findIndex((h) =>
        /desc|説明|内容|content/.test(h)
      );

      if (nameCol === -1) return; // パラメータテーブルではない

      $table.find("tbody tr, tr:not(:first-child)").each((_, row) => {
        const cells = $(row).find("td").map((_, el) => $(el).text().trim()).get();
        if (cells.length === 0) return;

        results.push({
          name: cells[nameCol] || "",
          type: typeCol >= 0 ? cells[typeCol] || "string" : "string",
          required: requiredCol >= 0
            ? /必須|required|yes|true/i.test(cells[requiredCol] || "")
            : false,
          description: descCol >= 0 ? cells[descCol] || "" : "",
        });
      });
    });

    return results;
  }

  private parseCodeBlocks(
    $blocks: cheerio.Cheerio
  ): ExampleInfo[] {
    const examples: ExampleInfo[] = [];

    $blocks.each((_, el) => {
      const content = $(el).text().trim();
      if (!content) return;

      // JSON かどうか判定
      const isJson = content.startsWith("{") || content.startsWith("[");
      // curl かどうか判定
      const isCurl = content.toLowerCase().startsWith("curl");

      let type: ExampleInfo["type"] = "request";
      let format: ExampleInfo["format"] = "json";

      if (isJson) {
        // レスポンスの JSON は直前に "レスポンス" / "response" がある場合
        format = "json";
        // ヒューリスティック: id フィールドがあればレスポンス
        type = /"id"\s*:/.test(content) ? "response" : "request";
      } else if (isCurl) {
        format = "curl";
        type = "request";
      } else {
        format = "url";
        type = "request";
      }

      examples.push({ type, format, content: content.slice(0, 2000) });
    });

    return examples;
  }
}
```

### 5.3 パーサー解決ロジック

```typescript
// src/core/parser.ts

function resolveParser(config: SiteConfig): SiteParser {
  if (config.parser.type === "preset" && config.parser.parserModule) {
    // プリセットパーサーをレジストリから取得
    const preset = presetRegistry.getParser(config.id);
    if (!preset) {
      throw new Error(`Preset parser not found for: ${config.id}`);
    }
    return preset;
  }

  if (config.parser.type === "generic" && config.parser.selectors) {
    return new GenericParser(config.parser.selectors);
  }

  // フォールバック: デフォルトセレクタで汎用パーサー
  return new GenericParser({
    contentSelector: "main, article, [role='main'], .content, #content",
    titleSelector: "h1",
    endpointSelector: "code, pre, .endpoint, .api-method",
    parameterTableSelector: "table",
    codeBlockSelector: "pre code, .highlight code",
    excludeSelectors: [
      "nav", "footer", "header",
      ".sidebar", ".nav", ".breadcrumb",
      ".toc", ".table-of-contents",
      "[role='navigation']",
    ],
  });
}
```

### 5.4 kintone 専用パーサーの詳細仕様

```typescript
// src/presets/kintone/parser.ts

class KintoneParser implements SiteParser {
  readonly name = "kintone";

  extractEndpointUrls($: CheerioAPI, pageUrl: string): EndpointUrl[] {
    // サイドバーのアコーディオンナビゲーションからリンクを収集
    const urls: EndpointUrl[] = [];
    let currentCategory = "";

    // カテゴリの特定: アコーディオントグルの直前テキスト
    $("a").each((_, el) => {
      const $el = $(el);
      const href = $el.attr("href");
      if (!href) return;

      // カテゴリヘッダーの検出（アコーディオントグルアイコンの隣接テキスト）
      const $parent = $el.closest("li");
      const toggleImg = $parent.find(
        'img[src*="icon_accordion_toggle"]'
      );
      if (toggleImg.length > 0) {
        currentCategory = $parent.children().first().text().trim();
        return;
      }

      // ドキュメントページリンクの検出
      const docIcon = $el.find('img[src*="icon_document"]');
      if (docIcon.length > 0 || href.includes("/rest-api/")) {
        const absoluteUrl = new URL(href, pageUrl).toString();
        if (absoluteUrl.includes("/rest-api/") && absoluteUrl !== pageUrl) {
          urls.push({ url: absoluteUrl, category: currentCategory });
        }
      }
    });

    return urls;
  }

  parseEndpoint(
    $: CheerioAPI,
    pageUrl: string,
    apiId: string
  ): ParseResult {
    const warnings: string[] = [];

    // === 1. タイトル ===
    const title = $("h1").first().text().trim();
    if (!title) {
      warnings.push("Title (h1) not found");
    }

    // === 2. 仕様テーブル（HTTP メソッド、URL、認証） ===
    const specTable = this.parseSpecTable($);

    if (!specTable.method || !specTable.path) {
      warnings.push("Spec table (method/path) not found");
      return { documents: [], confidence: 0.1, warnings };
    }

    // === 3. パラメータテーブル ===
    // kintone の場合、「パラメーター名」「型」「必須」「説明」の 4 列
    const parameters = this.parseKintoneParamTable($);

    // === 4. レスポンステーブル ===
    // 「プロパティ名」「型」「説明」の 3 列
    const responseFields = this.parseKintoneResponseTable($);

    // === 5. コード例 ===
    const examples = this.parseKintoneExamples($);

    // === 6. 必要な権限 ===
    const permissions = this.parsePermissions($);

    // === 7. 補足事項 ===
    const notes = this.parseNotes($);

    // === 8. confidence 算出 ===
    let confidence = 0;
    if (title) confidence += 0.15;
    if (specTable.method && specTable.path) confidence += 0.35;
    if (parameters.length > 0) confidence += 0.2;
    if (responseFields.length > 0) confidence += 0.1;
    if (examples.length > 0) confidence += 0.1;
    if (permissions.length > 0) confidence += 0.05;
    if (notes.length > 0) confidence += 0.05;

    const doc: EndpointDocument = {
      id: `${apiId}:${specTable.method}:${specTable.path}`,
      apiId,
      category: "", // 呼び出し元が extractEndpointUrls の結果から補完
      method: specTable.method as EndpointDocument["method"],
      path: specTable.path,
      title,
      description: this.extractDescription($),
      parameters,
      responseFields,
      examples,
      authentication: specTable.authentication,
      permissions,
      notes,
      sourceUrl: pageUrl,
    };

    return { documents: [doc], confidence, warnings };
  }

  /** 仕様テーブル（HTTP メソッド / URL / 認証）のパース */
  private parseSpecTable($: CheerioAPI): {
    method: string;
    path: string;
    authentication: string[];
  } {
    let method = "";
    let path = "";
    const authentication: string[] = [];

    // kintone の仕様テーブルは最初の <table> で
    // 各行が「ラベル | 値」の 2 列構成
    $("table").first().find("tr").each((_, row) => {
      const cells = $(row).find("td, th");
      if (cells.length < 2) return;

      const label = $(cells[0]).text().trim();
      const value = $(cells[1]).text().trim();

      if (/HTTPメソッド/i.test(label)) {
        method = value.toUpperCase();
      }
      if (/^URL$/i.test(label) && !label.includes("ゲスト")) {
        // URL から API パスを抽出
        // "https://sample.cybozu.com/k/v1/record.json" → "/k/v1/record.json"
        const urlMatch = value.match(/cybozu\.com(\/k\/.*)/);
        if (urlMatch) {
          path = urlMatch[1];
        }
      }
      if (/認証/i.test(label)) {
        // 認証方式をカンマ or リンクで分割
        authentication.push(
          ...value.split(/[,、]/).map((s) => s.trim()).filter(Boolean)
        );
      }
    });

    return { method, path, authentication };
  }

  /** パラメータテーブルのパース（4 列: パラメーター名 / 型 / 必須 / 説明） */
  private parseKintoneParamTable($: CheerioAPI): ParameterInfo[] {
    const params: ParameterInfo[] = [];

    $("table").each((_, table) => {
      const $table = $(table);
      const headerText = $table.find("tr:first-child").text();

      // パラメータテーブルの判定: 「パラメーター名」列の存在
      if (!/パラメーター名/.test(headerText)) return;

      $table.find("tr").slice(1).each((_, row) => {
        const cells = $(row).find("td");
        if (cells.length < 4) return;

        const name = $(cells[0]).text().trim();
        const type = this.normalizeType($(cells[1]).text().trim());
        const requiredText = $(cells[2]).text().trim();
        const description = $(cells[3]).text().trim();

        if (!name) return;

        params.push({
          name,
          type,
          required: /必須/.test(requiredText),
          description: description.slice(0, 300),
        });
      });
    });

    return params;
  }

  /** レスポンステーブルのパース（3 列: プロパティ名 / 型 / 説明） */
  private parseKintoneResponseTable($: CheerioAPI): FieldInfo[] {
    const fields: FieldInfo[] = [];

    $("table").each((_, table) => {
      const $table = $(table);
      const headerText = $table.find("tr:first-child").text();

      // レスポンステーブルの判定: 「プロパティ名」列の存在
      if (!/プロパティ名/.test(headerText)) return;

      $table.find("tr").slice(1).each((_, row) => {
        const cells = $(row).find("td");
        if (cells.length < 3) return;

        fields.push({
          name: $(cells[0]).text().trim(),
          type: this.normalizeType($(cells[1]).text().trim()),
          description: $(cells[2]).text().trim().slice(0, 300),
        });
      });
    });

    return fields;
  }

  /** kintone の型名を正規化する */
  private normalizeType(raw: string): string {
    const map: Record<string, string> = {
      "数値": "number",
      "文字列": "string",
      "数値または文字列": "number | string",
      "文字列の配列": "string[]",
      "オブジェクト": "object",
      "オブジェクトの配列": "object[]",
      "真偽値": "boolean",
      "真偽値または文字列": "boolean | string",
    };
    return map[raw] || raw;
  }

  /** コード例のパース */
  private parseKintoneExamples($: CheerioAPI): ExampleInfo[] {
    const examples: ExampleInfo[] = [];

    // アコーディオン内のコードブロック
    $("pre code").each((_, el) => {
      const content = $(el).text().trim();
      if (!content || content.length < 10) return;

      // 言語の判定
      const classAttr = $(el).attr("class") || "";

      if (classAttr.includes("json") || content.startsWith("{") || content.startsWith("[")) {
        // JSON コードブロックは直前のコンテキストでリクエスト/レスポンスを判定
        const precedingText = $(el).closest("pre").prev().text().toLowerCase();
        const type: ExampleInfo["type"] =
          /レスポンス|response/.test(precedingText) ? "response" : "request";
        examples.push({ type, format: "json", content: content.slice(0, 2000) });
      } else if (/curl/i.test(content.slice(0, 20))) {
        examples.push({ type: "request", format: "curl", content: content.slice(0, 2000) });
      }
      // JavaScript コードは省略（LLM が参照する必要性が低い）
    });

    return examples;
  }

  /** 説明文の抽出（h1 直後 〜 最初のテーブルまでのテキスト） */
  private extractDescription($: CheerioAPI): string {
    const h1 = $("h1").first();
    let desc = "";
    let el = h1.next();
    while (el.length > 0 && !el.is("table") && !el.is("h2") && desc.length < 500) {
      const text = el.text().trim();
      if (text) desc += (desc ? " " : "") + text;
      el = el.next();
    }
    return desc.slice(0, 500);
  }

  /** 権限セクションのパース */
  private parsePermissions($: CheerioAPI): string[] {
    const permissions: string[] = [];
    // 「必要なアクセス権」または「権限」のセクションを探す
    $("h2, h3").each((_, heading) => {
      const text = $(heading).text().trim();
      if (!/アクセス権|権限/.test(text)) return;

      const $next = $(heading).next();
      if ($next.is("ul")) {
        $next.find("li").each((_, li) => {
          permissions.push($(li).text().trim());
        });
      } else {
        permissions.push($next.text().trim());
      }
    });
    return permissions;
  }

  /** 補足事項のパース */
  private parseNotes($: CheerioAPI): string[] {
    const notes: string[] = [];
    $("h2, h3").each((_, heading) => {
      const text = $(heading).text().trim();
      if (!/補足|注意|制限/.test(text)) return;

      const $next = $(heading).next();
      if ($next.is("ul")) {
        $next.find("li").each((_, li) => {
          notes.push($(li).text().trim().slice(0, 200));
        });
      }
    });
    return notes;
  }
}
```

### 5.5 Backlog 専用パーサーの詳細仕様

```typescript
// src/presets/backlog/parser.ts

class BacklogParser implements SiteParser {
  readonly name = "backlog";

  extractEndpointUrls($: CheerioAPI, pageUrl: string): EndpointUrl[] {
    const urls: EndpointUrl[] = [];
    let currentCategory = "";

    // #markdownNavigation 内のリンクを探索
    $("#markdownNavigation a").each((_, el) => {
      const $el = $(el);
      const href = $el.attr("href");
      if (!href) return;

      // カテゴリヘッダーは <strong> や 太字のリンク
      const isCategory = $el.find("strong").length > 0 || $el.parent().is("strong");
      if (isCategory) {
        currentCategory = $el.text().trim();
        return;
      }

      // 個別 API ページリンク: /api/2/ を含む
      if (href.includes("/api/2/")) {
        const absoluteUrl = new URL(href, pageUrl).toString();
        urls.push({ url: absoluteUrl, category: currentCategory });
      }
    });

    return urls;
  }

  parseEndpoint(
    $: CheerioAPI,
    pageUrl: string,
    apiId: string
  ): ParseResult {
    const warnings: string[] = [];

    // === 1. タイトル ===
    const title = $("h1").first().text().trim();

    // === 2. メソッド + パス ===
    // Backlog はページ冒頭のテキストまたはコードブロックに
    // "GET /api/v2/issues/:issueIdOrKey" 形式で記載
    const { method, path } = this.extractMethodAndPath($);

    if (!method || !path) {
      warnings.push("Could not extract HTTP method and path");
      return { documents: [], confidence: 0.1, warnings };
    }

    // === 3. H3 セクション分割 ===
    const sections = this.splitByH3($);

    // === 4. パラメータ ===
    const parameters = this.parseBacklogParams($, sections);

    // === 5. レスポンス ===
    const { responseFields, responseExample } = this.parseResponse($, sections);

    // === 6. 権限 ===
    const permissions = this.extractSection(sections, /実行可能な権限/);

    // === 7. リクエスト例 ===
    const requestExample = this.extractRequestExample($, sections);

    // === 8. 組み立て ===
    const examples: ExampleInfo[] = [];
    if (requestExample) {
      examples.push({ type: "request", format: "curl", content: requestExample });
    }
    if (responseExample) {
      examples.push({ type: "response", format: "json", content: responseExample });
    }

    let confidence = 0;
    if (title) confidence += 0.15;
    if (method && path) confidence += 0.35;
    if (parameters.length > 0) confidence += 0.2;
    if (responseFields.length > 0 || responseExample) confidence += 0.15;
    if (requestExample) confidence += 0.1;
    if (permissions.length > 0) confidence += 0.05;

    const doc: EndpointDocument = {
      id: `${apiId}:${method}:${path}`,
      apiId,
      category: "",
      method: method as EndpointDocument["method"],
      path,
      title,
      description: this.extractDescription($),
      parameters,
      responseFields,
      examples,
      authentication: ["API Key", "OAuth2"],
      permissions: permissions.split(/[,、\n]/).map((s) => s.trim()).filter(Boolean),
      notes: [],
      sourceUrl: pageUrl,
    };

    return { documents: [doc], confidence, warnings };
  }

  /** ページ冒頭からメソッド+パスを抽出 */
  private extractMethodAndPath($: CheerioAPI): { method: string; path: string } {
    // パターン: h1 の次のテキストノード or コードブロック
    const bodyText = $("h1").first().parent().text();
    const match = bodyText.match(
      /\b(GET|POST|PUT|DELETE|PATCH)\s+(\/api\/v2\/\S+)/i
    );
    if (match) {
      return { method: match[1].toUpperCase(), path: match[2] };
    }

    // フォールバック: ページ全体から探す（最初にマッチしたもの）
    const fullText = $("body").text();
    const fallback = fullText.match(
      /\b(GET|POST|PUT|DELETE|PATCH)\s+(\/api\/v2\/\S+)/i
    );
    if (fallback) {
      return { method: fallback[1].toUpperCase(), path: fallback[2] };
    }

    return { method: "", path: "" };
  }

  /** H3 見出しでセクションを分割 */
  private splitByH3($: CheerioAPI): Map<string, cheerio.Cheerio> {
    const sections = new Map<string, cheerio.Cheerio>();
    $("h2, h3").each((_, heading) => {
      const key = $(heading).text().trim();
      // heading の次の兄弟要素を、次の heading まで収集
      const content = $(heading).nextUntil("h2, h3");
      sections.set(key, content);
    });
    return sections;
  }

  /** パラメータテーブルのパース（3 列: パラメータ名 / 型 / 内容） */
  private parseBacklogParams(
    $: CheerioAPI,
    sections: Map<string, cheerio.Cheerio>
  ): ParameterInfo[] {
    const params: ParameterInfo[] = [];

    // 「クエリパラメーター」「リクエストパラメーター」「URL パラメーター」
    // のいずれかのセクション内のテーブルをパース
    for (const [key, content] of sections) {
      if (!/パラメーター/.test(key)) continue;

      content.filter("table").each((_, table) => {
        $(table).find("tr").slice(1).each((_, row) => {
          const cells = $(row).find("td");
          if (cells.length < 3) return;

          const rawName = $(cells[0]).text().trim();
          const rawType = $(cells[1]).text().trim();
          const description = $(cells[2]).text().trim();

          if (!rawName) return;

          // 配列パラメータの検出: "categoryId[]" → name=categoryId, type=array
          const isArray = rawName.endsWith("[]");
          const name = isArray ? rawName.slice(0, -2) : rawName;
          const type = isArray ? `${rawType}[]` : rawType;

          // Backlog は required 列がないため、
          // 説明文中の記述から推測
          const required = /必須|required/i.test(description);

          params.push({
            name,
            type: type || "string",
            required,
            description: description.slice(0, 300),
          });
        });
      });
    }

    return params;
  }

  /** レスポンスセクションの解析 */
  private parseResponse(
    $: CheerioAPI,
    sections: Map<string, cheerio.Cheerio>
  ): { responseFields: FieldInfo[]; responseExample: string } {
    let responseExample = "";
    const responseFields: FieldInfo[] = [];

    for (const [key, content] of sections) {
      if (!/レスポンス/.test(key)) continue;

      // JSON コードブロックを探す
      content.find("pre code").each((_, el) => {
        const text = $(el).text().trim();
        if ((text.startsWith("{") || text.startsWith("[")) && !responseExample) {
          responseExample = text.slice(0, 3000);

          // JSON からフィールド情報を推測
          try {
            const parsed = JSON.parse(
              responseExample.replace(/\/\/.*$/gm, "").replace(/,\s*[}\]]/g, (m) =>
                m.replace(",", "")
              )
            );
            const obj = Array.isArray(parsed) ? parsed[0] : parsed;
            if (obj && typeof obj === "object") {
              for (const [fieldName, value] of Object.entries(obj)) {
                responseFields.push({
                  name: fieldName,
                  type: Array.isArray(value)
                    ? "array"
                    : value === null
                      ? "null"
                      : typeof value,
                  description: "",
                });
              }
            }
          } catch {
            // JSON パース失敗は警告のみ（例示 JSON にコメントが含まれる場合など）
          }
        }
      });
    }

    return { responseFields, responseExample };
  }

  private extractSection(sections: Map<string, cheerio.Cheerio>, pattern: RegExp): string {
    for (const [key, content] of sections) {
      if (pattern.test(key)) {
        return content.text().trim();
      }
    }
    return "";
  }

  private extractRequestExample(
    $: CheerioAPI,
    sections: Map<string, cheerio.Cheerio>
  ): string {
    for (const [key, content] of sections) {
      if (!/リクエストの例|リクエスト例/.test(key)) continue;
      const code = content.find("pre code").first().text().trim();
      if (code) return code.slice(0, 2000);
    }
    return "";
  }

  private extractDescription($: CheerioAPI): string {
    const h1 = $("h1").first();
    const nextP = h1.nextAll("p").first();
    return nextP.text().trim().slice(0, 500);
  }
}
```

---

## 6. インデクサーモジュール

### 6.1 インターフェース定義

```typescript
// src/core/indexer.ts

import MiniSearch from "minisearch";

interface SearchOptions {
  apiId?: string;
  limit: number;
}

interface SearchHit {
  id: string;
  score: number;
  apiId: string;
  method: string;
  path: string;
  title: string;
  category: string;
}

export class Indexer {
  private indexes: Map<string, MiniSearch<SearchableDocument>>;

  constructor();

  /** ドキュメント群からインデックスを構築する */
  build(apiId: string, documents: EndpointDocument[]): void;

  /** シリアライズ済みインデックスをディスクからロードする */
  loadFromDisk(apiId: string, indexPath: string): void;

  /** インデックスをディスクに保存する */
  saveToDisk(apiId: string, indexPath: string): void;

  /** 検索を実行する */
  search(query: string, options: SearchOptions): SearchHit[];

  /** 特定 API のインデックスを破棄する */
  remove(apiId: string): void;
}
```

### 6.2 インデックス構築の詳細

```typescript
// build() の内部実装

build(apiId: string, documents: EndpointDocument[]): void {
  const miniSearch = new MiniSearch<SearchableDocument>({
    fields: ["title", "path", "description", "parameterNames", "category"],
    storeFields: ["apiId", "method", "path", "title", "category"],
    tokenize: this.tokenize.bind(this),
    processTerm: this.processTerm.bind(this),
    searchOptions: {
      boost: { title: 3, path: 2, parameterNames: 1.5 },
      fuzzy: 0.2,
      prefix: true,
    },
  });

  const searchableDocs: SearchableDocument[] = documents.map((doc) => ({
    id: doc.id,
    title: doc.title,
    path: doc.path,
    method: doc.method,
    description: doc.description.slice(0, 200),
    parameterNames: doc.parameters.map((p) => p.name).join(" "),
    category: doc.category,
    apiId: doc.apiId,
  }));

  miniSearch.addAll(searchableDocs);
  this.indexes.set(apiId, miniSearch);
}
```

### 6.3 トークナイザーの仕様

```typescript
/**
 * 日本語 + 英語ハイブリッドトークナイザー。
 *
 * 処理フロー:
 * 1. Intl.Segmenter で単語分割（日本語対応）
 * 2. isWordLike なセグメントのみ抽出
 * 3. CamelCase / snake_case をさらに分割
 * 4. 全て小文字に正規化
 *
 * フォールバック:
 * Intl.Segmenter が利用不可の場合（古い Node.js）、
 * Unicode プロパティベースの bigram + 空白分割にフォールバック。
 */
private tokenize(text: string): string[] {
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    return this.segmenterTokenize(text);
  }
  return this.fallbackTokenize(text);
}

private segmenterTokenize(text: string): string[] {
  const segmenter = new Intl.Segmenter("ja", { granularity: "word" });
  const tokens: string[] = [];

  for (const segment of segmenter.segment(text)) {
    if (!segment.isWordLike) continue;
    const word = segment.segment;

    // CamelCase 分割: "getRecord" → ["get", "Record"]
    const camelParts = word.match(/[A-Z]?[a-z]+|[A-Z]+(?=[A-Z][a-z]|\d|\b)/g);
    if (camelParts && camelParts.length > 1) {
      tokens.push(...camelParts);
    }

    // snake_case 分割: "get_record" → ["get", "record"]
    if (word.includes("_")) {
      tokens.push(...word.split("_").filter(Boolean));
    }

    tokens.push(word);
  }

  return tokens;
}

private fallbackTokenize(text: string): string[] {
  // CJK 文字は bigram で分割
  const cjkRegex = /[\u3000-\u9fff\uf900-\ufaff]/;
  const tokens: string[] = [];

  // 空白で大まかに分割
  const words = text.split(/[\s/._-]+/).filter(Boolean);
  for (const word of words) {
    if (cjkRegex.test(word)) {
      // bigram 生成
      for (let i = 0; i < word.length - 1; i++) {
        tokens.push(word.slice(i, i + 2));
      }
      // 元の文字列も追加（完全一致用）
      tokens.push(word);
    } else {
      tokens.push(word);
    }
  }

  return tokens;
}

/**
 * ストップワード除去と正規化。
 * null を返すとそのトークンは無視される。
 */
private processTerm(term: string): string | null {
  const lower = term.toLowerCase();

  // 1文字の英字は除外（助詞は残す）
  if (/^[a-z]$/.test(lower)) return null;

  // 日本語ストップワード（助詞・助動詞のうち検索に不要なもの）
  const jaStopWords = new Set(["の", "に", "は", "を", "た", "が", "で", "て", "と", "し", "れ", "さ"]);
  if (jaStopWords.has(lower)) return null;

  return lower;
}
```

### 6.4 検索の詳細

```typescript
search(query: string, options: SearchOptions): SearchHit[] {
  const { apiId, limit } = options;

  if (apiId) {
    // 特定 API のインデックスのみ検索
    const index = this.indexes.get(apiId);
    if (!index) return [];
    return index
      .search(query, { limit })
      .map((r) => ({
        id: r.id,
        score: r.score,
        apiId: r.apiId,
        method: r.method,
        path: r.path,
        title: r.title,
        category: r.category,
      }));
  }

  // 全 API を横断検索（各インデックスから取得してマージ・再ランキング）
  const allResults: SearchHit[] = [];
  for (const [id, index] of this.indexes) {
    const results = index.search(query, { limit: limit * 2 });
    allResults.push(
      ...results.map((r) => ({
        id: r.id,
        score: r.score,
        apiId: r.apiId,
        method: r.method,
        path: r.path,
        title: r.title,
        category: r.category,
      }))
    );
  }

  // スコア降順でソートし、上位 limit 件を返す
  return allResults
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
```

### 6.5 シリアライズ / デシリアライズ

```typescript
saveToDisk(apiId: string, indexPath: string): void {
  const index = this.indexes.get(apiId);
  if (!index) throw new Error(`Index not found: ${apiId}`);

  const serialized = JSON.stringify(index.toJSON());
  writeFileSync(indexPath, serialized, "utf-8");
}

loadFromDisk(apiId: string, indexPath: string): void {
  const data = readFileSync(indexPath, "utf-8");
  const miniSearch = MiniSearch.loadJSON<SearchableDocument>(data, {
    fields: ["title", "path", "description", "parameterNames", "category"],
    storeFields: ["apiId", "method", "path", "title", "category"],
    tokenize: this.tokenize.bind(this),
    processTerm: this.processTerm.bind(this),
  });

  this.indexes.set(apiId, miniSearch);
}
```

---

## 7. ドキュメントストア

### 7.1 インターフェース定義

```typescript
// src/core/store.ts

export class DocumentStore {
  /** apiId → EndpointDocument[] のメモリ上のマップ */
  private store: Map<string, EndpointDocument[]>;

  constructor();

  /** ドキュメントをメモリにセットする */
  set(apiId: string, documents: EndpointDocument[]): void;

  /** ID で 1 件取得する */
  get(documentId: string): EndpointDocument | undefined;

  /** API ID で全件取得する */
  getByApi(apiId: string): EndpointDocument[];

  /** あいまい検索（パスの部分一致） */
  findSimilar(apiId: string, endpoint: string): EndpointDocument[];

  /** 全 API のサマリー情報を返す */
  getAllApiSummaries(): ApiSummary[];

  /** 特定 API のカテゴリ別エンドポイント一覧を返す */
  getApiDetail(apiId: string): ApiDetail | undefined;

  /** ディスクからロードする */
  loadFromDisk(apiId: string, documentsPath: string): void;

  /** ディスクに保存する */
  saveToDisk(apiId: string, documentsPath: string): void;

  /** 特定 API を削除する */
  remove(apiId: string): void;
}

interface ApiSummary {
  id: string;
  name: string;
  description: string;
  endpointCount: number;
  categories: string[];
  sourceUrl: string;
  crawledAt: string;
}

interface ApiDetail {
  id: string;
  name: string;
  categories: {
    name: string;
    endpoints: Array<{
      method: string;
      path: string;
      title: string;
    }>;
  }[];
}
```

### 7.2 ID 体系

```
ドキュメント ID のフォーマット:
  "{apiId}:{method}:{path}"

例:
  "kintone:GET:/k/v1/record.json"
  "kintone:POST:/k/v1/record.json"    ← 同じパスでもメソッドで区別
  "backlog:GET:/api/v2/issues/:issueIdOrKey"
```

### 7.3 ディスク保存形式

```typescript
// documents.json の構造
{
  "version": 1,
  "apiId": "kintone",
  "crawledAt": "2026-03-01T12:00:00.000Z",
  "endpointCount": 85,
  "categories": [
    { "name": "Records", "endpointCount": 20 },
    { "name": "Apps", "endpointCount": 35 }
    // ...
  ],
  "documents": [
    {
      "id": "kintone:GET:/k/v1/record.json",
      "apiId": "kintone",
      "category": "Records",
      "method": "GET",
      "path": "/k/v1/record.json",
      "title": "レコードを取得する",
      "description": "...",
      "parameters": [...],
      "responseFields": [...],
      "examples": [...],
      "authentication": [...],
      "permissions": [...],
      "notes": [...],
      "sourceUrl": "https://cybozu.dev/ja/kintone/docs/rest-api/records/get-record/"
    }
    // ...
  ]
}
```

---

## 8. キャッシュマネージャー

### 8.1 インターフェース定義

```typescript
// src/core/cache.ts

interface CacheManagerOptions {
  cacheDir: string;           // デフォルト: ~/.mcp-api-reference/cache
  ttlMs: number;              // デフォルト: 7 * 24 * 60 * 60 * 1000 (7 days)
}

export class CacheManager {
  constructor(private options: CacheManagerOptions);

  /** キャッシュの有効性を確認する */
  isCacheValid(apiId: string, configHash: string): boolean;

  /** キャッシュからインデックスとドキュメントをロードする */
  load(apiId: string): { documentsPath: string; indexPath: string; meta: CacheMeta };

  /** クロール結果をキャッシュに保存する */
  save(apiId: string, data: {
    documents: EndpointDocument[];
    indexJson: string;
    meta: Omit<CacheMeta, "version">;
  }): void;

  /** 特定 API のキャッシュを削除する */
  invalidate(apiId: string): void;

  /** 全キャッシュを削除する */
  clearAll(): void;

  /** キャッシュディレクトリのパスを返す */
  getCacheDir(apiId: string): string;
}
```

### 8.2 キャッシュ有効性の判定ロジック

```typescript
isCacheValid(apiId: string, configHash: string): boolean {
  const metaPath = path.join(this.getCacheDir(apiId), "meta.json");

  // 1. meta.json が存在しない → 無効
  if (!existsSync(metaPath)) return false;

  const meta: CacheMeta = JSON.parse(readFileSync(metaPath, "utf-8"));

  // 2. バージョンが異なる → 無効（スキーマ変更時の対応）
  if (meta.version !== 1) return false;

  // 3. 設定のハッシュが異なる → 無効（設定変更時の自動再クロール）
  if (meta.configHash !== configHash) return false;

  // 4. TTL 超過 → 無効
  const crawledAt = new Date(meta.crawledAt).getTime();
  const now = Date.now();
  if (now - crawledAt > this.options.ttlMs) return false;

  // 5. documents.json と index.json が両方存在する → 有効
  const docsPath = path.join(this.getCacheDir(apiId), "documents.json");
  const indexPath = path.join(this.getCacheDir(apiId), "index.json");
  return existsSync(docsPath) && existsSync(indexPath);
}
```

### 8.3 設定ハッシュの計算

```typescript
import { createHash } from "node:crypto";

function computeConfigHash(config: SiteConfig): string {
  // クロール設定とパーサー設定のみハッシュ対象（name や description は除外）
  const hashTarget = JSON.stringify({
    baseUrl: config.baseUrl,
    crawl: config.crawl,
    parser: config.parser,
  });
  return createHash("sha256").update(hashTarget).digest("hex").slice(0, 16);
}
```

---

## 9. レスポンスフォーマッター

### 9.1 設計原則

| 原則 | 説明 |
|---|---|
| コンテキスト効率 | LLM が消費するトークン数を最小化。1 エンドポイント 500〜1500 トークン目標 |
| 構造化 | Markdown テーブルと見出しで情報を整理し、LLM が特定情報を素早く参照可能に |
| アクション誘導 | 次に呼ぶべきツールを具体例で提示し、LLM が自律的に情報を深掘り可能に |
| 一貫性 | 全 API のレスポンスを統一フォーマットで返す |

### 9.2 インターフェース定義

```typescript
// src/formatters/response.ts

export class ResponseFormatter {

  /** search_docs の検索結果をフォーマットする */
  formatSearchResults(
    query: string,
    hits: SearchHit[],
    documents: Map<string, EndpointDocument>,
    apiFilter?: string
  ): string;

  /** get_endpoint のエンドポイント詳細をフォーマットする */
  formatEndpointDetail(doc: EndpointDocument): string;

  /** list_apis の API 一覧をフォーマットする（全 API 概要） */
  formatApiList(summaries: ApiSummary[]): string;

  /** list_apis の API 詳細をフォーマットする（カテゴリ別一覧） */
  formatApiDetail(detail: ApiDetail): string;

  /** エラー時のレスポンスをフォーマットする */
  formatError(message: string, suggestions?: string[]): string;

  /** 候補サジェストつきの not-found レスポンス */
  formatNotFound(
    api: string,
    endpoint: string,
    method: string,
    similar: EndpointDocument[]
  ): string;
}
```

### 9.3 formatEndpointDetail の出力テンプレート

```
## {METHOD} {path} — {title}

### Authentication
{authentication をカンマ区切り}

### Request Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| {name}    | {type} | {Yes/No} | {description（100文字以内）} |
...

{※ パラメータが 0 件の場合はセクション自体を省略}

### Response
| Property | Type | Description |
|----------|------|-------------|
| {name}   | {type} | {description（100文字以内）} |
...

{※ レスポンスフィールドが 0 件の場合はセクション自体を省略}

### Example Request
```
{examples のうち type=request の最初の 1 件。1000 文字以内}
```

### Example Response
```json
{examples のうち type=response の最初の 1 件。1500 文字以内}
```

{※ notes がある場合のみ:}
### Notes
{箇条書き。最大 5 件}

Source: {sourceUrl}
```

### 9.4 トークン数の目安

| コンポーネント | 目安トークン数 |
|---|---|
| ヘッダー（メソッド+パス+タイトル） | 20 |
| Authentication | 15 |
| Parameters テーブル（5 パラメータ） | 150 |
| Response テーブル（5 フィールド） | 120 |
| Example Request | 100〜300 |
| Example Response | 100〜500 |
| Notes（3 件） | 60 |
| **合計** | **500〜1200** |

### 9.5 切り詰め戦略

```typescript
/** レスポンスが大きくなりすぎる場合の切り詰め */

// パラメータテーブル: 最大 30 行。超過分は "... and N more parameters" で省略
const MAX_PARAMS_IN_DETAIL = 30;

// レスポンスフィールド: 最大 20 行
const MAX_RESPONSE_FIELDS_IN_DETAIL = 20;

// コード例: 最大 1500 文字
const MAX_EXAMPLE_LENGTH = 1500;

// description: 最大 300 文字
const MAX_DESCRIPTION_LENGTH = 300;

// Notes: 最大 5 件
const MAX_NOTES = 5;
```

---

## 10. プリセット仕様

### 10.1 プリセットレジストリ

```typescript
// src/presets/index.ts

import { KintoneParser } from "./kintone/parser.js";
import { kintoneConfig } from "./kintone/config.js";
import { BacklogParser } from "./backlog/parser.js";
import { backlogConfig } from "./backlog/config.js";

interface PresetEntry {
  config: PresetConfig;
  parser: SiteParser;
}

const presets: Map<string, PresetEntry> = new Map([
  ["kintone", { config: kintoneConfig, parser: new KintoneParser() }],
  ["backlog", { config: backlogConfig, parser: new BacklogParser() }],
]);

export function getPreset(id: string): PresetEntry | undefined {
  return presets.get(id);
}

export function getAllPresets(): PresetEntry[] {
  return [...presets.values()];
}

export function getPresetIds(): string[] {
  return [...presets.keys()];
}
```

### 10.2 プリセット設定の完全定義

#### kintone

```typescript
// src/presets/kintone/config.ts

export const kintoneConfig: PresetConfig = {
  id: "kintone",
  name: "kintone REST API",
  description: "Cybozu kintone platform REST API for app/record/space management",
  baseUrl: "https://cybozu.dev",
  crawl: {
    startUrl: "https://cybozu.dev/ja/kintone/docs/rest-api/",
    includePatterns: [
      "https://cybozu.dev/ja/kintone/docs/rest-api/**",
    ],
    excludePatterns: [
      "https://cybozu.dev/ja/kintone/docs/rest-api/overview/**",
      "https://cybozu.dev/ja/kintone/docs/rest-api/changelog/**",
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

#### Backlog

```typescript
// src/presets/backlog/config.ts

export const backlogConfig: PresetConfig = {
  id: "backlog",
  name: "Backlog API v2",
  description: "Nulab Backlog project management API v2",
  baseUrl: "https://developer.nulab.com",
  crawl: {
    startUrl: "https://developer.nulab.com/ja/docs/backlog/",
    includePatterns: [
      "https://developer.nulab.com/ja/docs/backlog/api/2/**",
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

### 10.3 新規プリセット追加時に必要なファイル

```
src/presets/{preset-id}/
├── config.ts    # PresetConfig をエクスポート
└── parser.ts    # SiteParser インターフェースを実装するクラスをエクスポート

変更が必要な既存ファイル:
└── src/presets/index.ts    # レジストリに追加
```

---

## 11. 設定とバリデーション

### 11.1 環境変数一覧

| 環境変数 | 型 | デフォルト | 説明 |
|---|---|---|---|
| `MCP_API_REF_CONFIG` | string | なし | カスタムサイト定義 JSON ファイルのパス |
| `MCP_API_REF_CACHE_DIR` | string | `~/.mcp-api-reference/cache` | キャッシュディレクトリ |
| `MCP_API_REF_PRESETS` | string | `*`（全プリセット） | 有効にするプリセット ID（カンマ区切り） |
| `MCP_API_REF_TTL_DAYS` | number | `7` | キャッシュ有効期限（日数） |
| `MCP_API_REF_LOG_LEVEL` | string | `info` | ログレベル（`debug`, `info`, `warn`, `error`） |

### 11.2 カスタムサイト設定のバリデーション

```typescript
import { z } from "zod";

const GenericParserSelectorsSchema = z.object({
  contentSelector: z.string().min(1),
  titleSelector: z.string().min(1),
  endpointSelector: z.string().min(1),
  parameterTableSelector: z.string().min(1),
  codeBlockSelector: z.string().min(1),
  excludeSelectors: z.array(z.string()).default([]),
});

const CrawlConfigSchema = z.object({
  startUrl: z.string().url(),
  includePatterns: z.array(z.string().min(1)).min(1),
  excludePatterns: z.array(z.string()).default([]),
  maxPages: z.number().int().min(1).max(1000).default(200),
  delayMs: z.number().int().min(200).max(10000).default(1000),
});

const SiteConfigSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, "id must be lowercase alphanumeric with hyphens"),
  name: z.string().min(1).max(100),
  description: z.string().max(500).default(""),
  baseUrl: z.string().url(),
  crawl: CrawlConfigSchema,
  parser: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("preset"),
      parserModule: z.string().optional(),
    }),
    z.object({
      type: z.literal("generic"),
      selectors: GenericParserSelectorsSchema,
    }),
  ]),
});

const CustomSitesFileSchema = z.object({
  sites: z.array(SiteConfigSchema).min(1),
});
```

### 11.3 バリデーションエラー時の挙動

| エラー | 挙動 |
|---|---|
| カスタム設定ファイルが見つからない | stderr に警告ログ。プリセットのみで起動を続行 |
| JSON パースエラー | stderr にエラーログ。プリセットのみで起動を続行 |
| Zod バリデーションエラー | 各サイトごとに検証。エラーのサイトをスキップし、有効なサイトのみ起動 |
| URL の `file://` プロトコル | バリデーションで拒否。エラーログ |
| プリセット ID の重複 | カスタムサイトが同一 ID で上書き。警告ログ |
| 全サイトが無効 | サーバーは起動するが、ツール呼び出しで「No APIs indexed」を返す |

---

## 12. エラーハンドリング

### 12.1 エラー階層

```typescript
/** 基底エラークラス */
class McpApiRefError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly recoverable: boolean
  ) {
    super(message);
    this.name = "McpApiRefError";
  }
}

/** クロール中のエラー */
class CrawlError extends McpApiRefError {
  constructor(
    message: string,
    public readonly url: string,
    public readonly statusCode?: number
  ) {
    super(message, "CRAWL_ERROR", true);
  }
}

/** パース中のエラー */
class ParseError extends McpApiRefError {
  constructor(
    message: string,
    public readonly url: string
  ) {
    super(message, "PARSE_ERROR", true);
  }
}

/** キャッシュ操作のエラー */
class CacheError extends McpApiRefError {
  constructor(message: string) {
    super(message, "CACHE_ERROR", true);
  }
}

/** 設定エラー */
class ConfigError extends McpApiRefError {
  constructor(message: string) {
    super(message, "CONFIG_ERROR", false);
  }
}
```

### 12.2 エラー発生時の挙動一覧

| 状況 | エラータイプ | 挙動 |
|---|---|---|
| クロール中に 1 ページで 404 | CrawlError | そのページをスキップ。他のページは続行。警告ログ |
| クロール中に 5xx | CrawlError | 最大 2 回リトライ。失敗したらスキップ |
| クロール中にネットワークエラー | CrawlError | 最大 2 回リトライ。失敗したらスキップ |
| クロール中に全ページ失敗 | CrawlError | その API のインデックスを空で登録。エラーログ |
| パース中に構造認識失敗 | ParseError | confidence = 0 で汎用パーサーにフォールバック |
| 汎用パーサーでも失敗 | ParseError | そのページをスキップ。警告ログ |
| キャッシュ読み込み失敗 | CacheError | キャッシュを無効として再クロール |
| キャッシュ書き込み失敗 | CacheError | 警告ログ。インメモリのインデックスは保持（次回起動時に再クロール） |
| 設定ファイルエラー | ConfigError | 問題のあるサイトをスキップ。他は続行 |
| ツール呼び出し時の検索失敗 | — | `isError: true` でエラーメッセージを返す |

### 12.3 MCP ツールレスポンスでのエラー表現

```typescript
// 通常のエラー（LLM が対処可能）
{
  content: [{
    type: "text",
    text: "API 'kintoo' not found. Available APIs: kintone, backlog\n\nDid you mean 'kintone'?"
  }]
}

// システムエラー（LLM が対処不可能）
{
  isError: true,
  content: [{
    type: "text",
    text: "Internal error: Index not available for kintone. The cache may be corrupted. Try restarting with --refresh kintone."
  }]
}
```

**使い分けの原則**:
- `isError: false`（デフォルト）: ユーザー入力の修正で解決できる場合（API 名タイポ、エンドポイント未検出）
- `isError: true`: システム側の問題で解決策がツール再呼び出しでは得られない場合

---

## 13. ロギング

### 13.1 ログ出力先

すべてのログは `stderr` に出力する。`stdout` は MCP プロトコル専用。

### 13.2 ログレベル

```typescript
type LogLevel = "debug" | "info" | "warn" | "error";

class Logger {
  constructor(private level: LogLevel, private prefix: string);

  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}
```

### 13.3 ログフォーマット

```
[mcp-api-reference] [INFO]  2026-03-01T12:00:00.000Z Loading preset: kintone
[mcp-api-reference] [INFO]  2026-03-01T12:00:00.010Z Cache valid for kintone (crawled 2d ago)
[mcp-api-reference] [INFO]  2026-03-01T12:00:01.000Z Loaded 85 endpoints for kintone
[mcp-api-reference] [WARN]  2026-03-01T12:00:01.100Z Cache expired for backlog, starting crawl
[mcp-api-reference] [INFO]  2026-03-01T12:00:02.000Z Crawling backlog: 1/150 pages
[mcp-api-reference] [DEBUG] 2026-03-01T12:00:02.100Z Fetching: https://developer.nulab.com/...
[mcp-api-reference] [WARN]  2026-03-01T12:00:05.000Z Parse warning for backlog: low confidence (0.3) at /api/2/xxx
[mcp-api-reference] [INFO]  2026-03-01T12:05:00.000Z Server ready. 235 endpoints indexed across 2 APIs.
```

### 13.4 プログレス表示（クロール中）

```
[mcp-api-reference] [INFO]  Crawling kintone: 10/85 pages (12%)
[mcp-api-reference] [INFO]  Crawling kintone: 20/85 pages (24%)
...
[mcp-api-reference] [INFO]  Crawling kintone: 85/85 pages (100%) — 87s
```

10 ページごとまたは 10 秒ごと（どちらか早い方）にプログレスを出力する。

---

## 14. テスト戦略

### 14.1 テストピラミッド

```
                   ┌──────────┐
                   │ E2E Test │  1〜2 テスト
                   │ (MCP通信) │
                   ├──────────┤
                   │Integration│  10〜15 テスト
                   │  Tests   │
                   ├──────────┤
                   │  Unit    │  50〜80 テスト
                   │  Tests   │
                   └──────────┘
```

### 14.2 ユニットテスト

| テスト対象 | テストファイル | テスト内容 |
|---|---|---|
| KintoneParser | `tests/presets/kintone.test.ts` | HTML フィクスチャから正しく EndpointDocument を抽出するか |
| BacklogParser | `tests/presets/backlog.test.ts` | 同上 |
| GenericParser | `tests/core/parser.test.ts` | 各種 HTML 構造に対してパースが機能するか |
| Indexer | `tests/core/indexer.test.ts` | インデックス構築、検索、シリアライズ/デシリアライズ |
| Crawler (URL マッチ) | `tests/core/crawler.test.ts` | glob パターンマッチ、robots.txt パース |
| ResponseFormatter | `tests/formatters/response.test.ts` | 各種入力に対して期待するテキスト出力 |
| Tokenizer | `tests/core/indexer.test.ts` | 日本語トークナイズ、CamelCase 分割 |
| ConfigValidation | `tests/config.test.ts` | Zod スキーマバリデーション |
| Store | `tests/core/store.test.ts` | CRUD、あいまい検索 |
| CacheManager | `tests/core/cache.test.ts` | 有効性判定、TTL、configHash |

### 14.3 HTML フィクスチャ

```
tests/fixtures/
├── kintone/
│   ├── index.html           # REST API インデックスページ
│   ├── get-record.html      # レコード取得ページ
│   ├── add-record.html      # レコード登録ページ
│   ├── get-records.html     # 一括レコード取得ページ
│   └── get-app.html         # アプリ情報取得ページ
└── backlog/
    ├── index.html           # Backlog API インデックスページ
    ├── get-issue.html       # 課題情報取得ページ
    ├── add-issue.html       # 課題追加ページ
    ├── get-issue-list.html  # 課題一覧取得ページ
    └── get-project-list.html # プロジェクト一覧取得ページ
```

**フィクスチャの取得方法**:
- 初回は `curl -o tests/fixtures/kintone/get-record.html "URL"` で取得
- リポジトリに含め、パーサーの回帰テストに使用
- **注意**: HTML ファイルは著作権上、最小限の内容に編集する（テストに必要なセクションのみ残す）

### 14.4 インテグレーションテスト

```typescript
// tests/integration/pipeline.test.ts

describe("Crawl → Parse → Index pipeline", () => {
  it("should build a searchable index from HTML fixtures", async () => {
    // 1. フィクスチャ HTML を CrawlResult としてモック
    // 2. パーサーで EndpointDocument に変換
    // 3. インデックスを構築
    // 4. 検索を実行して結果を検証
  });
});

// tests/integration/tools.test.ts

describe("MCP tools", () => {
  it("search_docs should return matching endpoints", async () => {
    // 事前にインデックスを構築した状態で
    // search_docs ハンドラを直接呼び出し、レスポンス形式を検証
  });

  it("get_endpoint should return endpoint details", async () => {
    // 同上
  });
});
```

### 14.5 E2E テスト

```typescript
// tests/e2e/mcp-server.test.ts

describe("MCP Server E2E", () => {
  it("should start and respond to tool calls via stdio", async () => {
    // 1. サーバープロセスを子プロセスとして起動
    // 2. MCP Client SDK で接続
    // 3. list_apis を呼び出し、レスポンスを検証
    // 4. search_docs を呼び出し、レスポンスを検証
    // 5. プロセスを終了
  });
});
```

### 14.6 テスト実行コマンド

```bash
# 全テスト実行
npx vitest run

# watch モード
npx vitest

# カバレッジ
npx vitest run --coverage

# 特定テスト
npx vitest run tests/presets/kintone.test.ts
```

### 14.7 カバレッジ目標

| モジュール | 目標 |
|---|---|
| パーサー（kintone, backlog, generic） | 90%+ |
| インデクサー | 85%+ |
| レスポンスフォーマッター | 85%+ |
| キャッシュマネージャー | 80%+ |
| ツールハンドラ | 80%+ |
| クローラー（HTTP 部分はモック） | 70%+ |
| **全体** | **80%+** |

---

## 15. ビルド・パッケージング・CI/CD

### 15.1 tsup ビルド設定

```typescript
// tsup.config.ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  outDir: "dist",
  clean: true,
  dts: true,
  sourcemap: true,
  splitting: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
```

### 15.2 TypeScript 設定

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

### 15.3 ESLint 設定

```typescript
// eslint.config.js
import tseslint from "typescript-eslint";

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    ignores: ["dist/", "node_modules/", "tests/fixtures/"],
  }
);
```

### 15.4 GitHub Actions — CI

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  lint-and-test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [18, 20, 22]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: "npm"
      - run: npm ci
      - run: npm run lint
      - run: npm run test
      - run: npm run build

  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: "npm"
      - run: npm ci
      - run: npm audit --audit-level=high
```

### 15.5 GitHub Actions — npm publish

```yaml
# .github/workflows/publish.yml
name: Publish to npm

on:
  push:
    tags:
      - "v*"

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: "https://registry.npmjs.org"
          cache: "npm"
      - run: npm ci
      - run: npm run lint
      - run: npm run test
      - run: npm run build
      - run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

---

## 16. package.json 定義

```jsonc
{
  "name": "mcp-api-reference",
  "version": "0.1.0",
  "description": "MCP server that crawls, indexes, and serves API reference documentation for LLM-powered coding tools",
  "type": "module",
  "bin": {
    "mcp-api-reference": "dist/index.js"
  },
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "lint": "eslint src/",
    "lint:fix": "eslint src/ --fix",
    "format": "prettier --write 'src/**/*.ts'",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "prepublishOnly": "npm run build"
  },
  "keywords": [
    "mcp",
    "model-context-protocol",
    "api-reference",
    "documentation",
    "llm",
    "claude",
    "kintone",
    "backlog"
  ],
  "author": "",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": ""
  },
  "engines": {
    "node": ">=18.0.0"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "cheerio": "^1.0.0",
    "minisearch": "^7.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "eslint": "^9.0.0",
    "prettier": "^3.3.0",
    "tsup": "^8.0.0",
    "typescript": "^5.5.0",
    "typescript-eslint": "^8.0.0",
    "vitest": "^2.0.0"
  }
}
```

**注記**:
- `undici` は Node.js 18+ に組み込まれているため、dependencies には含めない。Node.js 標準の `fetch` を使用する
- `zod` は `@modelcontextprotocol/sdk` の peer dependency でもある
- `bin` フィールドにより `npx mcp-api-reference` で起動可能
- `engines.node >= 18` は `Intl.Segmenter` の確実な利用と `fetch` の標準搭載を要求

---

## 付録 C: kintone パーサー判定テーブル

パーサーが HTML 内のテーブルをどの種類として判定するかのルール。

| テーブル種別 | 判定条件 | 抽出するデータ |
|---|---|---|
| 仕様テーブル | 最初の `<table>` かつ「HTTPメソッド」を含む行がある | method, path, authentication, contentType |
| パラメータテーブル | ヘッダー行に「パラメーター名」を含む | name, type, required, description |
| レスポンステーブル | ヘッダー行に「プロパティ名」を含む | name, type, description |
| フィールド型テーブル | ヘッダー行に「フィールド型」を含む | スキップ（補助情報のため） |
| その他 | 上記に該当しない | スキップ |

## 付録 D: Backlog パーサー H3 セクションマッピング

| H3 見出しパターン | マッピング先 | 処理 |
|---|---|---|
| `実行可能な権限` | `permissions` | テキストをカンマ分割 |
| `URL パラメーター` | `parameters` (path params) | テーブルパース |
| `クエリパラメーター` | `parameters` (query params) | テーブルパース |
| `リクエストパラメーター` | `parameters` (body params) | テーブルパース |
| `フォームパラメーター` | `parameters` (form params) | テーブルパース |
| `リクエストの例` / `リクエスト例` | `examples[type=request]` | コードブロック抽出 |
| `レスポンス例` / `レスポンスの例` | `examples[type=response]` | コードブロック抽出 |
| `エラーレスポンス` | `notes` | テキスト抽出 |
| `制限事項` | `notes` | テキスト抽出 |

## 付録 E: MCP サーバー設定例

### Claude Code

```jsonc
// ~/.claude/settings.json
{
  "mcpServers": {
    "api-reference": {
      "command": "npx",
      "args": ["-y", "mcp-api-reference"],
      "env": {
        "MCP_API_REF_PRESETS": "kintone,backlog"
      }
    }
  }
}
```

### Claude Desktop

```jsonc
// ~/Library/Application Support/Claude/claude_desktop_config.json (macOS)
// %APPDATA%\Claude\claude_desktop_config.json (Windows)
{
  "mcpServers": {
    "api-reference": {
      "command": "npx",
      "args": ["-y", "mcp-api-reference"],
      "env": {
        "MCP_API_REF_CONFIG": "/path/to/custom-sites.json"
      }
    }
  }
}
```

### Cursor

```jsonc
// .cursor/mcp.json
{
  "mcpServers": {
    "api-reference": {
      "command": "npx",
      "args": ["-y", "mcp-api-reference"]
    }
  }
}
```

### カスタムサイト + プリセットの併用

```jsonc
// custom-sites.json
{
  "sites": [
    {
      "id": "my-company-api",
      "name": "社内API",
      "description": "社内システムREST API",
      "baseUrl": "https://docs.internal.example.com",
      "crawl": {
        "startUrl": "https://docs.internal.example.com/api/reference",
        "includePatterns": ["https://docs.internal.example.com/api/reference/**"],
        "excludePatterns": [],
        "maxPages": 50,
        "delayMs": 500
      },
      "parser": {
        "type": "generic",
        "selectors": {
          "contentSelector": "main.content",
          "titleSelector": "h1",
          "endpointSelector": ".api-endpoint code",
          "parameterTableSelector": ".params-table table",
          "codeBlockSelector": "pre code",
          "excludeSelectors": ["nav", ".sidebar", "footer"]
        }
      }
    }
  ]
}
```
