import { z } from "zod";
import type { ServerContext, ToolResult } from "../types/context.js";

export const listApisSchema = {
  api: z.string().optional().describe(
    "If specified, list endpoint categories for this API. If omitted, list all available APIs."
  ),
};

export async function handleListApis(
  input: { api?: string },
  context: ServerContext
): Promise<ToolResult> {
  try {
    if (input.api) {
      if (!context.store.hasApi(input.api)) {
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
      const detail = context.store.getApiDetail(input.api);
      if (!detail) {
        return {
          content: [{
            type: "text",
            text: context.formatter.formatError(`API '${input.api}' has no data.`),
          }],
        };
      }
      return {
        content: [{
          type: "text",
          text: context.formatter.formatApiDetail(detail),
        }],
      };
    }

    const summaries = context.store.getAllApiSummaries();
    return {
      content: [{
        type: "text",
        text: context.formatter.formatApiList(summaries),
      }],
    };
  } catch (err) {
    context.logger.error(`list_apis error: ${String(err)}`);
    return {
      isError: true,
      content: [{
        type: "text",
        text: `Internal error in list_apis: ${err instanceof Error ? err.message : "Unknown error"}`,
      }],
    };
  }
}
