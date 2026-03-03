import * as fs from "node:fs";
import * as path from "node:path";
import { EndpointDocument } from "../types/document.js";
import { CacheError } from "../types/errors.js";
import { Logger } from "../utils/logger.js";

interface CacheMeta {
  apiId: string;
  configHash: string;
  createdAt: number;
  ttlMs: number;
}

export interface CacheLoadResult {
  documents: EndpointDocument[];
  indexData: Record<string, unknown>;
}

export interface CacheSaveData {
  documents: EndpointDocument[];
  indexData: Record<string, unknown>;
}

export class CacheManager {
  constructor(
    private cacheDir: string,
    private ttlMs: number,
    private logger: Logger
  ) {}

  isCacheValid(apiId: string, configHash: string): boolean {
    const meta = this.readMeta(apiId);
    if (!meta) return false;
    if (meta.configHash !== configHash) return false;
    const age = Date.now() - meta.createdAt;
    return age < meta.ttlMs;
  }

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

  invalidate(apiId: string): void {
    const dir = this.getCacheDir(apiId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true });
      this.logger.info(`CacheManager: invalidated cache for ${apiId}`);
    }
  }

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

  getCacheDir(apiId: string): string {
    return path.join(this.cacheDir, apiId);
  }

  ensureCacheDir(apiId: string): void {
    this.ensureDir(this.getCacheDir(apiId));
  }

  private ensureDir(dirPath: string): void {
    fs.mkdirSync(dirPath, { recursive: true });
  }

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
