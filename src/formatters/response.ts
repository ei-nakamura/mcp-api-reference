import { EndpointDocument, ParameterInfo, FieldInfo, ExampleInfo } from "../types/document.js";
import { SearchHit } from "../core/indexer.js";
import { ApiSummary, ApiDetail } from "../core/store.js";

const MAX_PARAMS_IN_DETAIL = 30;
const MAX_RESPONSE_FIELDS = 20;
const MAX_EXAMPLE_LENGTH = 1500;
const MAX_DESCRIPTION_LENGTH = 300;
const MAX_NOTES = 5;
const MAX_ENDPOINTS_PER_CATEGORY = 10;
const MAX_TOTAL_ENDPOINTS_IN_LIST = 50;

export class ResponseFormatter {
  formatSearchResults(
    query: string,
    hits: SearchHit[],
    docs: Map<string, EndpointDocument>,
    api?: string
  ): string {
    if (hits.length === 0) {
      return `No results found for "${query}"${api ? ` in ${api} API` : ""}.`;
    }

    const apiLabel = api ? ` in ${api} API` : "";
    const lines: string[] = [`Found ${hits.length} results for "${query}"${apiLabel}:\n`];

    hits.forEach((hit, i) => {
      const doc = docs.get(hit.id);
      if (!doc) return;
      const desc = this.truncate(doc.description, 100);
      const paramStr = doc.parameters.slice(0, 3).map(p => `${p.name} (${p.type})`).join(", ");
      lines.push(`${i + 1}. ${hit.method} ${hit.path} — ${hit.title}`);
      if (desc) lines.push(`   ${desc}`);
      if (paramStr) lines.push(`   Params: ${paramStr}`);
      lines.push(`   → get_endpoint("${doc.apiId}", "${doc.path}", "${hit.method}")`);
      lines.push("");
    });

    lines.push(`Use get_endpoint() for full parameter details and examples.`);
    return lines.join("\n");
  }

  formatEndpointDetail(doc: EndpointDocument): string {
    const lines: string[] = [];
    lines.push(`## ${doc.method} ${doc.path} — ${doc.title}\n`);

    if (doc.description) {
      lines.push(`${this.truncate(doc.description, MAX_DESCRIPTION_LENGTH)}\n`);
    }

    lines.push(`**Source:** ${doc.sourceUrl}\n`);

    if (doc.authentication.length > 0) {
      lines.push(`### Authentication\n${doc.authentication.join(", ")}\n`);
    }

    lines.push(`### Request Parameters`);
    if (doc.parameters.length === 0) {
      lines.push("No parameters\n");
    } else {
      lines.push(this.formatParamTable(doc.parameters.slice(0, MAX_PARAMS_IN_DETAIL)));
      lines.push("");
    }

    if (doc.responseFields.length > 0) {
      lines.push(`### Response Fields`);
      lines.push(this.formatFieldTable(doc.responseFields.slice(0, MAX_RESPONSE_FIELDS)));
      lines.push("");
    }

    if (doc.examples.length > 0) {
      lines.push(`### Examples`);
      lines.push(this.formatExamples(doc.examples));
      lines.push("");
    }

    if (doc.notes.length > 0) {
      lines.push(`### Notes`);
      doc.notes.slice(0, MAX_NOTES).forEach(note => lines.push(`- ${note}`));
      lines.push("");
    }

    if (doc.permissions.length > 0) {
      lines.push(`### Permissions`);
      doc.permissions.forEach(p => lines.push(`- ${p}`));
      lines.push("");
    }

    return lines.join("\n");
  }

  formatApiList(summaries: ApiSummary[]): string {
    const lines: string[] = [`Available APIs (${summaries.length} total):\n`];

    summaries.forEach((s, i) => {
      lines.push(`${i + 1}. **${s.apiId}** — ${s.apiId}`);
      lines.push(`   Endpoints: ${s.endpointCount} | Categories: ${s.categories.join(", ")}`);
      lines.push("");
    });

    lines.push(`Use search_docs(query, api) to search within a specific API.`);
    lines.push(`Use list_apis(api) to see endpoint categories.`);
    return lines.join("\n");
  }

  formatApiDetail(detail: ApiDetail): string {
    const lines: string[] = [`## ${detail.apiId} (${detail.endpointCount} endpoints)\n`];

    const byCategory = new Map<string, EndpointDocument[]>();
    for (const ep of detail.endpoints) {
      const list = byCategory.get(ep.category) ?? [];
      list.push(ep);
      byCategory.set(ep.category, list);
    }

    let totalShown = 0;
    for (const [category, eps] of byCategory.entries()) {
      if (totalShown >= MAX_TOTAL_ENDPOINTS_IN_LIST) break;
      const slice = eps.slice(0, MAX_ENDPOINTS_PER_CATEGORY);
      lines.push(`### ${category} (${eps.length} endpoints)`);
      for (const ep of slice) {
        if (totalShown >= MAX_TOTAL_ENDPOINTS_IN_LIST) break;
        lines.push(`- ${ep.method} ${ep.path} — ${ep.title}`);
        totalShown++;
      }
      lines.push("");
    }

    lines.push(`(Use search_docs to find specific endpoints)`);
    return lines.join("\n");
  }

  formatError(message: string, suggestions?: string[]): string {
    const lines: string[] = [`Error: ${message}`];
    if (suggestions && suggestions.length > 0) {
      suggestions.forEach(s => lines.push(`- ${s}`));
    }
    return lines.join("\n");
  }

  formatNotFound(
    api: string,
    endpoint: string,
    method: string,
    similar: EndpointDocument[]
  ): string {
    const lines: string[] = [`Endpoint not found: ${method} ${endpoint} in ${api} API`];
    if (similar.length > 0) {
      lines.push("\nDid you mean one of these?");
      similar.forEach(doc => lines.push(`- ${doc.method} ${doc.path} — ${doc.title}`));
    }
    lines.push(`\nUse search_docs("${endpoint}", "${api}") to search.`);
    return lines.join("\n");
  }

  private formatParamTable(params: ParameterInfo[]): string {
    if (params.length === 0) return "";
    const lines: string[] = [
      "| Parameter | Type | Required | Description |",
      "|-----------|------|----------|-------------|",
    ];
    for (const p of params) {
      const req = p.required ? "Yes" : "No";
      const desc = this.truncate(p.description, 80);
      lines.push(`| ${p.name} | ${p.type} | ${req} | ${desc} |`);
    }
    return lines.join("\n");
  }

  private formatFieldTable(fields: FieldInfo[]): string {
    if (fields.length === 0) return "";
    const lines: string[] = [
      "| Property | Type | Description |",
      "|----------|------|-------------|",
    ];
    for (const f of fields) {
      const desc = this.truncate(f.description, 80);
      lines.push(`| ${f.name} | ${f.type} | ${desc} |`);
    }
    return lines.join("\n");
  }

  private formatExamples(examples: ExampleInfo[]): string {
    const lines: string[] = [];
    for (const ex of examples) {
      const content = this.truncate(ex.content, MAX_EXAMPLE_LENGTH);
      const lang = ex.format === "curl" ? "curl" : ex.format === "url" ? "text" : "json";
      lines.push(`\`\`\`${lang}`);
      lines.push(content);
      lines.push("```");
    }
    return lines.join("\n");
  }

  private truncate(text: string, maxLen: number): string {
    return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
  }
}
