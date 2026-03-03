/**
 * @module cache
 * @description キャッシュマネージャーモジュール。
 * クロール・パース結果と検索インデックスをディスクにキャッシュし、
 * TTLと設定ハッシュに基づいてキャッシュの有効性を判定する。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { EndpointDocument } from "../types/document.js";
import { CacheError } from "../types/errors.js";
import { Logger } from "../utils/logger.js";

/** キャッシュのメタ情報。TTLと設定ハッシュによる有効性判定に使用する。 */
interface CacheMeta {
  /** API識別子 */
  apiId: string;
  /** 設定オブジェクトのSHA-256ハッシュ (設定変更検知用) */
  configHash: string;
  /** キャッシュ作成日時 (Unix timestamp) */
  createdAt: number;
  /** キャッシュの有効期間 (ミリ秒) */
  ttlMs: number;
}

/** キャッシュからの読み込み結果 */
export interface CacheLoadResult {
  /** エンドポイントドキュメントの配列 */
  documents: EndpointDocument[];
  /** シリアライズされたインデックスデータ */
  indexData: Record<string, unknown>;
}

/** キャッシュに保存するデータ */
export interface CacheSaveData {
  /** エンドポイントドキュメントの配列 */
  documents: EndpointDocument[];
  /** シリアライズされたインデックスデータ */
  indexData: Record<string, unknown>;
}

/**
 * TTLベースのキャッシュマネージャー。
 * API単位でドキュメント・インデックス・メタ情報をディスクに永続化する。
 * キャッシュディレクトリ構造: `{cacheDir}/{apiId}/documents.json|index.json|meta.json`
 */
export class CacheManager {
  /**
   * @param cacheDir - キャッシュのベースディレクトリパス
   * @param ttlMs - キャッシュの有効期間 (ミリ秒)
   * @param logger - ロガー
   */
  constructor(
    private cacheDir: string,
    private ttlMs: number,
    private logger: Logger
  ) {}

  /**
   * キャッシュが有効かどうかを判定する。
   * メタ情報が存在し、設定ハッシュが一致し、TTL内であればtrueを返す。
   * @param apiId - API識別子
   * @param configHash - 現在の設定のハッシュ値
   * @returns キャッシュが有効ならtrue
   */
  isCacheValid(apiId: string, configHash: string): boolean {
    const meta = this.readMeta(apiId);
    if (!meta) return false;
    if (meta.configHash !== configHash) return false;
    const age = Date.now() - meta.createdAt;
    return age < meta.ttlMs;
  }

  /**
   * キャッシュからドキュメントとインデックスデータを読み込む。
   * @param apiId - API識別子
   * @returns キャッシュのドキュメントとインデックスデータ
   * @throws {CacheError} 読み込み失敗時
   */
  load(apiId: string): CacheLoadResult {
    const dir = this.getCacheDir(apiId);
    try {
      const documentsRaw = fs.readFileSync(path.join(dir, "documents.json"), "utf-8");
      const indexRaw = fs.readFileSync(path.join(dir, "index.json"), "utf-8");
      const documents = JSON.parse(documentsRaw) as EndpointDocument[];
      const indexData = JSON.parse(indexRaw) as Record<string, unknown>;
      this.logger.info(`CacheManager: loaded cache for ${apiId}`);
      return { documents, indexData };
    } catch (err) {
      throw new CacheError(`Failed to load cache for ${apiId}: ${String(err)}`);
    }
  }

  /**
   * ドキュメントとインデックスデータをキャッシュに保存する。
   * メタ情報 (ハッシュ、TTL、作成日時) も同時に書き込む。
   * @param apiId - API識別子
   * @param configHash - 設定のハッシュ値
   * @param data - 保存するデータ
   */
  save(apiId: string, configHash: string, data: CacheSaveData): void {
    const dir = this.getCacheDir(apiId);
    this.ensureDir(dir);
    const meta: CacheMeta = {
      apiId,
      configHash,
      createdAt: Date.now(),
      ttlMs: this.ttlMs,
    };
    fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta), "utf-8");
    fs.writeFileSync(path.join(dir, "documents.json"), JSON.stringify(data.documents), "utf-8");
    fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(data.indexData), "utf-8");
    this.logger.info(`CacheManager: saved cache for ${apiId}`);
  }

  /** 指定APIのキャッシュを無効化 (削除) する */
  invalidate(apiId: string): void {
    const dir = this.getCacheDir(apiId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true });
      this.logger.info(`CacheManager: invalidated cache for ${apiId}`);
    }
  }

  /** 全APIのキャッシュを削除する */
  clearAll(): void {
    if (fs.existsSync(this.cacheDir)) {
      const entries = fs.readdirSync(this.cacheDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          fs.rmSync(path.join(this.cacheDir, entry.name), { recursive: true });
        }
      }
      this.logger.info("CacheManager: cleared all caches");
    }
  }

  /** 指定APIのキャッシュディレクトリパスを返す */
  getCacheDir(apiId: string): string {
    return path.join(this.cacheDir, apiId);
  }

  /** 指定APIのキャッシュディレクトリを作成する (存在しない場合) */
  ensureCacheDir(apiId: string): void {
    this.ensureDir(this.getCacheDir(apiId));
  }

  /** ディレクトリを再帰的に作成する */
  private ensureDir(dirPath: string): void {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  /** キャッシュメタ情報を読み込む。存在しない・読み込みエラーの場合はnullを返す。 */
  private readMeta(apiId: string): CacheMeta | null {
    const metaPath = path.join(this.getCacheDir(apiId), "meta.json");
    try {
      const raw = fs.readFileSync(metaPath, "utf-8");
      return JSON.parse(raw) as CacheMeta;
    } catch {
      return null;
    }
  }
}
