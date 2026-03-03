import { Crawler } from "./crawler.js";
import { ParserRegistry } from "./parser.js";
import { Indexer } from "./indexer.js";
import { DocumentStore } from "./store.js";
import { CacheManager } from "./cache.js";
import { SiteConfig } from "../types/config.js";
import { EndpointDocument } from "../types/document.js";
import { Logger } from "../utils/logger.js";
import { hashConfig } from "../utils/hash.js";

export interface InitPipelineDeps {
  crawler: Crawler;
  parserRegistry: ParserRegistry;
  store: DocumentStore;
  indexer: Indexer;
  cacheManager: CacheManager;
  logger: Logger;
}

export class InitPipeline {
  constructor(private deps: InitPipelineDeps) {}

  async initializeAll(configs: SiteConfig[], refreshTarget?: string): Promise<void> {
    for (const config of configs) {
      const forceRefresh = refreshTarget === config.id || refreshTarget === "all";
      try {
        await this.initializeSite(config, forceRefresh);
      } catch (err) {
        this.deps.logger.error(`InitPipeline: failed to initialize ${config.id}`, err);
      }
    }
  }

  private async initializeSite(config: SiteConfig, forceRefresh: boolean): Promise<void> {
    const configHash = hashConfig(config);
    if (!forceRefresh) {
      const loaded = await this.loadFromCache(config);
      if (loaded) {
        this.deps.logger.info(`InitPipeline: ${config.id} loaded from cache`);
        return;
      }
    }
    await this.runPipeline(config, configHash);
  }

  private async runPipeline(config: SiteConfig, configHash: string): Promise<void> {
    const { crawler, parserRegistry, store, indexer, cacheManager, logger } = this.deps;

    // 1. クロール
    logger.info(`InitPipeline: crawling ${config.id}...`);
    const crawlResult = await crawler.crawl(config.crawl, (fetched, total) => {
      logger.debug(`Crawl progress: ${fetched}/${total}`);
    });

    // 2. パース
    logger.info(`InitPipeline: parsing ${config.id}...`);
    const parser = parserRegistry.getParser(config.id);
    if (!parser) throw new Error(`No parser registered for ${config.id}`);
    const documents: EndpointDocument[] = [];
    for (const [url, html] of crawlResult.pages) {
      try {
        const result = parser.parseEndpoint(html, url, config.id);
        documents.push(...result.endpoints);
      } catch (err) {
        logger.warn(`Parse failed for ${url}`, err);
      }
    }

    // 3. インデックス構築
    logger.info(`InitPipeline: indexing ${config.id} (${documents.length} docs)...`);
    store.set(config.id, documents);
    indexer.build(config.id, documents);

    // 4. キャッシュ保存
    const cacheDir = cacheManager.getCacheDir(config.id);
    cacheManager.ensureCacheDir(config.id);  // 初回起動時にディレクトリが存在しない場合に備えて事前作成
    store.saveToDisk(config.id, `${cacheDir}/documents.json`);
    indexer.saveToDisk(config.id, `${cacheDir}/index.json`);
    cacheManager.save(config.id, configHash, {
      documents,
      indexData: {},  // indexer.saveToDisk()が既にファイル保存済み
    });
  }

  private async loadFromCache(config: SiteConfig): Promise<boolean> {
    const { store, indexer, cacheManager, logger } = this.deps;
    const configHash = hashConfig(config);
    if (!cacheManager.isCacheValid(config.id, configHash)) return false;
    try {
      const cacheDir = cacheManager.getCacheDir(config.id);
      store.loadFromDisk(config.id, `${cacheDir}/documents.json`);
      indexer.loadFromDisk(config.id, `${cacheDir}/index.json`);
      return true;
    } catch (err) {
      logger.warn(`Cache load failed for ${config.id}`, err);
      return false;
    }
  }
}
