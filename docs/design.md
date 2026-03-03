# 設計書: mcp-api-reference

> **Version**: 1.0.0
> **作成日**: 2026-03-01
> **前提ドキュメント**: [docs/requirements.md](./requirements.md), [docs/specification.md](./specification.md)

---

## 目次

1. [設計方針と原則](#1-設計方針と原則)
2. [アーキテクチャ設計](#2-アーキテクチャ設計)
3. [依存性注入とコンポジション設計](#3-依存性注入とコンポジション設計)
4. [クラス詳細設計](#4-クラス詳細設計)
5. [シーケンス設計](#5-シーケンス設計)
6. [データフロー設計](#6-データフロー設計)
7. [状態管理設計](#7-状態管理設計)
8. [ファイルシステム・ストレージ設計](#8-ファイルシステムストレージ設計)
9. [エラーハンドリング設計](#9-エラーハンドリング設計)
10. [横断的関心事](#10-横断的関心事)
11. [拡張性設計](#11-拡張性設計)
12. [テスト設計](#12-テスト設計)
13. [デプロイ・配布設計](#13-デプロイ配布設計)

---

## 1. 設計方針と原則

### 1.1 採用する設計原則

| 原則 | 適用方法 |
|---|---|
| **単一責任の原則 (SRP)** | 各クラスは明確に 1 つの責務を持つ。例: `Crawler` は HTTP 取得のみ、パースはしない |
| **依存性逆転の原則 (DIP)** | 上位モジュール（ツールハンドラ）は下位モジュール（パーサー）の具象に依存せず、インターフェース経由で利用する |
| **開放閉鎖の原則 (OCP)** | 新規プリセット追加時に既存コードの修正を最小化する。`SiteParser` インターフェースの実装追加で対応 |
| **KISS (Keep It Simple, Stupid)** | 個人開発 OSS として、過度な抽象化を避ける。DI コンテナは使わず、手動コンポジション |
| **契約による設計 (DbC)** | Zod スキーマによる入力バリデーション + TypeScript の型システムでモジュール間の契約を保証 |

### 1.2 設計判断の記録

| 判断 | 選択肢 | 決定 | 理由 |
|---|---|---|---|
| DI 方式 | DI コンテナ vs 手動コンポジション | **手動コンポジション** | 個人開発で依存ライブラリを最小化。モジュール数が少なく DI コンテナの恩恵が薄い |
| 並行処理 | Worker Threads vs シングルスレッド | **シングルスレッド** | クロールは I/O 待ちが支配的で CPU バウンドではない。シンプルさ優先 |
| 状態管理 | 集中管理 vs 分散管理 | **ServerContext による集中管理** | 全モジュールの状態を `createServer` で一括初期化し、ライフサイクルを統一 |
| パーサー選択 | Strategy パターン vs Factory | **Strategy + Registry** | 実行時にパーサーを差し替え可能にしつつ、プリセットはレジストリで管理 |
| キャッシュ | ファイルベース vs SQLite | **JSON ファイル** | 外部依存ゼロ。データ量が小さく（数十 MB）、トランザクション不要 |
| HTTP クライアント | undici vs node:fetch | **node:fetch** | Node.js 18+ 標準搭載。タイムアウトは `AbortController` で制御 |

### 1.3 設計上の制約

- **Node.js 18+**: `Intl.Segmenter`, `fetch`, `parseArgs` の標準利用を前提
- **stdio 専有**: stdout は MCP プロトコル専用。すべてのログ・診断は stderr
- **シングルプロセス**: MCP サーバーは 1 クライアント 1 プロセスの関係。同時接続は想定しない
- **メモリ上限**: 全 API のドキュメント + インデックスをメモリに保持。目安 50〜100MB 以内

---

## 2. アーキテクチャ設計

### 2.1 レイヤードアーキテクチャ

```
┌─────────────────────────────────────────────────────────────────┐
│                     Transport Layer                              │
│  StdioServerTransport ← JSON-RPC over stdio                    │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│                     Protocol Layer                               │
│  McpServer (@modelcontextprotocol/sdk)                          │
│  - ツール登録                                                    │
│  - JSON-RPC デコード/エンコード                                   │
│  - エラーハンドリング (プロトコルレベル)                             │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│                    Application Layer (ツールハンドラ)              │
│                                                                  │
│  ┌──────────────┐ ┌───────────────┐ ┌────────────────┐          │
│  │ SearchDocs   │ │ GetEndpoint   │ │ ListApis       │          │
│  │ Handler      │ │ Handler       │ │ Handler        │          │
│  └──────┬───────┘ └───────┬───────┘ └────────┬───────┘          │
│         │                 │                   │                  │
│         └────────┬────────┴───────────────────┘                  │
│                  │                                               │
│         ┌────────▼────────┐                                     │
│         │ ResponseFormatter│ ← レスポンス整形の責務               │
│         └─────────────────┘                                     │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│                    Domain Layer (コアロジック)                     │
│                                                                  │
│  ┌────────────┐  ┌────────────┐  ┌────────────────────┐        │
│  │  Indexer    │  │ Document   │  │  CacheManager      │        │
│  │ (検索)      │  │ Store      │  │  (キャッシュ制御)    │        │
│  └─────┬──────┘  │ (CRUD)     │  └──────────┬─────────┘        │
│        │         └──────┬─────┘             │                   │
│        │                │                    │                   │
│  ┌─────▼────────────────▼────────────────────▼─────────────┐    │
│  │                 InitPipeline                             │    │
│  │  (Crawler → Parser → Indexer → Store → Cache 保存)       │    │
│  └──────────────────┬──────────────────────────────────────┘    │
│                     │                                           │
│  ┌──────────────────▼──────────────────────────────────────┐    │
│  │              Parser Registry                             │    │
│  │  ┌──────────┐ ┌──────────┐ ┌───────────────┐           │    │
│  │  │ Kintone  │ │ Backlog  │ │ Generic       │           │    │
│  │  │ Parser   │ │ Parser   │ │ Parser        │           │    │
│  │  └──────────┘ └──────────┘ └───────────────┘           │    │
│  └──────────────────────────────────────────────────────────┘    │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│                  Infrastructure Layer                            │
│                                                                  │
│  ┌────────────┐  ┌────────────┐  ┌────────────────────┐        │
│  │  Crawler    │  │ FileSystem │  │  Logger            │        │
│  │ (HTTP)      │  │ (fs)       │  │  (stderr)          │        │
│  └─────────────┘  └────────────┘  └────────────────────┘        │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 モジュール境界と依存方向

```
依存方向: 上位 → 下位（逆方向の依存は禁止）

Transport    →  Protocol     →  Application  →  Domain  →  Infrastructure
(stdio)         (McpServer)     (Handlers)      (Core)     (HTTP, FS)

ルール:
- Application Layer は Domain Layer のインターフェースにのみ依存
- Domain Layer は Infrastructure Layer の具象に依存してよい（実用性優先）
- Infrastructure Layer は他のレイヤーに依存しない
- 横断的関心事（Logger, Error）は全レイヤーから参照可能
```

### 2.3 パッケージ構造とモジュール境界

```
src/
├── index.ts                 # [Transport] エントリポイント
├── server.ts                # [Protocol + Application] サーバー初期化・ツール登録
│
├── tools/                   # [Application Layer]
│   ├── search-docs.ts       #   search_docs ハンドラ（純粋関数）
│   ├── get-endpoint.ts      #   get_endpoint ハンドラ（純粋関数）
│   └── list-apis.ts         #   list_apis ハンドラ（純粋関数）
│
├── core/                    # [Domain Layer]
│   ├── crawler.ts           #   HTTP クローリング
│   ├── parser.ts            #   パーサーインターフェース + 汎用パーサー + 解決ロジック
│   ├── indexer.ts           #   MiniSearch ラッパー
│   ├── store.ts             #   ドキュメントストア
│   ├── cache.ts             #   キャッシュ管理
│   └── pipeline.ts          #   初期化パイプライン（NEW: 仕様書では server.ts 内にあったものを分離）
│
├── presets/                  # [Domain Layer - Strategy 実装]
│   ├── index.ts             #   プリセットレジストリ
│   ├── kintone/
│   │   ├── config.ts
│   │   └── parser.ts
│   └── backlog/
│       ├── config.ts
│       └── parser.ts
│
├── formatters/               # [Application Layer - 出力整形]
│   └── response.ts
│
├── types/                    # [共有型定義 - 全レイヤーから参照]
│   ├── config.ts
│   ├── document.ts
│   └── errors.ts
│
└── utils/                    # [Infrastructure Layer - ユーティリティ]
    ├── logger.ts
    ├── glob.ts              #  glob パターンマッチ
    └── hash.ts              #  設定ハッシュ計算
```

**仕様書からの変更点**:
- `src/core/pipeline.ts` を新設: `server.ts` に含まれていた初期化パイプラインのオーケストレーションを分離し、テスト容易性を向上
- `src/utils/` を新設: `glob.ts`, `hash.ts` などの汎用ユーティリティを独立モジュール化
- `src/types/errors.ts` を新設: エラー階層を型定義と同じディレクトリに配置

---

## 3. 依存性注入とコンポジション設計

### 3.1 コンポジションルート

`createServer` 関数がコンポジションルートとして機能し、全モジュールのインスタンスを生成・接続する。

```typescript
// src/server.ts — コンポジションルート

export async function createServer(options: ServerOptions): Promise<McpApp> {
  const logger = new Logger(options.logLevel ?? "info", "mcp-api-reference");

  // --- Infrastructure Layer ---
  const crawler = new Crawler({
    userAgent: `mcp-api-reference/${version}`,
    logger,
  });

  // --- Domain Layer ---
  const store = new DocumentStore();
  const indexer = new Indexer({ logger });
  const cacheManager = new CacheManager({
    cacheDir: options.cacheDir ?? defaultCacheDir(),
    ttlMs: (options.ttlDays ?? 7) * 24 * 60 * 60 * 1000,
    logger,
  });

  // --- パーサーレジストリの構築 ---
  const parserRegistry = new ParserRegistry();
  parserRegistry.registerPresets();  // kintone, backlog

  // --- 初期化パイプライン ---
  const pipeline = new InitPipeline({
    crawler,
    parserRegistry,
    store,
    indexer,
    cacheManager,
    logger,
  });

  // --- 設定のロードと初期化 ---
  const configs = loadConfigs(options);
  await pipeline.initializeAll(configs, options.refreshTarget);

  // --- Application Layer ---
  const formatter = new ResponseFormatter();
  const context: ServerContext = { indexer, store, configs, formatter, logger };

  // --- Protocol Layer ---
  const mcpServer = new McpServer({
    name: "mcp-api-reference",
    version,
  });

  registerTools(mcpServer, context);

  return {
    async start() {
      const transport = new StdioServerTransport();
      await mcpServer.connect(transport);
      logger.info(`Server ready. ${store.totalEndpointCount()} endpoints indexed.`);
    },
  };
}
```

### 3.2 依存関係グラフ（インスタンスレベル）

```
createServer (composition root)
  │
  ├── Logger ─────────────────────────────────┐
  │                                           │ (全モジュールに注入)
  ├── Crawler ◄── { userAgent, logger }       │
  │                                           │
  ├── DocumentStore (依存なし)                 │
  │                                           │
  ├── Indexer ◄── { logger }                  │
  │                                           │
  ├── CacheManager ◄── { cacheDir, ttlMs, logger }
  │                                           │
  ├── ParserRegistry                          │
  │     ├── KintoneParser (依存なし)           │
  │     ├── BacklogParser (依存なし)           │
  │     └── GenericParser ◄── { selectors }   │
  │                                           │
  ├── InitPipeline ◄── { crawler, parserRegistry, store, indexer, cacheManager, logger }
  │                                           │
  ├── ResponseFormatter (依存なし)             │
  │                                           │
  └── McpServer (SDK 提供)                    │
        ├── search_docs handler ◄── { indexer, store, formatter, logger }
        ├── get_endpoint handler ◄── { store, formatter, logger }
        └── list_apis handler ◄── { store, formatter, logger }
```

### 3.3 ServerContext の設計

ツールハンドラが共有する依存オブジェクトを 1 つの構造体にまとめる。

```typescript
/**
 * ツールハンドラに渡すコンテキスト。
 * 各ハンドラは必要なプロパティのみ参照する。
 *
 * 設計意図:
 * - ハンドラ関数を純粋関数（context を受け取り MCP レスポンスを返す）として設計
 * - テスト時にモックした context を注入可能
 * - 新しい依存が必要になった場合、context にプロパティを追加するだけ
 */
interface ServerContext {
  readonly indexer: Indexer;
  readonly store: DocumentStore;
  readonly configs: ReadonlyArray<SiteConfig>;
  readonly formatter: ResponseFormatter;
  readonly logger: Logger;
}
```

---

## 4. クラス詳細設計

### 4.1 Crawler クラス

```
┌──────────────────────────────────────────────────────┐
│                      Crawler                          │
├──────────────────────────────────────────────────────┤
│ - userAgent: string                                   │
│ - logger: Logger                                      │
├──────────────────────────────────────────────────────┤
│ + crawl(config, onProgress?): Promise<CrawlResult>   │
│ - fetchPage(url): Promise<string>                     │
│ - fetchRobotsTxt(origin): Promise<RobotsRule[]>       │
│ - extractLinks(html, baseUrl): string[]               │
│ - shouldVisit(url, config, robots): boolean            │
│ - delay(ms): Promise<void>                            │
├──────────────────────────────────────────────────────┤
│ 協調オブジェクト:                                      │
│   Logger (ログ出力)                                    │
│   node:fetch (HTTP リクエスト)                          │
│   AbortController (タイムアウト制御)                     │
└──────────────────────────────────────────────────────┘

内部状態管理:
- visited: Set<string>        — 訪問済み URL（クロール中のみ保持、完了後は破棄）
- queue: string[]             — クロール待ちキュー（BFS）
- pages: Map<string, string>  — URL→HTML のマッピング

メモリ管理:
- pages は CrawlResult として返却後、Crawler 内では参照を保持しない
- 1 ページあたり平均 50KB × 200 ページ = 約 10MB のピークメモリ使用
```

**リトライポリシーの設計**:

```typescript
interface RetryPolicy {
  maxRetries: 2;
  retryDelayMs: 3000;
  retryableStatuses: [500, 502, 503, 504];
  retryableErrors: ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND"];
}

// リトライ判定のフローチャート:
//
// fetchPage(url)
//   ├── 成功 (2xx) → HTML を返す
//   ├── 404 → CrawlError (リトライしない)
//   ├── 429 (Rate Limited) → Retry-After ヘッダーを尊重して待機 → リトライ
//   ├── 5xx → リトライカウンタ++
//   │   ├── カウンタ ≤ 2 → 3秒待機 → リトライ
//   │   └── カウンタ > 2 → CrawlError
//   └── ネットワークエラー → リトライカウンタ++
//       ├── カウンタ ≤ 2 → 3秒待機 → リトライ
//       └── カウンタ > 2 → CrawlError
```

### 4.2 SiteParser インターフェースと実装階層

```
<<interface>>
┌────────────────────────────────────────────────┐
│                   SiteParser                    │
├────────────────────────────────────────────────┤
│ + name: string {readonly}                       │
│ + extractEndpointUrls?($, pageUrl): EndpointUrl[] │
│ + parseEndpoint($, pageUrl, apiId): ParseResult │
└──────────────────────┬─────────────────────────┘
                       │ implements
          ┌────────────┼──────────────┐
          │            │              │
┌─────────▼──┐ ┌──────▼─────┐ ┌─────▼──────────┐
│ Kintone    │ │ Backlog    │ │ Generic        │
│ Parser     │ │ Parser     │ │ Parser         │
├────────────┤ ├────────────┤ ├────────────────┤
│ - normalize│ │ - splitByH3│ │ - selectors    │
│   Type()   │ │   ()       │ │   : Selectors  │
│ - parseSpe│ │ - parseBac│ │ - parseMeth   │
│   cTable() │ │   klogPar │ │   odAndPath() │
│ - parseKin│ │   ams()    │ │ - parseParam  │
│   toneParam│ │ - extract │ │   eterTable() │
│   Table()  │ │   MethodAn│ │ - parseCode   │
│ - parseKin│ │   dPath()  │ │   Blocks()    │
│   toneResp │ │ - parseBac│ │               │
│   Table()  │ │   klogResp│ │               │
│ - extractD│ │   onse()   │ │               │
│   esc()    │ │ - extract │ │               │
│ - parsePer│ │   Desc()   │ │               │
│   missions│ │            │ │               │
│   ()       │ │            │ │               │
│ - parseNot│ │            │ │               │
│   es()     │ │            │ │               │
└────────────┘ └────────────┘ └────────────────┘
```

**Strategy パターンの適用**:

```typescript
// パーサー選択の決定木:
//
// resolveParser(config)
//   │
//   ├── config.parser.type === "preset"
//   │     └── ParserRegistry.get(config.id)
//   │           ├── 存在する → そのパーサーを返す
//   │           └── 存在しない → ConfigError
//   │
//   ├── config.parser.type === "generic"
//   │     └── new GenericParser(config.parser.selectors)
//   │
//   └── (フォールバック)
//         └── new GenericParser(DEFAULT_SELECTORS)
```

### 4.3 ParserRegistry クラス

```typescript
/**
 * プリセットパーサーの登録と取得を管理する。
 *
 * 設計意図:
 * - プリセットの追加を OCP に従い、レジストリへの register のみで完結させる
 * - 将来的にプラグインシステムを導入する場合の拡張ポイント
 */
class ParserRegistry {
  private parsers: Map<string, SiteParser> = new Map();
  private configs: Map<string, PresetConfig> = new Map();

  /** ビルトインプリセットを一括登録する */
  registerPresets(): void {
    this.register("kintone", kintoneConfig, new KintoneParser());
    this.register("backlog", backlogConfig, new BacklogParser());
  }

  /** パーサーを登録する */
  register(id: string, config: PresetConfig, parser: SiteParser): void {
    this.parsers.set(id, parser);
    this.configs.set(id, config);
  }

  /** パーサーを取得する */
  getParser(id: string): SiteParser | undefined {
    return this.parsers.get(id);
  }

  /** 設定を取得する */
  getConfig(id: string): PresetConfig | undefined {
    return this.configs.get(id);
  }

  /** 全プリセット ID を返す */
  getIds(): string[] {
    return [...this.parsers.keys()];
  }
}
```

### 4.4 InitPipeline クラス

仕様書では `server.ts` 内のインラインロジックだった初期化パイプラインを独立クラスとして設計する。

```
┌─────────────────────────────────────────────────────┐
│                    InitPipeline                       │
├─────────────────────────────────────────────────────┤
│ - crawler: Crawler                                    │
│ - parserRegistry: ParserRegistry                      │
│ - store: DocumentStore                                │
│ - indexer: Indexer                                     │
│ - cacheManager: CacheManager                          │
│ - logger: Logger                                      │
├─────────────────────────────────────────────────────┤
│ + initializeAll(configs, refreshTarget?): Promise<void>│
│ - initializeSite(config, forceRefresh): Promise<void> │
│ - runPipeline(config): Promise<PipelineResult>        │
│ - loadFromCache(config): Promise<boolean>             │
├─────────────────────────────────────────────────────┤
│ 設計意図:                                             │
│ - 初期化フローのテストを server.ts から独立して実施可能  │
│ - クロール→パース→インデックスのオーケストレーションを   │
│   カプセル化                                          │
└─────────────────────────────────────────────────────┘
```

```typescript
class InitPipeline {
  constructor(private deps: InitPipelineDeps) {}

  /**
   * 全サイトを初期化する。
   * 各サイトの初期化は逐次実行（並列化はサイトへの負荷を考慮して見送り）。
   */
  async initializeAll(
    configs: SiteConfig[],
    refreshTarget?: string
  ): Promise<void> {
    for (const config of configs) {
      const forceRefresh = refreshTarget === config.id || refreshTarget === "*";
      try {
        await this.initializeSite(config, forceRefresh);
      } catch (err) {
        // 1 サイトの失敗は他サイトに影響しない
        this.deps.logger.error(
          `Failed to initialize ${config.id}: ${err instanceof Error ? err.message : err}`
        );
      }
    }
  }

  /**
   * 1 サイトの初期化。
   * キャッシュ有効 → ディスクからロード / 無効 → パイプライン実行
   */
  private async initializeSite(
    config: SiteConfig,
    forceRefresh: boolean
  ): Promise<void> {
    const configHash = computeConfigHash(config);

    if (!forceRefresh && this.deps.cacheManager.isCacheValid(config.id, configHash)) {
      await this.loadFromCache(config);
      this.deps.logger.info(`Loaded ${config.id} from cache`);
      return;
    }

    this.deps.logger.info(`Starting crawl for ${config.id}`);
    await this.runPipeline(config, configHash);
  }

  /**
   * クロール→パース→インデックス構築→キャッシュ保存のパイプラインを実行。
   */
  private async runPipeline(
    config: SiteConfig,
    configHash: string
  ): Promise<void> {
    const startTime = Date.now();

    // Step 1: クロール
    const crawlResult = await this.deps.crawler.crawl(config.crawl, (progress) => {
      if (progress.current % 10 === 0 || progress.current === 1) {
        this.deps.logger.info(
          `Crawling ${config.id}: ${progress.current}/${progress.total} pages`
        );
      }
    });

    // Step 2: パース
    const parser = this.deps.parserRegistry.getParser(config.id)
      ?? resolveParser(config);

    const documents: EndpointDocument[] = [];
    const warnings: string[] = [];

    for (const [url, html] of crawlResult.pages) {
      try {
        const $ = cheerio.load(html);
        const result = parser.parseEndpoint($, url, config.id);

        if (result.confidence >= 0.3) {
          documents.push(...result.documents);
        } else if (result.confidence > 0) {
          warnings.push(`Low confidence (${result.confidence}) for ${url}`);
        }

        if (result.warnings.length > 0) {
          warnings.push(...result.warnings.map((w) => `${url}: ${w}`));
        }
      } catch (err) {
        this.deps.logger.warn(`Parse error at ${url}: ${err}`);
      }
    }

    // Step 3: カテゴリ補完（extractEndpointUrls の結果がある場合）
    this.enrichCategories(parser, crawlResult, documents, config);

    // Step 4: インデックス構築
    this.deps.indexer.build(config.id, documents);

    // Step 5: ストアに保存
    this.deps.store.set(config.id, documents);

    // Step 6: キャッシュに永続化
    this.deps.cacheManager.save(config.id, {
      documents,
      indexJson: JSON.stringify(this.deps.indexer.getIndex(config.id)?.toJSON()),
      meta: {
        apiId: config.id,
        crawledAt: new Date().toISOString(),
        crawlDurationMs: Date.now() - startTime,
        pagesCrawled: crawlResult.stats.successCount,
        endpointsParsed: documents.length,
        indexSizeBytes: 0, // 保存後に計算
        serverVersion: version,
        configHash,
      },
    });

    this.deps.logger.info(
      `Completed ${config.id}: ${documents.length} endpoints in ${Date.now() - startTime}ms`
    );
    if (warnings.length > 0) {
      this.deps.logger.warn(`${warnings.length} warnings during parse`);
      this.deps.logger.debug(`Warnings: ${warnings.join("\n")}`);
    }
  }

  /**
   * extractEndpointUrls から得られたカテゴリ情報を
   * パース済みドキュメントに付与する。
   */
  private enrichCategories(
    parser: SiteParser,
    crawlResult: CrawlResult,
    documents: EndpointDocument[],
    config: SiteConfig
  ): void {
    if (!parser.extractEndpointUrls) return;

    // インデックスページの HTML を取得
    const indexHtml = crawlResult.pages.get(config.crawl.startUrl);
    if (!indexHtml) return;

    const $ = cheerio.load(indexHtml);
    const urlCategories = parser.extractEndpointUrls($, config.crawl.startUrl);

    // URL → カテゴリ のマップ
    const categoryMap = new Map<string, string>();
    for (const { url, category } of urlCategories) {
      if (category) categoryMap.set(url, category);
    }

    // ドキュメントの category を補完
    for (const doc of documents) {
      if (!doc.category || doc.category === "General") {
        const cat = categoryMap.get(doc.sourceUrl);
        if (cat) doc.category = cat;
      }
    }
  }

  /**
   * キャッシュからインデックスとドキュメントをロードする。
   */
  private async loadFromCache(config: SiteConfig): Promise<void> {
    const { documentsPath, indexPath } = this.deps.cacheManager.load(config.id);
    this.deps.store.loadFromDisk(config.id, documentsPath);
    this.deps.indexer.loadFromDisk(config.id, indexPath);
  }
}
```

### 4.5 Indexer クラス

```
┌────────────────────────────────────────────────────────────┐
│                        Indexer                              │
├────────────────────────────────────────────────────────────┤
│ - indexes: Map<string, MiniSearch<SearchableDocument>>      │
│ - logger: Logger                                            │
│ - segmenter: Intl.Segmenter | null                         │
├────────────────────────────────────────────────────────────┤
│ + build(apiId, documents): void                             │
│ + search(query, options): SearchHit[]                       │
│ + loadFromDisk(apiId, indexPath): void                      │
│ + saveToDisk(apiId, indexPath): void                        │
│ + getIndex(apiId): MiniSearch | undefined                   │
│ + remove(apiId): void                                       │
│ - tokenize(text): string[]                                  │
│ - segmenterTokenize(text): string[]                         │
│ - fallbackTokenize(text): string[]                          │
│ - processTerm(term): string | null                          │
│ - toSearchable(doc): SearchableDocument                     │
├────────────────────────────────────────────────────────────┤
│ 不変条件:                                                   │
│ - indexes マップのキーは apiId と 1:1                        │
│ - build 後は即座に search 可能                               │
│ - segmenter は constructor で 1 回だけ生成（パフォーマンス）  │
└────────────────────────────────────────────────────────────┘
```

**Intl.Segmenter のキャッシュ設計**:

```typescript
constructor(options: { logger: Logger }) {
  this.logger = options.logger;

  // Intl.Segmenter はインスタンス生成コストが高いため、
  // 初回に 1 つだけ生成して再利用する。
  try {
    this.segmenter = new Intl.Segmenter("ja", { granularity: "word" });
    this.logger.debug("Using Intl.Segmenter for Japanese tokenization");
  } catch {
    this.segmenter = null;
    this.logger.warn("Intl.Segmenter not available, using bigram fallback");
  }
}
```

### 4.6 DocumentStore クラス

```
┌────────────────────────────────────────────────────────┐
│                    DocumentStore                        │
├────────────────────────────────────────────────────────┤
│ - store: Map<string, EndpointDocument[]>                │
│ - docIndex: Map<string, EndpointDocument>               │
│ - metadata: Map<string, ApiMetadata>                    │
├────────────────────────────────────────────────────────┤
│ + set(apiId, documents): void                           │
│ + get(documentId): EndpointDocument | undefined         │
│ + getByApi(apiId): EndpointDocument[]                   │
│ + findSimilar(apiId, endpoint): EndpointDocument[]      │
│ + getAllApiSummaries(): ApiSummary[]                     │
│ + getApiDetail(apiId): ApiDetail | undefined            │
│ + totalEndpointCount(): number                          │
│ + loadFromDisk(apiId, documentsPath): void              │
│ + saveToDisk(apiId, documentsPath): void                │
│ + remove(apiId): void                                   │
├────────────────────────────────────────────────────────┤
│ 設計意図:                                               │
│ - docIndex は O(1) の ID 検索を実現するセカンダリインデックス │
│ - set 時に docIndex を自動構築（二重管理のトレードオフ）    │
│ - metadata は loadFromDisk 時に documents.json から抽出   │
└────────────────────────────────────────────────────────┘
```

**二重インデックスの設計**:

```typescript
set(apiId: string, documents: EndpointDocument[]): void {
  this.store.set(apiId, documents);

  // セカンダリインデックスの構築（ID → Document の O(1) ルックアップ）
  for (const doc of documents) {
    this.docIndex.set(doc.id, doc);
  }

  // メタデータの構築
  const categories = new Map<string, number>();
  for (const doc of documents) {
    categories.set(doc.category, (categories.get(doc.category) ?? 0) + 1);
  }
  this.metadata.set(apiId, {
    endpointCount: documents.length,
    categories: [...categories.entries()].map(([name, count]) => ({ name, endpointCount: count })),
  });
}
```

### 4.7 CacheManager クラス

```
┌────────────────────────────────────────────────────────┐
│                    CacheManager                         │
├────────────────────────────────────────────────────────┤
│ - cacheDir: string                                      │
│ - ttlMs: number                                         │
│ - logger: Logger                                        │
├────────────────────────────────────────────────────────┤
│ + isCacheValid(apiId, configHash): boolean              │
│ + load(apiId): CacheLoadResult                          │
│ + save(apiId, data): void                               │
│ + invalidate(apiId): void                               │
│ + clearAll(): void                                      │
│ + getCacheDir(apiId): string                            │
│ - ensureDir(dirPath): void                              │
│ - readMeta(apiId): CacheMeta | null                     │
└────────────────────────────────────────────────────────┘

ファイルシステム操作:
- 全 I/O は同期 API（readFileSync / writeFileSync）を使用
- 理由: 起動時に 1 回だけの操作であり、async の複雑性を避ける
- キャッシュサイズは 10〜30MB 程度で I/O ボトルネックにならない
```

### 4.8 ResponseFormatter クラス

```
┌────────────────────────────────────────────────────────┐
│                  ResponseFormatter                      │
├────────────────────────────────────────────────────────┤
│ (ステートレス — 依存なし)                                 │
├────────────────────────────────────────────────────────┤
│ + formatSearchResults(query, hits, docs, api?): string  │
│ + formatEndpointDetail(doc): string                     │
│ + formatApiList(summaries): string                      │
│ + formatApiDetail(detail): string                       │
│ + formatError(message, suggestions?): string            │
│ + formatNotFound(api, endpoint, method, similar): string│
│ - formatParamTable(params): string                      │
│ - formatFieldTable(fields): string                      │
│ - truncate(text, maxLen): string                        │
│ - formatExamples(examples): string                      │
├────────────────────────────────────────────────────────┤
│ 定数:                                                   │
│ - MAX_PARAMS_IN_DETAIL = 30                             │
│ - MAX_RESPONSE_FIELDS = 20                              │
│ - MAX_EXAMPLE_LENGTH = 1500                             │
│ - MAX_DESCRIPTION_LENGTH = 300                          │
│ - MAX_NOTES = 5                                         │
│ - MAX_ENDPOINTS_PER_CATEGORY = 10                       │
│ - MAX_TOTAL_ENDPOINTS_IN_LIST = 50                      │
└────────────────────────────────────────────────────────┘

設計意図:
- 完全にステートレスな純粋関数の集合
- 入力: ドメインオブジェクト → 出力: Markdown テキスト
- テスト容易性が高い（モック不要、入出力の一致のみ検証）
```

### 4.9 ツールハンドラの設計

ツールハンドラは純粋関数として設計する。

```typescript
/**
 * ツールハンドラの型定義。
 * McpServer.tool() に渡すコールバック関数のラッパー。
 *
 * 設計意図:
 * - context を引数として受け取る純粋関数
 * - McpServer への登録はアダプターパターンで接続
 * - テスト時は context をモックするだけで検証可能
 */
type ToolHandler<TInput> = (
  input: TInput,
  context: ServerContext
) => Promise<ToolResult>;

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

// ハンドラの登録（アダプター）
function registerTools(mcpServer: McpServer, context: ServerContext): void {
  mcpServer.tool(
    "search_docs",
    "Search API documentation by keyword...",
    searchDocsSchema,
    async (input) => handleSearchDocs(input, context)
  );

  mcpServer.tool(
    "get_endpoint",
    "Get detailed information about a specific API endpoint...",
    getEndpointSchema,
    async (input) => handleGetEndpoint(input, context)
  );

  mcpServer.tool(
    "list_apis",
    "List all available APIs and their endpoint categories...",
    listApisSchema,
    async (input) => handleListApis(input, context)
  );
}
```

---

## 5. シーケンス設計

### 5.1 サーバー起動シーケンス（キャッシュあり）

```
main          createServer      CacheManager    Store       Indexer     McpServer
  │               │                 │             │           │            │
  │ createServer()│                 │             │           │            │
  │──────────────►│                 │             │           │            │
  │               │                 │             │           │            │
  │               │ isCacheValid()  │             │           │            │
  │               │────────────────►│             │           │            │
  │               │    true         │             │           │            │
  │               │◄────────────────│             │           │            │
  │               │                 │             │           │            │
  │               │ load()          │             │           │            │
  │               │────────────────►│             │           │            │
  │               │  paths          │             │           │            │
  │               │◄────────────────│             │           │            │
  │               │                 │             │           │            │
  │               │           loadFromDisk()      │           │            │
  │               │──────────────────────────────►│           │            │
  │               │                               │  OK       │            │
  │               │◄──────────────────────────────│           │            │
  │               │                 │             │           │            │
  │               │                loadFromDisk() │           │            │
  │               │───────────────────────────────────────────►            │
  │               │                               │  OK       │            │
  │               │◄──────────────────────────────────────────│            │
  │               │                 │             │           │            │
  │               │      registerTools()          │           │            │
  │               │───────────────────────────────────────────────────────►│
  │               │                               │           │   OK       │
  │               │◄──────────────────────────────────────────────────────│
  │               │                 │             │           │            │
  │   { start }   │                 │             │           │            │
  │◄──────────────│                 │             │           │            │
  │               │                 │             │           │            │
  │ start()       │                 │             │           │            │
  │──────────────►│ StdioServerTransport.connect()│           │            │
  │               │───────────────────────────────────────────────────────►│
  │               │                               │           │  ready     │
  │◄──────────────│                               │           │            │
```

**所要時間の見積もり**: キャッシュから 2 API をロードする場合、合計約 1〜2 秒。

### 5.2 サーバー起動シーケンス（初回クロール）

```
main       Pipeline     Crawler     Parser      Store      Indexer    Cache
  │           │            │          │           │          │          │
  │ initSite()│            │          │           │          │          │
  │──────────►│            │          │           │          │          │
  │           │ crawl()    │          │           │          │          │
  │           │───────────►│          │           │          │          │
  │           │            │          │           │          │          │
  │           │            │ fetch(startUrl)      │          │          │
  │           │            │───►(HTTP)│           │          │          │
  │           │            │◄───      │           │          │          │
  │           │            │ extractLinks         │          │          │
  │           │            │───►      │           │          │          │
  │           │            │ delay(1000ms)        │          │          │
  │           │            │───►      │           │          │          │
  │           │            │ fetch(page2)         │          │          │
  │           │            │───►(HTTP)│           │          │          │
  │           │            │◄───      │           │          │          │
  │           │            │   ...（maxPages 回繰り返し）     │          │
  │           │            │          │           │          │          │
  │           │  CrawlResult          │           │          │          │
  │           │◄───────────│          │           │          │          │
  │           │            │          │           │          │          │
  │           │ for each page:        │           │          │          │
  │           │  parseEndpoint()      │           │          │          │
  │           │──────────────────────►│           │          │          │
  │           │  ParseResult          │           │          │          │
  │           │◄──────────────────────│           │          │          │
  │           │            │          │           │          │          │
  │           │ set(apiId, docs)      │           │          │          │
  │           │──────────────────────────────────►│          │          │
  │           │            │          │           │          │          │
  │           │ build(apiId, docs)    │           │          │          │
  │           │────────────────────────────────────────────►│          │
  │           │            │          │           │          │          │
  │           │ save(apiId, {...})    │           │          │          │
  │           │────────────────────────────────────────────────────────►│
  │           │            │          │           │          │          │
  │  done     │            │          │           │          │          │
  │◄──────────│            │          │           │          │          │
```

**所要時間の見積もり**: kintone 約 85 ページ（delayMs=1000）で約 90 秒 + パース・インデックス構築 5 秒。

### 5.3 search_docs ツール呼び出しシーケンス

```
McpClient    McpServer    SearchDocsHandler    Indexer       Store      Formatter
  │             │               │                │            │           │
  │ search_docs │               │                │            │           │
  │ {query,api} │               │                │            │           │
  │────────────►│               │                │            │           │
  │             │ handler()     │                │            │           │
  │             │──────────────►│                │            │           │
  │             │               │                │            │           │
  │             │               │ search(query)  │            │           │
  │             │               │───────────────►│            │           │
  │             │               │  SearchHit[]   │            │           │
  │             │               │◄───────────────│            │           │
  │             │               │                │            │           │
  │             │               │ for each hit:  │            │           │
  │             │               │  get(hit.id)   │            │           │
  │             │               │───────────────────────────►│           │
  │             │               │  EndpointDoc   │            │           │
  │             │               │◄───────────────────────────│           │
  │             │               │                │            │           │
  │             │               │ formatSearchResults()      │           │
  │             │               │──────────────────────────────────────►│
  │             │               │  formatted text│            │           │
  │             │               │◄─────────────────────────────────────│
  │             │               │                │            │           │
  │             │  ToolResult   │                │            │           │
  │             │◄──────────────│                │            │           │
  │  response   │               │                │            │           │
  │◄────────────│               │                │            │           │
```

**レスポンス時間の見積もり**: MiniSearch 検索 < 10ms + Store 参照 < 1ms + フォーマット < 5ms = **合計 < 20ms**

### 5.4 get_endpoint ツール呼び出しシーケンス（ヒット / 未ヒット）

```
McpClient    GetEndpointHandler    Store          Formatter
  │               │                  │               │
  │ get_endpoint  │                  │               │
  │──────────────►│                  │               │
  │               │                  │               │
  │               │ get(docId)       │               │
  │               │─────────────────►│               │
  │               │                  │               │
  │  ┌────────── [found] ──────────┐ │               │
  │  │            │  document       │ │               │
  │  │            │◄────────────────│ │               │
  │  │            │                  │               │
  │  │            │ formatEndpointDetail()           │
  │  │            │─────────────────────────────────►│
  │  │            │  text            │               │
  │  │            │◄─────────────────────────────────│
  │  │            │                  │               │
  │  └────────────┼──────────────────┘               │
  │               │                  │               │
  │  ┌────────── [not found] ──────┐ │               │
  │  │            │  undefined      │ │               │
  │  │            │◄────────────────│ │               │
  │  │            │                  │               │
  │  │            │ findSimilar()    │               │
  │  │            │─────────────────►│               │
  │  │            │  similar[]       │               │
  │  │            │◄─────────────────│               │
  │  │            │                  │               │
  │  │            │ formatNotFound() │               │
  │  │            │─────────────────────────────────►│
  │  │            │  suggestion text │               │
  │  │            │◄─────────────────────────────────│
  │  └────────────┼──────────────────┘               │
  │               │                  │               │
  │  ToolResult   │                  │               │
  │◄──────────────│                  │               │
```

---

## 6. データフロー設計

### 6.1 パイプラインのデータ変換フロー

```
[外部サイト HTML]
       │
       │ Crawler.crawl()
       ▼
Map<URL, HTML string>            ← CrawlResult.pages
       │
       │ cheerio.load() + SiteParser.parseEndpoint()
       ▼
EndpointDocument[]               ← 構造化ドキュメント
       │
       ├──────────────────────────────────────────────┐
       │                                              │
       │ Indexer.build()                              │ Store.set()
       ▼                                              ▼
MiniSearch<SearchableDocument>            Map<apiId, EndpointDocument[]>
       │                                              │
       │ MiniSearch.toJSON()                          │ JSON.stringify()
       ▼                                              ▼
index.json (on disk)                     documents.json (on disk)
```

### 6.2 EndpointDocument の生成ステップ

HTML の各要素がどのフィールドにマッピングされるかを示す。

```
kintone の場合:

HTML 要素                          EndpointDocument フィールド
─────────────────────────────      ──────────────────────────
<h1>レコードを取得する</h1>    →   title: "レコードを取得する"

<table> (仕様テーブル)              method: "GET"
  行: HTTPメソッド | GET         →  path: "/k/v1/record.json"
  行: URL | https://...         →  authentication: ["Password", "API Token", ...]
  行: 認証 | ...

h1〜最初のtable間テキスト       →  description: "..."

<table> (パラメータ名|型|必須|説明)  parameters: [
  行: app | 数値 | 必須 | ...   →    { name: "app", type: "number", required: true, ... }
  行: id  | 数値 |      | ...   →    { name: "id", type: "number", required: false, ... }
                                    ]

<table> (プロパティ名|型|説明)       responseFields: [
  行: record | オブジェクト | ...→    { name: "record", type: "object", ... }
                                    ]

<pre><code>{JSON}</code></pre>  →  examples: [
                                      { type: "request", format: "json", content: "..." }
                                    ]

h2/h3: 権限                     →  permissions: ["..."]
h2/h3: 補足/注意                →  notes: ["..."]
```

### 6.3 検索のデータフロー

```
ユーザー入力: query="レコード 取得"

  │
  │ tokenize()
  ▼

トークン列: ["レコード", "取得"]
  ※ Intl.Segmenter により日本語を単語単位で分割

  │
  │ processTerm()
  ▼

正規化トークン: ["レコード", "取得"]
  ※ ストップワード除去、小文字化

  │
  │ MiniSearch.search()
  ▼

スコア付き結果 (内部):
  [
    { id: "kintone:GET:/k/v1/record.json",   score: 8.5, match: {title: ["レコード","取得"]} },
    { id: "kintone:POST:/k/v1/record.json",  score: 6.2, match: {title: ["レコード"]} },
    { id: "kintone:GET:/k/v1/records.json",   score: 5.8, match: {title: ["レコード","取得"]} },
  ]

  │
  │ boost 適用: title ×3, path ×2, parameterNames ×1.5
  │ fuzzy (0.2): 編集距離20%以内の類似語もヒット
  │ prefix: 前方一致も検索対象
  ▼

SearchHit[]:
  [
    { id: "kintone:GET:/k/v1/record.json", score: 25.5, apiId: "kintone", ... },
    { id: "kintone:GET:/k/v1/records.json", score: 17.4, apiId: "kintone", ... },
    { id: "kintone:POST:/k/v1/record.json", score: 18.6, apiId: "kintone", ... },
  ]

  │
  │ スコア降順ソート + limit 適用
  ▼

最終結果: 上位 5 件

  │
  │ ResponseFormatter.formatSearchResults()
  ▼

MCP レスポンステキスト (Markdown)
```

---

## 7. 状態管理設計

### 7.1 サーバーのライフサイクル状態

```
                            ┌───────────────┐
                            │  NOT_STARTED  │
                            └───────┬───────┘
                                    │ createServer() 呼び出し
                                    ▼
                            ┌───────────────┐
                            │ INITIALIZING  │
                            │               │
                            │ - プリセットロード │
                            │ - 設定読み込み   │
                            │ - キャッシュ判定  │
                            │ - (クロール)     │
                            └───────┬───────┘
                                    │ 初期化完了
                                    ▼
                            ┌───────────────┐
                            │    READY      │
                            │               │
                            │ - ツール登録済み │
                            │ - 検索可能      │
                            └───────┬───────┘
                                    │ start() 呼び出し
                                    ▼
                            ┌───────────────┐
                            │   RUNNING     │◄──┐
                            │               │   │ ツール呼び出し
                            │ - MCP通信中    │───┘
                            │ - ツール応答中  │
                            └───────┬───────┘
                                    │ プロセス終了 (SIGTERM / SIGINT / stdin EOF)
                                    ▼
                            ┌───────────────┐
                            │  TERMINATED   │
                            └───────────────┘
```

### 7.2 初期化パイプラインの状態（サイトごと）

```
┌─────────┐    キャッシュ有効    ┌────────────┐
│ PENDING │───────────────────►│ CACHE_LOAD │
└────┬────┘                    └─────┬──────┘
     │                               │ ロード成功
     │ キャッシュ無効/期限切れ          ▼
     │                         ┌────────────┐
     ▼                         │   READY    │
┌──────────┐                   └────────────┘
│ CRAWLING │                         ▲
└────┬─────┘                         │
     │ クロール完了                    │
     ▼                               │
┌──────────┐                         │
│ PARSING  │                         │
└────┬─────┘                         │
     │ パース完了                     │
     ▼                               │
┌──────────┐                         │
│ INDEXING │                         │
└────┬─────┘                         │
     │ インデックス構築完了            │
     ▼                               │
┌──────────┐                         │
│ CACHING  │─── 保存完了 ────────────┘
└────┬─────┘
     │ 保存失敗（ただしインメモリインデックスは有効）
     ▼
┌──────────┐
│ READY    │ (キャッシュなし。次回起動時に再クロール)
│ (DEGRADED)│
└──────────┘

エラー発生時:
- CRAWLING 中の全失敗 → FAILED (その API のみ。サーバーは起動)
- PARSING 中のエラー → 該当ページスキップ、他は続行
- INDEXING 中のエラー → FAILED (致命的)
```

### 7.3 インメモリ状態の一覧

| コンポーネント | 状態 | ライフサイクル |
|---|---|---|
| `DocumentStore.store` | `Map<apiId, EndpointDocument[]>` | サーバー起動時に構築、以降は読み取り専用 |
| `DocumentStore.docIndex` | `Map<docId, EndpointDocument>` | `store` の変更に連動して再構築 |
| `Indexer.indexes` | `Map<apiId, MiniSearch>` | サーバー起動時に構築、以降は読み取り専用 |
| `Crawler` 内部 | `visited`, `queue`, `pages` | `crawl()` 呼び出し中のみ存在 |
| `ServerContext` | 全依存オブジェクトへの参照 | サーバー生存期間全体 |

**メモリ使用量の見積もり**:

| データ | 1 API あたり | 2 API 合計 |
|---|---|---|
| EndpointDocument[] (メモリ) | 5〜15 MB | 10〜30 MB |
| docIndex (参照のみ) | ~0 MB (参照) | ~0 MB |
| MiniSearch インデックス | 2〜5 MB | 4〜10 MB |
| **合計** | 7〜20 MB | **14〜40 MB** |

---

## 8. ファイルシステム・ストレージ設計

### 8.1 ディレクトリレイアウト

```
~/.mcp-api-reference/                    ← ベースディレクトリ
├── cache/                                ← キャッシュルート
│   ├── kintone/                          ← API ごとのサブディレクトリ
│   │   ├── meta.json                     ← クロールメタデータ (< 1 KB)
│   │   ├── documents.json                ← EndpointDocument[] (2〜10 MB)
│   │   └── index.json                    ← MiniSearch シリアライズ (1〜5 MB)
│   └── backlog/
│       ├── meta.json
│       ├── documents.json
│       └── index.json
└── (将来: logs/, config/ など)
```

### 8.2 ファイル I/O のタイミング

| 操作 | タイミング | 方式 | 理由 |
|---|---|---|---|
| キャッシュ読み込み (meta.json) | 起動時 | **同期** (readFileSync) | 起動シーケンスの最初で実行。非同期にする利点なし |
| キャッシュ読み込み (documents.json, index.json) | 起動時 | **同期** | 同上。ファイルサイズ < 15MB で I/O < 100ms |
| キャッシュ書き込み (全ファイル) | クロール完了時 | **同期** | クロール直後に 1 回のみ。次のステップ（ツール登録）の前に完了する必要がある |
| クリアキャッシュ (--clear-cache) | CLI 実行時 | **同期** | 実行後即座に process.exit |

### 8.3 ファイルの原子的書き込み

キャッシュファイルの書き込み中に電源断やプロセスキルが発生した場合のデータ破損を防ぐため、write-then-rename パターンを採用する。

```typescript
function atomicWriteSync(filePath: string, content: string): void {
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, content, "utf-8");
  renameSync(tmpPath, filePath);
}
```

**適用箇所**: `CacheManager.save()` 内のすべてのファイル書き込み。

### 8.4 ディレクトリの自動作成

```typescript
function ensureDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true });
}
```

`CacheManager` の `save()` と `getCacheDir()` で使用。`recursive: true` により中間ディレクトリも自動作成。

### 8.5 OS 別パスの解決

```typescript
function defaultCacheDir(): string {
  // 環境変数で上書き可能
  if (process.env.MCP_API_REF_CACHE_DIR) {
    return process.env.MCP_API_REF_CACHE_DIR;
  }

  // OS 共通: ホームディレクトリ配下
  const home = process.env.HOME
    ?? process.env.USERPROFILE
    ?? os.homedir();

  return path.join(home, ".mcp-api-reference", "cache");
}

// 結果:
// Linux/macOS: /home/user/.mcp-api-reference/cache
// Windows:     C:\Users\user\.mcp-api-reference\cache
```

---

## 9. エラーハンドリング設計

### 9.1 エラー伝搬のレイヤーモデル

```
Infrastructure Layer     Domain Layer          Application Layer     Protocol Layer
(Crawler, FS)           (Pipeline, Indexer)   (Tool Handlers)       (McpServer)
     │                       │                      │                    │
     │ CrawlError           │ 内部処理              │                    │
     │──────────────────────►│                      │                    │
     │                       │ ログ出力 + スキップ    │                    │
     │                       │ or リトライ           │                    │
     │                       │                      │                    │
     │                       │ ParseError           │                    │
     │                       │────────────────────► │                    │
     │                       │                      │ formatError()      │
     │                       │                      │───────────────────►│
     │                       │                      │                    │ ToolResult
     │                       │                      │                    │ (text/isError)
     │                       │                      │                    │────► Client

ルール:
1. Infrastructure Layer のエラーは Domain Layer で catch し、
   recoverable なら処理を続行する
2. Domain Layer のエラーが Application Layer に到達するのは
   致命的なケース（インデックス未構築など）のみ
3. Application Layer は常に ToolResult を返す
   （例外を Protocol Layer に漏らさない）
4. Protocol Layer の例外は McpServer SDK が処理する
```

### 9.2 ツールハンドラのエラーハンドリングパターン

```typescript
async function handleSearchDocs(
  input: SearchDocsInput,
  context: ServerContext
): Promise<ToolResult> {
  try {
    // --- 入力検証（Zod で自動実施済みだが、追加チェック） ---
    if (input.api && !context.store.hasApi(input.api)) {
      // ユーザー入力エラー: isError=false で修正方法を提案
      const available = context.store.getApiIds();
      return {
        content: [{
          type: "text",
          text: context.formatter.formatError(
            `API '${input.api}' not found.`,
            [`Available APIs: ${available.join(", ")}`]
          ),
        }],
      };
    }

    // --- 正常系 ---
    const hits = context.indexer.search(input.query, {
      apiId: input.api,
      limit: input.limit,
    });

    if (hits.length === 0) {
      // 結果なし: isError=false で代替案を提案
      return {
        content: [{
          type: "text",
          text: context.formatter.formatError(
            `No results found for "${input.query}"`,
            [
              "Try different keywords",
              "Use list_apis() to see available APIs",
            ]
          ),
        }],
      };
    }

    // 検索結果のフォーマット
    const docs = new Map<string, EndpointDocument>();
    for (const hit of hits) {
      const doc = context.store.get(hit.id);
      if (doc) docs.set(hit.id, doc);
    }

    return {
      content: [{
        type: "text",
        text: context.formatter.formatSearchResults(
          input.query, hits, docs, input.api
        ),
      }],
    };
  } catch (err) {
    // --- システムエラー: isError=true ---
    context.logger.error(`search_docs error: ${err}`);
    return {
      isError: true,
      content: [{
        type: "text",
        text: `Internal error in search_docs: ${err instanceof Error ? err.message : "Unknown error"}`,
      }],
    };
  }
}
```

### 9.3 起動時エラーの graceful degradation

```
┌─────────────────────────────────────────────────────────────┐
│ 起動時エラーの degradation マトリクス                          │
├──────────────────────┬──────────────────────────────────────┤
│ エラー               │ 挙動                                  │
├──────────────────────┼──────────────────────────────────────┤
│ 1 API のクロール完全失敗 │ 他の API は正常起動。                │
│                      │ 失敗した API への検索は "API not       │
│                      │ indexed" を返す                       │
├──────────────────────┼──────────────────────────────────────┤
│ 全 API のクロール失敗   │ サーバーは起動する。                  │
│                      │ 全ツールが "No APIs indexed" を返す    │
│                      │ ← MCP プロトコルレベルの起動は成功     │
├──────────────────────┼──────────────────────────────────────┤
│ カスタム設定ファイル    │ 警告ログ出力。                       │
│ の読み込み失敗        │ プリセットのみで起動                    │
├──────────────────────┼──────────────────────────────────────┤
│ キャッシュの破損       │ キャッシュを無効化し再クロール。        │
│                      │ ディスク上のファイルは上書き             │
├──────────────────────┼──────────────────────────────────────┤
│ ホームディレクトリ     │ キャッシュなしで動作（起動は遅い）。     │
│ の書き込み権限なし     │ 毎回クロール                          │
└──────────────────────┴──────────────────────────────────────┘
```

---

## 10. 横断的関心事

### 10.1 ロギング設計

```typescript
/**
 * Logger の設計:
 *
 * 1. 出力先: 全て stderr（stdout は MCP 専用）
 * 2. フォーマット: [prefix] [LEVEL] timestamp message
 * 3. 構造化データ: JSON.stringify でシリアライズ
 * 4. レベル制御: 環境変数 MCP_API_REF_LOG_LEVEL で設定
 * 5. パフォーマンス: debug レベルが無効時、シリアライズをスキップ
 */

class Logger {
  private readonly levelOrder = { debug: 0, info: 1, warn: 2, error: 3 };
  private readonly currentLevel: number;

  constructor(
    level: LogLevel,
    private prefix: string
  ) {
    this.currentLevel = this.levelOrder[level];
  }

  debug(message: string, data?: unknown): void {
    if (this.currentLevel > 0) return; // debug が無効なら即リターン
    this.write("DEBUG", message, data);
  }

  info(message: string, data?: unknown): void {
    if (this.currentLevel > 1) return;
    this.write("INFO", message, data);
  }

  warn(message: string, data?: unknown): void {
    if (this.currentLevel > 2) return;
    this.write("WARN", message, data);
  }

  error(message: string, data?: unknown): void {
    this.write("ERROR", message, data);
  }

  private write(level: string, message: string, data?: unknown): void {
    const timestamp = new Date().toISOString();
    const line = `[${this.prefix}] [${level.padEnd(5)}] ${timestamp} ${message}`;
    if (data !== undefined) {
      console.error(line, typeof data === "string" ? data : JSON.stringify(data));
    } else {
      console.error(line);
    }
  }
}
```

### 10.2 設定値の解決優先度

```
優先度（高い順）:

1. CLI 引数          --config /path/to/config.json
2. 環境変数          MCP_API_REF_CONFIG=/path/to/config.json
3. デフォルト値      (組み込み)

解決フロー:
┌──────────┐    ┌──────────┐    ┌──────────────┐
│ CLI 引数 │───►│ 環境変数 │───►│ デフォルト値  │
│ (最優先) │    │ (次優先) │    │ (フォールバック)│
└──────────┘    └──────────┘    └──────────────┘

マージ戦略:
- プリセット設定: MCP_API_REF_PRESETS で有効なもののみフィルタ
- カスタムサイト設定: CLI --config > ENV MCP_API_REF_CONFIG
- 同一 ID のプリセットとカスタムサイト: カスタムサイトが上書き（警告ログ）
```

```typescript
function loadConfigs(options: ServerOptions): SiteConfig[] {
  // 1. プリセットの読み込み
  const enabledPresets = resolveEnabledPresets();
  const presetConfigs = enabledPresets.map((id) =>
    parserRegistry.getConfig(id)
  ).filter(Boolean);

  // 2. カスタムサイトの読み込み
  const configPath = options.configPath
    ?? process.env.MCP_API_REF_CONFIG
    ?? undefined;

  let customConfigs: SiteConfig[] = [];
  if (configPath) {
    customConfigs = loadCustomSites(configPath);
  }

  // 3. マージ（カスタムが同一 ID のプリセットを上書き）
  const merged = new Map<string, SiteConfig>();
  for (const config of presetConfigs) {
    merged.set(config.id, config);
  }
  for (const config of customConfigs) {
    if (merged.has(config.id)) {
      logger.warn(`Custom site '${config.id}' overrides preset`);
    }
    merged.set(config.id, config);
  }

  return [...merged.values()];
}
```

### 10.3 プロセスシグナルハンドリング

```typescript
// src/index.ts

// Graceful shutdown
process.on("SIGTERM", () => {
  console.error("[mcp-api-reference] Received SIGTERM, shutting down");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.error("[mcp-api-reference] Received SIGINT, shutting down");
  process.exit(0);
});

// Unhandled rejection（デバッグ用ログ出力）
process.on("unhandledRejection", (reason) => {
  console.error("[mcp-api-reference] Unhandled rejection:", reason);
  // クラッシュさせない（MCP サーバーは可能な限り稼働し続ける）
});
```

### 10.4 バージョン管理

```typescript
// package.json から読み取り
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

// 使用箇所:
// - McpServer の version フィールド
// - Crawler の User-Agent ヘッダー
// - CacheMeta の serverVersion
// - --version CLI オプション（将来追加候補）
```

---

## 11. 拡張性設計

### 11.1 新規プリセット追加のチェックリスト

新しいプリセットを追加する場合の手順と影響範囲を明確にする。

```
1. 新規ファイル作成:
   src/presets/{id}/config.ts    ← PresetConfig をエクスポート
   src/presets/{id}/parser.ts    ← SiteParser を implements するクラスをエクスポート

2. 既存ファイル変更:
   src/presets/index.ts          ← register() 呼び出しを追加（1 行）

3. テストファイル作成:
   tests/presets/{id}.test.ts    ← パーサーのユニットテスト
   tests/fixtures/{id}/          ← HTML フィクスチャ

4. 変更が不要なファイル:
   src/server.ts                 ← ParserRegistry 経由で自動的にロードされる
   src/tools/*.ts                ← ツールハンドラは API ID に依存しない
   src/core/*.ts                 ← コアモジュールはプリセットに依存しない
```

### 11.2 拡張ポイントの設計

```
拡張ポイント ①: パーサーの追加
─────────────────────────────
SiteParser インターフェースを実装し、ParserRegistry に登録するだけで完了。
コアモジュールへの変更は不要。

拡張ポイント ②: 検索エンジンの差し替え
────────────────────────────────────
Indexer クラスが検索エンジンをカプセル化。
将来的に MiniSearch 以外（例: セマンティック検索）を導入する場合:

<<interface>>
┌──────────────────────────┐
│      SearchEngine        │
│ + build(docs): void      │
│ + search(query): Hit[]   │
│ + serialize(): string    │
│ + load(data): void       │
└───────────┬──────────────┘
            │ implements
     ┌──────┴──────┐
     │             │
┌────▼────┐ ┌─────▼────────┐
│MiniSearch│ │ Semantic     │
│Adapter   │ │ SearchAdapter│
│(現在)    │ │ (将来)        │
└──────────┘ └──────────────┘

注: Phase 1 では Indexer が MiniSearch を直接使用する。
インターフェース抽象化は Phase 3 で検討（YAGNI 原則）。

拡張ポイント ③: 出力フォーマットの追加
──────────────────────────────────
ResponseFormatter は現在 Markdown テキストのみ出力。
将来的に JSON 構造化レスポンスが必要になった場合:

<<interface>>
┌──────────────────────────┐
│    OutputFormatter       │
│ + formatSearchResults()  │
│ + formatEndpointDetail() │
│ + formatApiList()        │
└───────────┬──────────────┘
            │
     ┌──────┴──────┐
     │             │
┌────▼──────┐ ┌───▼──────────┐
│ Markdown  │ │ JSON         │
│ Formatter │ │ Formatter    │
│ (現在)    │ │ (将来)        │
└───────────┘ └──────────────┘

注: Phase 1 では ResponseFormatter を直接使用。
```

### 11.3 プラグインシステムの設計方針（将来）

Phase 1 では実装しないが、将来のプラグインシステムの設計方針を記録する。

```
設計方針:
- プラグインはローカルの .js ファイルをパスで指定する方式
- npm パッケージとしてのプラグインはセキュリティリスクが高いため非推奨
- プラグインが提供できるもの: SiteParser の実装のみ（スコープ限定）
- 設定例:

{
  "sites": [{
    "id": "my-api",
    "parser": {
      "type": "plugin",
      "pluginPath": "./my-parser.js"  // ← ローカルファイル
    }
  }]
}

セキュリティ考慮:
- pluginPath は絶対パスまたは設定ファイルからの相対パス
- file:// 以外のプロトコルは拒否
- プラグインは SiteParser インターフェースに準拠するか Zod で検証
```

---

## 12. テスト設計

### 12.1 テストのディレクトリ構成

```
tests/
├── unit/                          # ユニットテスト
│   ├── core/
│   │   ├── crawler.test.ts        # URL マッチ、robots.txt パース
│   │   ├── parser.test.ts         # GenericParser のパースロジック
│   │   ├── indexer.test.ts        # トークナイザー、インデックス構築、検索
│   │   ├── store.test.ts          # CRUD、あいまい検索
│   │   ├── cache.test.ts          # キャッシュ有効性判定
│   │   └── pipeline.test.ts       # パイプラインのオーケストレーション
│   ├── presets/
│   │   ├── kintone.test.ts        # kintone パーサー
│   │   └── backlog.test.ts        # Backlog パーサー
│   ├── formatters/
│   │   └── response.test.ts       # レスポンスフォーマッター
│   ├── tools/
│   │   ├── search-docs.test.ts    # search_docs ハンドラ
│   │   ├── get-endpoint.test.ts   # get_endpoint ハンドラ
│   │   └── list-apis.test.ts      # list_apis ハンドラ
│   └── utils/
│       ├── glob.test.ts           # glob → regex 変換
│       └── hash.test.ts           # 設定ハッシュ
│
├── integration/                   # インテグレーションテスト
│   ├── pipeline.test.ts           # クロール→パース→インデックスの統合テスト
│   └── tools.test.ts              # ツールハンドラのE2E（ハンドラ直接呼び出し）
│
├── e2e/                           # E2E テスト
│   └── mcp-server.test.ts         # stdio 経由の MCP 通信テスト
│
├── fixtures/                      # テストフィクスチャ
│   ├── kintone/
│   │   ├── index.html
│   │   ├── get-record.html
│   │   ├── add-record.html
│   │   ├── get-records.html
│   │   └── get-app.html
│   ├── backlog/
│   │   ├── index.html
│   │   ├── get-issue.html
│   │   ├── add-issue.html
│   │   ├── get-issue-list.html
│   │   └── get-project-list.html
│   └── generic/
│       ├── simple-api.html        # 汎用パーサー用の単純なHTML
│       └── complex-api.html       # 汎用パーサー用の複雑なHTML
│
└── helpers/                       # テストユーティリティ
    ├── mock-context.ts            # ServerContext のモックファクトリ
    ├── fixture-loader.ts          # HTML フィクスチャのローダー
    └── assertions.ts              # カスタムアサーション
```

### 12.2 モックの設計戦略

| コンポーネント | テスト対象 | モック対象 | モック手法 |
|---|---|---|---|
| ツールハンドラ | ハンドラ関数 | ServerContext (indexer, store, formatter) | `mock-context.ts` でファクトリ関数を提供 |
| InitPipeline | パイプライン全体 | Crawler (HTTP) | Crawler をモックし、フィクスチャ HTML を返す |
| Indexer | 検索ロジック | なし（MiniSearch を直接使用） | 実データでテスト |
| パーサー | パースロジック | なし（cheerio を直接使用） | HTML フィクスチャ入力 |
| CacheManager | キャッシュ判定 | ファイルシステム | vitest の `vi.mock("node:fs")` |
| Crawler | URL マッチ、リンク抽出 | fetch (HTTP) | `vi.fn()` でレスポンスをモック |

**ServerContext のモックファクトリ**:

```typescript
// tests/helpers/mock-context.ts

import { vi } from "vitest";
import type { ServerContext } from "../../src/server.js";

export function createMockContext(
  overrides?: Partial<ServerContext>
): ServerContext {
  return {
    indexer: {
      search: vi.fn().mockReturnValue([]),
      build: vi.fn(),
      ...overrides?.indexer,
    } as any,
    store: {
      get: vi.fn().mockReturnValue(undefined),
      getByApi: vi.fn().mockReturnValue([]),
      findSimilar: vi.fn().mockReturnValue([]),
      getAllApiSummaries: vi.fn().mockReturnValue([]),
      hasApi: vi.fn().mockReturnValue(true),
      ...overrides?.store,
    } as any,
    formatter: new ResponseFormatter(),
    configs: [],
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as any,
    ...overrides,
  };
}
```

### 12.3 テストケースの設計方針

**パーサーのテスト**: 入出力ベース

```typescript
// tests/unit/presets/kintone.test.ts

describe("KintoneParser", () => {
  const parser = new KintoneParser();
  const fixtures = loadFixtures("kintone");

  describe("parseEndpoint", () => {
    it("should parse GET /k/v1/record.json page correctly", () => {
      const $ = cheerio.load(fixtures["get-record.html"]);
      const result = parser.parseEndpoint($, "https://...", "kintone");

      expect(result.confidence).toBeGreaterThanOrEqual(0.8);
      expect(result.documents).toHaveLength(1);

      const doc = result.documents[0];
      expect(doc.method).toBe("GET");
      expect(doc.path).toBe("/k/v1/record.json");
      expect(doc.title).toBe("レコードを取得する");
      expect(doc.parameters).toContainEqual(
        expect.objectContaining({ name: "app", type: "number", required: true })
      );
    });

    it("should return low confidence for non-API pages", () => {
      const $ = cheerio.load("<html><body><h1>概要</h1><p>...</p></body></html>");
      const result = parser.parseEndpoint($, "https://...", "kintone");

      expect(result.confidence).toBeLessThan(0.3);
      expect(result.documents).toHaveLength(0);
    });
  });

  describe("extractEndpointUrls", () => {
    it("should extract all endpoint URLs from index page", () => {
      const $ = cheerio.load(fixtures["index.html"]);
      const urls = parser.extractEndpointUrls!($, "https://cybozu.dev/ja/kintone/docs/rest-api/");

      expect(urls.length).toBeGreaterThan(50); // kintone は約 85 エンドポイント
      expect(urls.some((u) => u.category === "Records")).toBe(true);
    });
  });
});
```

**ツールハンドラのテスト**: モックコンテキスト

```typescript
// tests/unit/tools/search-docs.test.ts

describe("handleSearchDocs", () => {
  it("should return formatted search results", async () => {
    const mockDoc = createMockEndpointDocument({
      id: "kintone:GET:/k/v1/record.json",
      title: "レコードを取得する",
    });

    const context = createMockContext({
      indexer: {
        search: vi.fn().mockReturnValue([
          { id: mockDoc.id, score: 10, apiId: "kintone", method: "GET", path: "/k/v1/record.json", title: "レコードを取得する", category: "Records" },
        ]),
      } as any,
      store: {
        get: vi.fn().mockReturnValue(mockDoc),
        hasApi: vi.fn().mockReturnValue(true),
      } as any,
    });

    const result = await handleSearchDocs(
      { query: "レコード", limit: 5 },
      context
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("レコードを取得する");
    expect(result.content[0].text).toContain("GET");
    expect(result.content[0].text).toContain("/k/v1/record.json");
  });

  it("should return suggestions when API not found", async () => {
    const context = createMockContext({
      store: {
        hasApi: vi.fn().mockReturnValue(false),
        getApiIds: vi.fn().mockReturnValue(["kintone", "backlog"]),
      } as any,
    });

    const result = await handleSearchDocs(
      { query: "record", api: "kintoo" },
      context
    );

    expect(result.content[0].text).toContain("not found");
    expect(result.content[0].text).toContain("kintone");
  });
});
```

### 12.4 E2E テストの設計

```typescript
// tests/e2e/mcp-server.test.ts

describe("MCP Server E2E", () => {
  let serverProcess: ChildProcess;
  let client: McpClient;

  beforeAll(async () => {
    // HTML フィクスチャベースのテスト用サーバーを起動
    // 実際の外部サイトにはアクセスしない
    serverProcess = spawn("node", ["dist/index.js"], {
      env: {
        ...process.env,
        MCP_API_REF_CACHE_DIR: path.join(__dirname, "tmp-cache"),
        // テスト用にキャッシュ済みのフィクスチャを配置
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    client = new McpClient();
    await client.connect(new StdioClientTransport({
      reader: serverProcess.stdout!,
      writer: serverProcess.stdin!,
    }));
  }, 30000); // 初回起動は 30 秒のタイムアウト

  afterAll(async () => {
    await client?.close();
    serverProcess?.kill();
    // テスト用キャッシュの削除
    rmSync(path.join(__dirname, "tmp-cache"), { recursive: true, force: true });
  });

  it("should list available tools", async () => {
    const tools = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(["search_docs", "get_endpoint", "list_apis"])
    );
  });

  it("should search documents", async () => {
    const result = await client.callTool("search_docs", { query: "record" });
    expect(result.content[0].text).toBeTruthy();
  });
});
```

---

## 13. デプロイ・配布設計

### 13.1 npm パッケージ構成

```
npm パッケージに含まれるファイル（files フィールド）:

mcp-api-reference/
├── dist/
│   ├── index.js              ← エントリポイント（shebang 付き）
│   ├── index.d.ts            ← 型定義
│   └── index.js.map          ← ソースマップ
├── package.json
├── README.md
└── LICENSE
```

**tsup によるバンドル**:
- 全ソースコードを `dist/index.js` の 1 ファイルにバンドル
- `node_modules` は含めない（dependencies として npm がインストール）
- Tree shaking により未使用コードを除去

### 13.2 実行フロー（ユーザー視点）

```
ユーザーが npx mcp-api-reference を実行した場合:

1. npm レジストリから mcp-api-reference パッケージをダウンロード
2. node_modules/.bin/mcp-api-reference → dist/index.js を実行
3. dependencies (@modelcontextprotocol/sdk, cheerio, minisearch, zod) も自動インストール
4. サーバーが stdio で起動

ユーザーが MCP 設定に追加した場合:

1. クライアント（Claude Code 等）がサーバープロセスを起動
2. stdin/stdout で JSON-RPC 通信開始
3. クライアントが list_tools で利用可能ツールを取得
4. ユーザーのプロンプトに応じてツールを呼び出し
```

### 13.3 リリースフロー

```
開発者のリリースフロー:

1. package.json の version を更新
   npm version patch|minor|major

2. CHANGELOG.md を更新（手動）

3. git tag を push
   git push --tags

4. GitHub Actions (publish.yml) が自動実行
   ├── npm ci
   ├── npm run lint
   ├── npm run test
   ├── npm run build
   └── npm publish --provenance --access public

5. npm レジストリに公開
   npx mcp-api-reference で最新版が利用可能に
```

### 13.4 互換性マトリクス

| 環境 | 最低バージョン | テスト対象 |
|---|---|---|
| Node.js | 18.0.0 | 18, 20, 22 (CI) |
| npm | 9.0.0 | CI の Node.js バージョンに付属 |
| OS | - | Ubuntu (CI), Windows (手動), macOS (手動) |
| MCP クライアント | MCP SDK 1.x | Claude Code, Claude Desktop, Cursor |

---

## 付録 F: 用語集

| 用語 | 定義 |
|---|---|
| API | このドキュメントでは対象となる外部 REST API（kintone, Backlog 等）を指す |
| プリセット | ビルトインで提供される API ドキュメントサイトの設定 + 専用パーサーのセット |
| エンドポイント | 1 つの HTTP メソッド + パスの組み合わせ。`GET /k/v1/record.json` で 1 エンドポイント |
| コンポジションルート | DI コンテナを使わない場合に、全オブジェクトの生成と接続を行う場所 |
| パイプライン | クロール → パース → インデックス構築 → キャッシュ保存の一連の処理 |
| confidence | パーサーが HTML を構造化できた確信度（0.0〜1.0） |
| configHash | 設定の SHA-256 ハッシュ（先頭 16 文字）。設定変更時のキャッシュ無効化に使用 |

## 付録 G: 仕様書からの設計変更点

| 変更内容 | 仕様書での記述 | 設計書での変更 | 理由 |
|---|---|---|---|
| パイプラインの分離 | `server.ts` 内のインラインコード | `src/core/pipeline.ts` として独立 | テスト容易性の向上。server.ts の責務集中を回避 |
| ユーティリティの分離 | `crawler.ts` 内の `globToRegex` | `src/utils/glob.ts` として独立 | クローラー以外からも再利用可能に |
| ハッシュ計算の分離 | `cache.ts` 内の `computeConfigHash` | `src/utils/hash.ts` として独立 | テストの独立性向上 |
| エラー型の配置 | 仕様書 12 章で定義 | `src/types/errors.ts` に配置 | 型定義と同じディレクトリに集約 |
| ツールハンドラの設計 | McpServer.tool() コールバック内 | 純粋関数 + アダプターパターン | テスト時にMcpServerのモックが不要に |
| DocumentStore の二重インデックス | 仕様書では暗黙的 | 明示的に docIndex を設計 | O(1) ルックアップの根拠を明確化 |
| ファイル書き込み | 仕様書では直接 writeFileSync | write-then-rename パターン | データ破損の防止 |

## 付録 H: 設計レビューチェックリスト

実装前に確認すべき設計上のポイント。

- [ ] 全モジュールの依存方向が上位→下位のみか
- [ ] ServerContext に不要な依存が含まれていないか
- [ ] 各パーサーが SiteParser インターフェースに準拠しているか
- [ ] エラーがツールハンドラで漏れなく catch されているか
- [ ] ファイルシステム操作が atomicWriteSync を使用しているか
- [ ] メモリ使用量がサーバー生存期間中に増加し続けないか
- [ ] ログがすべて stderr に出力されているか（stdout 汚染なし）
- [ ] テストが外部サイトに依存していないか（フィクスチャのみ使用）
- [ ] 新規プリセットの追加が 3 ファイル以内で完了するか
