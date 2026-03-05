# mcp-api-reference

[日本語版 (Japanese)](README.ja.md)

An MCP (Model Context Protocol) server that automatically crawls, indexes, and serves API reference documentation for LLMs.

## Problem & Solution

When LLMs generate code that uses APIs, the following problems occur:

- **Hallucination**: Generating non-existent endpoints or parameters
- **Stale information**: Unable to reference the latest API specs not included in training data
- **Inefficient context consumption**: Passing entire documentation wastes tokens

This tool automatically crawls, parses, and indexes API reference sites just by specifying a URL, then provides token-efficient search results via MCP tools.

## MCP Tools

| Tool | Description | Main Inputs |
|------|-------------|-------------|
| `search_docs` | Full-text search by keyword | `query`, `api` (optional), `limit` (1-20) |
| `get_endpoint` | Get details of a specific endpoint | `api`, `endpoint` (path), `method` |
| `list_apis` | List available APIs and categories | `api` (optional) |

## Requirements

- Node.js >= 18.0.0

## Installation

```bash
npm install
npm run build
```

## Usage

### Start as MCP Server

```bash
node dist/index.js
```

### CLI Options

```bash
# Specify a custom config file
node dist/index.js --config ./my-sites.json

# Refresh cache for a specific API
node dist/index.js --refresh kintone

# Clear all cache
node dist/index.js --clear-cache
```

| Option | Short | Description |
|--------|-------|-------------|
| `--config <path>` | `-c` | Path to custom site config file |
| `--refresh <api-id>` | `-r` | Re-fetch documentation for the specified API |
| `--clear-cache` | - | Clear all cache and exit |

### Claude Desktop Integration

Add the following to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "api-reference": {
      "command": "node",
      "args": ["/path/to/mcp-reference-doc/dist/index.js"]
    }
  }
}
```

## Presets

### kintone REST API

A parser for the kintone REST API is built in as a preset. No additional configuration required.

### Backlog API

A parser for the Backlog API is also available as a preset. No additional configuration required.

### SmartHR API

A parser for the SmartHR API is also available as a preset. No additional configuration required.

## Custom Sites

You can add any API documentation site by specifying a JSON file with the `--config` option.

```json
{
  "sites": [
    {
      "id": "my-api",
      "name": "My API",
      "baseUrl": "https://api.example.com",
      "crawl": {
        "startUrl": "https://api.example.com/docs",
        "includePatterns": ["https://api.example.com/docs/**"],
        "excludePatterns": [],
        "maxPages": 500,
        "delayMs": 500
      },
      "parser": {
        "type": "generic",
        "selectors": {
          "endpointContainer": ".endpoint",
          "method": ".http-method",
          "path": ".api-path",
          "title": "h3",
          "description": ".description",
          "parameters": ".parameters",
          "responseFields": ".response"
        }
      }
    }
  ]
}
```

## Project Structure

```
src/
├── index.ts              # CLI entry point
├── server.ts             # MCP server initialization and tool registration
├── core/
│   ├── crawler.ts        # Web crawler with robots.txt support
│   ├── parser.ts         # Parser registry
│   ├── generic-parser.ts # Generic HTML parser (CSS selector-based)
│   ├── indexer.ts        # Full-text search index via MiniSearch
│   ├── store.ts          # Document store
│   ├── cache.ts          # TTL-based cache management
│   └── pipeline.ts       # Crawl → parse → index pipeline
├── tools/
│   ├── search-docs.ts    # search_docs tool
│   ├── get-endpoint.ts   # get_endpoint tool
│   └── list-apis.ts      # list_apis tool
├── presets/
│   ├── kintone/          # kintone preset
│   ├── backlog/          # Backlog preset
│   └── smarthr/          # SmartHR preset
├── formatters/
│   └── response.ts       # MCP response formatter
├── types/                # Type definitions
└── utils/                # Utilities (logger, glob, hash)
```

## Development

```bash
# Build in watch mode
npm run dev

# Run tests
npm test

# Run tests (watch mode)
npm run test:watch

# Type check
npm run typecheck

# Lint
npm run lint
```

## Tech Stack

- **@modelcontextprotocol/sdk** - MCP server implementation
- **cheerio** - HTML parser
- **minisearch** - Full-text search engine (with Japanese tokenization support)
- **zod** - Schema validation
- **tsup** - TypeScript bundler
- **vitest** - Test framework

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MCP_API_REF_CACHE_DIR` | Path to cache directory | `~/.mcp-api-reference/cache/` |
| `MCP_API_REF_CONFIG` | Path to site config file | - |

## License

MIT
