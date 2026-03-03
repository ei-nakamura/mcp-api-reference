import { EndpointDocument } from "../types/document.js";
import { PresetConfig } from "../types/config.js";
import { Logger } from "../utils/logger.js";

export interface ParseResult {
  endpoints: EndpointDocument[];
}

// Strategyパターン: プリセットごとに異なるパーサーを差し替え可能
export interface SiteParser {
  readonly name: string;
  // ページ内のエンドポイントURLを抽出（省略可能 — 全ページをparseEndpointにかける場合）
  extractEndpointUrls?(html: string, pageUrl: string): string[];
  // 単一ページからエンドポイント情報を抽出
  parseEndpoint(html: string, pageUrl: string, apiId: string): ParseResult;
}

export class ParserRegistry {
  private parsers: Map<string, SiteParser> = new Map();
  private configs: Map<string, PresetConfig> = new Map();

  constructor(private logger: Logger) {}

  register(id: string, config: PresetConfig, parser: SiteParser): void {
    this.parsers.set(id, parser);
    this.configs.set(id, config);
    this.logger.debug(`Parser registered: ${id}`);
  }

  getParser(id: string): SiteParser | undefined {
    return this.parsers.get(id);
  }

  getConfig(id: string): PresetConfig | undefined {
    return this.configs.get(id);
  }

  getIds(): string[] {
    return Array.from(this.parsers.keys());
  }
}
