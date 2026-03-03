import type { Indexer } from "../core/indexer.js";
import type { DocumentStore } from "../core/store.js";
import type { ResponseFormatter } from "../formatters/response.js";
import type { Logger } from "../utils/logger.js";
import type { SiteConfig } from "./config.js";

export interface ServerContext {
  readonly indexer: Indexer;
  readonly store: DocumentStore;
  readonly configs: ReadonlyArray<SiteConfig>;
  readonly formatter: ResponseFormatter;
  readonly logger: Logger;
}

export interface ToolResult {
  [x: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}
