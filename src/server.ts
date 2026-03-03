/**
 * @module server
 * @description MCPサーバーのセットアップと初期化を担当するモジュール。
 * 各コアモジュールの生成、パイプラインの実行、MCPツールの登録を行う。
 */
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Crawler } from "./core/crawler.js";
import { ParserRegistry } from "./core/parser.js";
import { Indexer } from "./core/indexer.js";
import { DocumentStore } from "./core/store.js";
import { CacheManager } from "./core/cache.js";
import { InitPipeline } from "./core/pipeline.js";
import { ResponseFormatter } from "./formatters/response.js";
import { createRegistryWithPresets } from "./presets/index.js";
import { handleSearchDocs, searchDocsSchema } from "./tools/search-docs.js";
import { handleGetEndpoint, getEndpointSchema } from "./tools/get-endpoint.js";
import { handleListApis, listApisSchema } from "./tools/list-apis.js";
import type { ServerOptions, SiteConfig } from "./types/config.js";
import type { ServerContext } from "./types/context.js";
import { Logger } from "./utils/logger.js";

// ESMではrequire()が使えないため、createRequireでpackage.jsonを読み込む
const _require = createRequire(import.meta.url);
const { version } = _require("../package.json") as { version: string };

/**
 * MCPサーバーを生成する。
 * 各コアモジュールの初期化、パイプラインの実行、MCPツールの登録を行い、
 * `start()` メソッドを持つオブジェクトを返す。
 * @param options - サーバー起動オプション
 * @returns `start()` を呼ぶとstdioトランスポートで接続を開始する
 */
export async function createServer(options: ServerOptions): Promise<{ start: () => Promise<void> }> {
  const logger = new Logger(options.logLevel ?? "info");

  const crawler = new Crawler(logger);
  const store = new DocumentStore(logger);
  const indexer = new Indexer(logger);
  const cacheManager = new CacheManager(
    options.cacheDir ?? defaultCacheDir(),
    (options.ttlDays ?? 7) * 24 * 60 * 60 * 1000,
    logger
  );

  const parserRegistry = createRegistryWithPresets(logger);
  const pipeline = new InitPipeline({ crawler, parserRegistry, store, indexer, cacheManager, logger });

  const configs = loadConfigs(options, parserRegistry, logger);
  await pipeline.initializeAll(configs, options.refreshTarget);

  const formatter = new ResponseFormatter();
  const context: ServerContext = { indexer, store, configs, formatter, logger };

  const mcpServer = new McpServer({ name: "mcp-api-reference", version });
  registerTools(mcpServer, context);

  return {
    async start() {
      const transport = new StdioServerTransport();
      await mcpServer.connect(transport);
      logger.info(`Server ready. ${store.totalEndpointCount()} endpoints indexed.`);
    },
  };
}

/**
 * MCPサーバーに3つのツール (search_docs, get_endpoint, list_apis) を登録する。
 * @param mcpServer - MCPサーバーインスタンス
 * @param context - ツールハンドラーに渡すサーバーコンテキスト
 */
function registerTools(mcpServer: McpServer, context: ServerContext): void {
  mcpServer.tool(
    "search_docs",
    "Search API documentation by keyword. Returns matching endpoints and descriptions.",
    searchDocsSchema,
    async (input) => handleSearchDocs(input, context)
  );
  mcpServer.tool(
    "get_endpoint",
    "Get detailed information about a specific API endpoint including parameters and examples.",
    getEndpointSchema,
    async (input) => handleGetEndpoint(input, context)
  );
  mcpServer.tool(
    "list_apis",
    "List all available APIs and their endpoint categories.",
    listApisSchema,
    async (input) => handleListApis(input, context)
  );
}

/**
 * プリセット設定とカスタム設定を統合してサイト設定一覧を返す。
 * カスタム設定がプリセットと同じIDを持つ場合、カスタム設定で上書きされる。
 * @param options - サーバー起動オプション
 * @param parserRegistry - プリセットパーサーが登録済みのレジストリ
 * @param logger - ロガー
 * @returns 統合されたサイト設定の配列
 */
function loadConfigs(
  options: ServerOptions,
  parserRegistry: ParserRegistry,
  logger: Logger
): SiteConfig[] {
  // プリセットから設定を取得
  const presetConfigs = parserRegistry
    .getIds()
    .map((id) => parserRegistry.getConfig(id)!)
    .filter(Boolean);

  const configPath = options.configPath ?? process.env["MCP_API_REF_CONFIG"];
  let customConfigs: SiteConfig[] = [];
  if (configPath) {
    customConfigs = loadCustomSites(configPath, logger);
  }

  const merged = new Map<string, SiteConfig>();
  for (const config of presetConfigs) merged.set(config.id, config);
  for (const config of customConfigs) {
    if (merged.has(config.id)) {
      logger.warn(`Custom site '${config.id}' overrides preset`);
    }
    merged.set(config.id, config);
  }
  return [...merged.values()];
}

/**
 * カスタムサイト設定ファイルを読み込む。
 * JSONファイルの `sites` フィールドからSiteConfig配列を取得する。
 * @param configPath - 設定ファイルのパス
 * @param logger - ロガー
 * @returns カスタムサイト設定の配列 (読み込み失敗時は空配列)
 */
function loadCustomSites(configPath: string, logger: Logger): SiteConfig[] {
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const data = JSON.parse(raw) as { sites?: SiteConfig[] };
    return data.sites ?? [];
  } catch (err) {
    logger.warn(`Failed to load custom config from ${configPath}: ${String(err)}`);
    return [];
  }
}

/**
 * デフォルトのキャッシュディレクトリパスを返す。
 * 環境変数 `MCP_API_REF_CACHE_DIR` が設定されていればそれを使用し、
 * 未設定の場合は `~/.mcp-api-reference/cache/` を返す。
 * @returns キャッシュディレクトリの絶対パス
 */
export function defaultCacheDir(): string {
  if (process.env["MCP_API_REF_CACHE_DIR"]) return process.env["MCP_API_REF_CACHE_DIR"]!;
  const home = process.env["HOME"] ?? process.env["USERPROFILE"] ?? os.homedir();
  return path.join(home, ".mcp-api-reference", "cache");
}
