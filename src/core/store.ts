/**
 * @module store
 * @description ドキュメントストアモジュール。
 * パース済みのエンドポイントドキュメントをインメモリで保持し、
 * ID検索・API単位の取得・メタデータ管理・ディスク永続化を提供する。
 */
import * as fs from "node:fs";
import { EndpointDocument, EndpointDocumentSchema } from "../types/document.js";
import { CacheError } from "../types/errors.js";
import { Logger } from "../utils/logger.js";

/** APIのメタデータ (カテゴリ一覧、エンドポイント数) */
export interface ApiMetadata {
  apiId: string;
  categories: string[];
  endpointCount: number;
}

/** API一覧表示用のサマリー情報 */
export type ApiSummary = ApiMetadata;

/** API詳細情報 (メタデータ + 全エンドポイント) */
export interface ApiDetail extends ApiMetadata {
  endpoints: EndpointDocument[];
}

/**
 * エンドポイントドキュメントのインメモリストア。
 * API単位でドキュメントを管理し、IDによる個別取得やメタデータの集計を行う。
 */
export class DocumentStore {
  /** API ID → エンドポイントドキュメント配列 */
  private store: Map<string, EndpointDocument[]> = new Map();
  /** ドキュメントID → エンドポイントドキュメント (ID検索用) */
  private docIndex: Map<string, EndpointDocument> = new Map();
  /** API ID → メタデータ */
  private metadata: Map<string, ApiMetadata> = new Map();

  constructor(private logger: Logger) {}

  /**
   * 指定APIのドキュメントをストアに登録する。
   * 既存のドキュメントは上書きされる。メタデータ (カテゴリ等) も自動更新される。
   * @param apiId - API識別子
   * @param documents - 登録するエンドポイントドキュメントの配列
   */
  set(apiId: string, documents: EndpointDocument[]): void {
    this.store.set(apiId, documents);
    for (const doc of documents) {
      this.docIndex.set(doc.id, doc);
    }
    const categories = [...new Set(documents.map(d => d.category))];
    this.metadata.set(apiId, {
      apiId,
      categories,
      endpointCount: documents.length,
    });
    this.logger.info(`DocumentStore: set ${documents.length} docs for ${apiId}`);
  }

  /** ドキュメントIDで個別のエンドポイントを取得する */
  get(documentId: string): EndpointDocument | undefined {
    return this.docIndex.get(documentId);
  }

  /** 指定APIの全エンドポイントドキュメントを取得する */
  getByApi(apiId: string): EndpointDocument[] {
    return this.store.get(apiId) ?? [];
  }

  /**
   * 同じカテゴリの類似エンドポイントを最大5件返す。
   * get_endpointのNot Found時に「もしかして?」として表示する用途。
   */
  findSimilar(apiId: string, endpoint: EndpointDocument): EndpointDocument[] {
    const docs = this.store.get(apiId) ?? [];
    return docs
      .filter(d => d.category === endpoint.category && d.id !== endpoint.id)
      .slice(0, 5);
  }

  /** 全APIのサマリー情報を取得する */
  getAllApiSummaries(): ApiSummary[] {
    return [...this.metadata.values()];
  }

  /** 指定APIの詳細情報 (メタデータ + 全エンドポイント) を取得する */
  getApiDetail(apiId: string): ApiDetail | undefined {
    const meta = this.metadata.get(apiId);
    if (!meta) return undefined;
    const endpoints = this.store.get(apiId) ?? [];
    return { ...meta, endpoints };
  }

  /** 全API合計のエンドポイント数を返す */
  totalEndpointCount(): number {
    let total = 0;
    for (const docs of this.store.values()) {
      total += docs.length;
    }
    return total;
  }

  /**
   * ディスクからJSONファイルを読み込み、ストアにドキュメントを復元する。
   * Zodスキーマでデータの完全性を検証し、不正なデータを検出した場合はエラーを投げる。
   * @param apiId - API識別子
   * @param documentsPath - JSONファイルのパス
   * @throws {CacheError} データ検証失敗時
   */
  loadFromDisk(apiId: string, documentsPath: string): void {
    const raw = fs.readFileSync(documentsPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    const result = EndpointDocumentSchema.array().safeParse(parsed);
    if (!result.success) {
      throw new CacheError(
        `Cache validation failed for ${apiId}: ${result.error.issues.map((i) => i.message).join(", ")}`
      );
    }
    this.set(apiId, result.data);
  }

  /**
   * ストア内のドキュメントをJSONファイルとしてディスクに保存する。
   * @param apiId - API識別子
   * @param documentsPath - 保存先ファイルパス
   */
  saveToDisk(apiId: string, documentsPath: string): void {
    const documents = this.store.get(apiId) ?? [];
    fs.writeFileSync(documentsPath, JSON.stringify(documents), "utf-8");
    this.logger.info(`DocumentStore: saved ${documents.length} docs for ${apiId} to disk`);
  }

  /** 指定APIが登録されているかを返す */
  hasApi(apiId: string): boolean {
    return this.metadata.has(apiId);
  }

  /** 登録済みの全API IDを取得する */
  getApiIds(): string[] {
    return Array.from(this.metadata.keys());
  }

  /** 指定APIの全ドキュメントとメタデータを削除する */
  remove(apiId: string): void {
    const docs = this.store.get(apiId) ?? [];
    for (const doc of docs) {
      this.docIndex.delete(doc.id);
    }
    this.store.delete(apiId);
    this.metadata.delete(apiId);
    this.logger.info(`DocumentStore: removed ${apiId}`);
  }
}
