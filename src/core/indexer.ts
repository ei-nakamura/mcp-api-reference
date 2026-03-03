import MiniSearch from "minisearch";
import * as fs from "fs";
import { EndpointDocument } from "../types/document.js";
import { Logger } from "../utils/logger.js";

interface SearchableDocument {
  id: string;
  apiId: string;
  title: string;
  description: string;
  path: string;
  method: string;
  category: string;
}

export interface SearchHit {
  id: string;
  apiId: string;
  score: number;
  title: string;
  method: string;
  path: string;
  category: string;
}

export interface SearchOptions {
  apiId?: string;       // 特定APIに絞り込み
  limit?: number;       // 結果数制限（デフォルト10）
}

export class Indexer {
  private indexes: Map<string, MiniSearch<SearchableDocument>> = new Map();
  private logger: Logger;
  private segmenter: Intl.Segmenter | null;

  constructor(logger: Logger) {
    this.logger = logger;
    // Intl.SegmenterはNode.js 18+で利用可能。生成コストが高いため1回だけ作成
    this.segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl
      ? new Intl.Segmenter("ja", { granularity: "word" })
      : null;
  }

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

  saveToDisk(apiId: string, indexPath: string): void {
    const index = this.indexes.get(apiId);
    if (!index) return;
    const json = JSON.stringify(index.toJSON());
    fs.writeFileSync(indexPath, json, "utf-8");
    this.logger.debug(`Index saved: ${apiId} → ${indexPath}`);
  }

  loadFromDisk(apiId: string, indexPath: string): void {
    const json = fs.readFileSync(indexPath, "utf-8");
    const index = MiniSearch.loadJSON<SearchableDocument>(json, {
      fields: ["title", "description", "path", "method", "category"],
      storeFields: ["id", "apiId", "title", "method", "path", "category"],
    });
    this.indexes.set(apiId, index);
    this.logger.debug(`Index loaded: ${apiId} ← ${indexPath}`);
  }

  getIndex(apiId: string): MiniSearch<SearchableDocument> | undefined {
    return this.indexes.get(apiId);
  }

  remove(apiId: string): void {
    this.indexes.delete(apiId);
    this.logger.debug(`Index removed: ${apiId}`);
  }

  private tokenize(text: string): string[] {
    if (this.segmenter) {
      return this.segmenterTokenize(text);
    }
    // スペース区切り + bigramフォールバック
    const spaceTokens = text.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
    const bigramTokens = this.fallbackTokenize(text);
    return [...new Set([...spaceTokens, ...bigramTokens])];
  }

  private segmenterTokenize(text: string): string[] {
    const segments = [...this.segmenter!.segment(text)];
    return segments
      .filter((s) => s.isWordLike)
      .map((s) => s.segment.toLowerCase());
  }

  private fallbackTokenize(text: string): string[] {
    // 2文字のbigramを生成
    const tokens: string[] = [];
    const str = text.toLowerCase();
    for (let i = 0; i < str.length - 1; i++) {
      tokens.push(str.slice(i, i + 2));
    }
    return tokens;
  }

  private processTerm(term: string): string | null {
    const normalized = term.toLowerCase().trim();
    if (normalized.length < 2) return null;  // 1文字以下は除外
    return normalized;
  }

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
