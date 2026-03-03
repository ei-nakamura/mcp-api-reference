/**
 * @module tools/get-endpoint
 * @description get_endpoint MCPツールの実装。
 * 指定されたAPI・パス・メソッドに対応するエンドポイントの詳細情報を返す。
 */
import { z } from "zod";
import type { ServerContext, ToolResult } from "../types/context.js";

/** get_endpointツールの入力スキーマ定義 */
export const getEndpointSchema = {
  api: z.string().describe("API identifier (e.g., 'kintone', 'backlog')"),
  endpoint: z.string().describe("Endpoint path (e.g., '/k/v1/record.json')"),
  method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).describe("HTTP method"),
};

/**
 * get_endpointツールのハンドラー。
 * ドキュメントIDを "{api}:{METHOD}:{path}" 形式で構築し、ストアから詳細を取得する。
 * 見つからない場合は同一APIの類似エンドポイントを提案する。
 * @param input - ツール入力 (api, endpoint, method)
 * @param context - サーバーコンテキスト
 * @returns MCPツール結果
 */
export async function handleGetEndpoint(
  input: { api: string; endpoint: string; method: string },
  context: ServerContext
): Promise<ToolResult> {
  try {
    const docId = `${input.api}:${input.method.toUpperCase()}:${input.endpoint}`;
    const doc = context.store.get(docId);

    if (doc) {
      return {
        content: [{
          type: "text",
          text: context.formatter.formatEndpointDetail(doc),
        }],
      };
    }

    // 見つからない場合 — 同一APIの類似エンドポイントを提案
    const similar = context.store.getByApi(input.api).slice(0, 5);
    return {
      content: [{
        type: "text",
        text: context.formatter.formatNotFound(
          input.api,
          input.endpoint,
          input.method,
          similar
        ),
      }],
    };
  } catch (err) {
    context.logger.error(`get_endpoint error: ${String(err)}`);
    return {
      isError: true,
      content: [{
        type: "text",
        text: `Internal error in get_endpoint: ${err instanceof Error ? err.message : "Unknown error"}`,
      }],
    };
  }
}
