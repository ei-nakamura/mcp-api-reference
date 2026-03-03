/**
 * @module indexer
 * @description 全文検索インデックスモジュール。
 * MiniSearchを使用してエンドポイントドキュメントの全文検索を提供する。
 * 日本語テキストにはIntl.Segmenter、非対応環境ではbigramによるトークナイズを行う。
 */
import MiniSearch from "minisearch";
import * as fs from "fs";
import { EndpointDocument } from "../types/document.js";
import { Logger } from "../utils/logger.js";

/** MiniSearchに登録する検索用ドキュメントの構造 */
interface SearchableDocument {
  id: string;
  apiId: string;
  title: string;
  description: string;
  path: string;
  method: string;
  category: string;
}

/** 検索結果の1件分を表す */
export interface SearchHit {
  /** ドキュメントID ("{apiId}:{method}:{path}" 形式) */
  id: string;
  /** API識別子 */
  apiId: string;
  /** 検索スコア (高いほど関連度が高い) */
  score: number;
  /** エンドポイントのタイトル */
  title: string;
  /** HTTPメソッド */
  method: string;
  /** エンドポイントパス */
  path: string;
  /** カテゴリ名 */
  category: string;
}

/** 検索オプション */
export interface SearchOptions {
  /** 特定APIに絞り込み (省略時は全API横断検索) */
  apiId?: string;
  /** 結果数の上限 (デフォルト: 10) */
  limit?: number;
}

/**
 * 全文検索インデクサー。
 * API単位でMiniSearchインデックスを管理し、ファジー検索・プレフィックス検索・日本語対応を提供する。
 */
export class Indexer {
  /** API ID → MiniSearchインデックスのマッピング */
  private indexes: Map<string, MiniSearch<SearchableDocument>> = new Map();
  private logger: Logger;
  /** 日本語トークナイズ用のSegmenter (Node.js 18+ で利用可能) */
  private segmenter: Intl.Segmenter | null;

  constructor(logger: Logger) {
    this.logger = logger;
    // Intl.SegmenterはNode.js 18+で利用可能。生成コストが高いため1回だけ作成
    this.segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl
      ? new Intl.Segmenter("ja", { granularity: "word" })
      : null;
  }

  /**
   * 指定APIのドキュメント群からMiniSearchインデックスを構築する。
   * フィールド重み: title(2x), path(1.5x), description(1x), category(0.5x)
   * @param apiId - API識別子
   * @param documents - インデックス対象のエンドポイントドキュメント配列
   */
  build(apiId: string, documents: EndpointDocument[]): void {
    const miniSearch = new MiniSearch<SearchableDocument>({
      fields: ["title", "description", "path", "method", "category"],
      storeFields: ["id", "apiId", "title", "method", "path", "category"],
      searchOptions: {
        boost: { title: 2, path: 1.5, description: 1, category: 0.5 },
        prefix: true,
        fuzzy: 0.2,
      },
      tokenize: (text) => this.tokenize(text),
      processTerm: (term) => this.processTerm(term),
    });

    const searchable = documents.map((doc) => this.toSearchable(doc));
    miniSearch.addAll(searchable);
    this.indexes.set(apiId, miniSearch);
    this.logger.debug(`Index built for ${apiId}: ${documents.length} documents`);
  }

  /**
   * クエリ文字列でインデックスを検索する。
   * apiIdが指定されている場合はそのAPIのみ、未指定の場合は全API横断で検索する。
   * @param query - 検索クエリ
   * @param options - 検索オプション (API絞り込み、結果数制限)
   * @returns スコア降順でソートされた検索結果
   */
  search(query: string, options?: SearchOptions): SearchHit[] {
    const limit = options?.limit ?? 10;

    if (options?.apiId) {
      const index = this.indexes.get(options.apiId);
      if (!index) return [];
      const results = index.search(query);
      return results.slice(0, limit).map((r) => ({
        id: r.id as string,
        apiId: r.apiId as string,
        score: r.score,
        title: r.title as string,
        method: r.method as string,
        path: r.path as string,
        category: r.category as string,
      }));
    }

    // 全インデックスを横断検索
    const allResults: SearchHit[] = [];
    for (const index of this.indexes.values()) {
      const results = index.search(query);
      for (const r of results) {
        allResults.push({
          id: r.id as string,
          apiId: r.apiId as string,
          score: r.score,
          title: r.title as string,
          method: r.method as string,
          path: r.path as string,
          category: r.category as string,
        });
      }
    }
    allResults.sort((a, b) => b.score - a.score);
    return allResults.slice(0, limit);
  }

  /**
   * インデックスをJSONファイルとしてディスクに保存する。
   * @param apiId - API識別子
   * @param indexPath - 保存先ファイルパス
   */
  saveToDisk(apiId: string, indexPath: string): void {
    const index = this.indexes.get(apiId);
    if (!index) return;
    const json = JSON.stringify(index.toJSON());
    fs.writeFileSync(indexPath, json, "utf-8");
    this.logger.debug(`Index saved: ${apiId} → ${indexPath}`);
  }

  /**
   * ディスクからJSONファイルを読み込みインデックスを復元する。
   * @param apiId - API識別子
   * @param indexPath - 読み込み元ファイルパス
   */
  loadFromDisk(apiId: string, indexPath: string): void {
    const json = fs.readFileSync(indexPath, "utf-8");
    const index = MiniSearch.loadJSON<SearchableDocument>(json, {
      fields: ["title", "description", "path", "method", "category"],
      storeFields: ["id", "apiId", "title", "method", "path", "category"],
    });
    this.indexes.set(apiId, index);
    this.logger.debug(`Index loaded: ${apiId} ← ${indexPath}`);
  }

  /** 指定APIのMiniSearchインデックスを取得する */
  getIndex(apiId: string): MiniSearch<SearchableDocument> | undefined {
    return this.indexes.get(apiId);
  }

  /** 指定APIのインデックスを削除する */
  remove(apiId: string): void {
    this.indexes.delete(apiId);
    this.logger.debug(`Index removed: ${apiId}`);
  }

  /**
   * テキストをトークンに分割する。
   * Intl.Segmenterが利用可能な場合は日本語の単語分割、
   * そうでない場合はスペース区切り＋bigramのフォールバックを使用する。
   */
  private tokenize(text: string): string[] {
    if (this.segmenter) {
      return this.segmenterTokenize(text);
    }
    // スペース区切り + bigramフォールバック
    const spaceTokens = text.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
    const bigramTokens = this.fallbackTokenize(text);
    return [...new Set([...spaceTokens, ...bigramTokens])];
  }

  /** Intl.Segmenterを使用した日本語対応トークナイズ */
  private segmenterTokenize(text: string): string[] {
    const segments = [...this.segmenter!.segment(text)];
    return segments
      .filter((s) => s.isWordLike)
      .map((s) => s.segment.toLowerCase());
  }

  /** Segmenter未対応環境用のbigramトークナイズ */
  private fallbackTokenize(text: string): string[] {
    // 2文字のbigramを生成
    const tokens: string[] = [];
    const str = text.toLowerCase();
    for (let i = 0; i < str.length - 1; i++) {
      tokens.push(str.slice(i, i + 2));
    }
    return tokens;
  }

  /** トークンの正規化処理。小文字化し、1文字以下のトークンは除外する。 */
  private processTerm(term: string): string | null {
    const normalized = term.toLowerCase().trim();
    if (normalized.length < 2) return null;  // 1文字以下は除外
    return normalized;
  }

  /** EndpointDocumentをMiniSearch用のSearchableDocumentに変換する */
  private toSearchable(doc: EndpointDocument): SearchableDocument {
    return {
      id: doc.id,
      apiId: doc.apiId,
      title: doc.title,
      description: doc.description,
      path: doc.path,
      method: doc.method,
      category: doc.category,
    };
  }
}
