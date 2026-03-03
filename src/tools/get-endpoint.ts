import { z } from "zod";
import type { ServerContext, ToolResult } from "../types/context.js";

export const getEndpointSchema = {
  api: z.string().describe("API identifier (e.g., 'kintone', 'backlog')"),
  endpoint: z.string().describe("Endpoint path (e.g., '/k/v1/record.json')"),
  method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).describe("HTTP method"),
};

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

    // not found — suggest similar endpoints from the same API
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
