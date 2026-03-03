/**
 * @module pipeline
 * @description 初期化パイプラインモジュール。
 * サーバー起動時にクロール → パース → インデックス構築 → キャッシュ保存の
 * 一連の処理を実行する。キャッシュが有効な場合はキャッシュからの復元を行う。
 */
import { Crawler } from "./crawler.js";
import { ParserRegistry } from "./parser.js";
import { Indexer } from "./indexer.js";
import { DocumentStore } from "./store.js";
import { CacheManager } from "./cache.js";
import { SiteConfig } from "../types/config.js";
import { EndpointDocument } from "../types/document.js";
import { Logger } from "../utils/logger.js";
import { hashConfig } from "../utils/hash.js";

/** 初期化パイプラインの依存オブジェクト */
export interface InitPipelineDeps {
  crawler: Crawler;
  parserRegistry: ParserRegistry;
  store: DocumentStore;
  indexer: Indexer;
  cacheManager: CacheManager;
  logger: Logger;
}

/**
 * 初期化パイプライン。
 * サイト設定ごとにキャッシュの有効性を確認し、
 * 有効ならキャッシュから復元、無効ならクロール→パース→インデックス構築を実行する。
 */
export class InitPipeline {
  constructor(private deps: InitPipelineDeps) {}

  /**
   * 全サイトの初期化を実行する。
   * 各サイトで失敗しても他のサイトの初期化は継続する。
   * @param configs - サイト設定の配列
   * @param refreshTarget - 強制再取得対象のAPI ID ("all" で全API)
   */
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

  /**
   * 単一サイトの初期化を実行する。
   * キャッシュが有効かつ強制更新でない場合はキャッシュから復元する。
   */
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

  /**
   * クロール → パース → インデックス構築 → キャッシュ保存の一連の処理を実行する。
   * @param config - サイト設定
   * @param configHash - 設定のハッシュ値 (キャッシュの無効化判定用)
   */
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

  /**
   * キャッシュからドキュメントとインデックスを復元する。
   * @param config - サイト設定
   * @returns 復元に成功した場合true
   */
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
