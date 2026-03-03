export class McpApiRefError extends Error {
  code: string;
  recoverable: boolean;

  constructor(message: string, code: string, recoverable: boolean) {
    super(message);
    this.name = "McpApiRefError";
    this.code = code;
    this.recoverable = recoverable;
  }
}

export class CrawlError extends McpApiRefError {
  url: string;
  statusCode?: number;

  constructor(message: string, url: string, statusCode?: number) {
    super(message, "CRAWL_ERROR", true);
    this.name = "CrawlError";
    this.url = url;
    this.statusCode = statusCode;
  }
}

export class ParseError extends McpApiRefError {
  url: string;

  constructor(message: string, url: string) {
    super(message, "PARSE_ERROR", true);
    this.name = "ParseError";
    this.url = url;
  }
}

export class CacheError extends McpApiRefError {
  constructor(message: string) {
    super(message, "CACHE_ERROR", true);
    this.name = "CacheError";
  }
}

export class ConfigError extends McpApiRefError {
  constructor(message: string) {
    super(message, "CONFIG_ERROR", false);
    this.name = "ConfigError";
  }
}
