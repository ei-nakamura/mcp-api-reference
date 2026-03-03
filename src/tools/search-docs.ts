/**
 * @module tools/search-docs
 * @description search_docs MCPツールの実装。
 * キーワードによる全文検索を行い、マッチするエンドポイントの一覧を返す。
 */
import { z } from "zod";
import type { EndpointDocument } from "../types/document.js";
import type { ServerContext, ToolResult } from "../types/context.js";

/** search_docsツールの入力スキーマ定義 */
export const searchDocsSchema = {
  query: z.string().describe("Search query (e.g., 'create record', 'レコード登録')"),
  api: z.string().optional().describe(
    "Target API identifier (e.g., 'kintone'). If omitted, searches all indexed APIs."
  ),
  limit: z.number().min(1).max(20).optional().describe(
    "Maximum number of results to return (default: 5, max: 20)"
  ),
};

/**
 * search_docsツールのハンドラー。
 * クエリ文字列でインデックスを検索し、マッチするエンドポイントの概要一覧を返す。
 * 指定APIが存在しない場合や結果が0件の場合は、適切なエラーメッセージと提案を返す。
 * @param input - ツール入力 (query, api, limit)
 * @param context - サーバーコンテキスト
 * @returns MCPツール結果
 */
export async function handleSearchDocs(
  input: { query: string; api?: string; limit?: number },
  context: ServerContext
): Promise<ToolResult> {
  try {
    if (input.api && !context.store.hasApi(input.api)) {
      const available = context.store.getApiIds();
      return {
        content: [{
          type: "text",
          text: context.formatter.formatError(
            `API '${input.api}' not found.`,
            [`Available APIs: ${available.join(", ")}`]
          ),
        }],
      };
    }

    const hits = context.indexer.search(input.query, {
      apiId: input.api,
      limit: input.limit ?? 5,
    });

    if (hits.length === 0) {
      return {
        content: [{
          type: "text",
          text: context.formatter.formatError(
            `No results found for "${input.query}"`,
            ["Try different keywords", "Use list_apis() to see available APIs"]
          ),
        }],
      };
    }

    const docs = new Map<string, EndpointDocument>();
    for (const hit of hits) {
      const doc = context.store.get(hit.id);
      if (doc) docs.set(hit.id, doc);
    }

    return {
      content: [{
        type: "text",
        text: context.formatter.formatSearchResults(input.query, hits, docs, input.api),
      }],
    };
  } catch (err) {
    context.logger.error(`search_docs error: ${String(err)}`);
    return {
      isError: true,
      content: [{
        type: "text",
        text: `Internal error in search_docs: ${err instanceof Error ? err.message : "Unknown error"}`,
      }],
    };
  }
}
