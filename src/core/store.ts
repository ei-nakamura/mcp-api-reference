import * as fs from "node:fs";
import * as path from "node:path";
import { EndpointDocument } from "../types/document.js";
import { Logger } from "../utils/logger.js";

export interface ApiMetadata {
  apiId: string;
  categories: string[];
  endpointCount: number;
}

export interface ApiSummary extends ApiMetadata {}

export interface ApiDetail extends ApiMetadata {
  endpoints: EndpointDocument[];
}

export class DocumentStore {
  private store: Map<string, EndpointDocument[]> = new Map();
  private docIndex: Map<string, EndpointDocument> = new Map();
  private metadata: Map<string, ApiMetadata> = new Map();

  constructor(private logger: Logger) {}

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

  get(documentId: string): EndpointDocument | undefined {
    return this.docIndex.get(documentId);
  }

  getByApi(apiId: string): EndpointDocument[] {
    return this.store.get(apiId) ?? [];
  }

  findSimilar(apiId: string, endpoint: EndpointDocument): EndpointDocument[] {
    const docs = this.store.get(apiId) ?? [];
    return docs
      .filter(d => d.category === endpoint.category && d.id !== endpoint.id)
      .slice(0, 5);
  }

  getAllApiSummaries(): ApiSummary[] {
    return [...this.metadata.values()];
  }

  getApiDetail(apiId: string): ApiDetail | undefined {
    const meta = this.metadata.get(apiId);
    if (!meta) return undefined;
    const endpoints = this.store.get(apiId) ?? [];
    return { ...meta, endpoints };
  }

  totalEndpointCount(): number {
    let total = 0;
    for (const docs of this.store.values()) {
      total += docs.length;
    }
    return total;
  }

  loadFromDisk(apiId: string, documentsPath: string): void {
    const raw = fs.readFileSync(documentsPath, "utf-8");
    const documents = JSON.parse(raw) as EndpointDocument[];
    this.set(apiId, documents);
  }

  saveToDisk(apiId: string, documentsPath: string): void {
    const documents = this.store.get(apiId) ?? [];
    fs.writeFileSync(documentsPath, JSON.stringify(documents), "utf-8");
    this.logger.info(`DocumentStore: saved ${documents.length} docs for ${apiId} to disk`);
  }

  hasApi(apiId: string): boolean {
    return this.metadata.has(apiId);
  }

  getApiIds(): string[] {
    return Array.from(this.metadata.keys());
  }

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
