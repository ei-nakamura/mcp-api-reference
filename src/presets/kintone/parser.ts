import * as cheerio from "cheerio";
import { SiteParser, ParseResult } from "../../core/parser.js";
import {
  EndpointDocument,
  ParameterInfo,
  FieldInfo,
  ExampleInfo,
  HttpMethod,
} from "../../types/document.js";
import { ParseError } from "../../types/errors.js";

export class KintoneParser implements SiteParser {
  readonly name = "kintone";

  parseEndpoint(html: string, pageUrl: string, apiId: string): ParseResult {
    const $ = cheerio.load(html);

    const title = $("h1").first().text().trim();
    const spec = this.parseSpecTable($);
    const parameters = this.parseKintoneParamTable($);
    const responseFields = this.parseKintoneResponseTable($);
    const examples = this.parseKintoneExamples($);
    const description = this.extractDescription($);
    const permissions = this.parsePermissions($);
    const notes = this.parseNotes($);

    // method or path が取れなければ空を返す（説明ページ等）
    if (!spec.method || !spec.path) {
      return { endpoints: [] };
    }

    const method = spec.method.toUpperCase() as HttpMethod;
    const id = `${apiId}:${method}:${spec.path}`;

    const doc: EndpointDocument = {
      id,
      apiId,
      category: "", // extractEndpointUrls()は今回実装しないためcategoryは空
      method,
      path: spec.path,
      title: title || spec.path,
      description,
      parameters,
      responseFields,
      examples,
      authentication: spec.authentication,
      permissions,
      notes,
      sourceUrl: pageUrl,
    };

    return { endpoints: [doc] };
  }

  private parseSpecTable(
    $: cheerio.CheerioAPI
  ): { method?: string; path?: string; authentication: string[] } {
    const result: { method?: string; path?: string; authentication: string[] } =
      {
        authentication: [],
      };

    // 最初の<table>の各行を走査
    $("table")
      .first()
      .find("tr")
      .each((_i, row) => {
        const cells = $(row).find("td, th");
        if (cells.length < 2) return;
        const label = $(cells[0]).text().trim();
        const value = $(cells[1]).text().trim();

        if (/HTTPメソッド/.test(label)) {
          result.method = value.toUpperCase();
        } else if (/^URL$/.test(label)) {
          // "https://sample.cybozu.com/k/v1/record.json" → "/k/v1/record.json"
          const match = value.match(/cybozu\.com(\/k\/.*)/);
          if (match) result.path = match[1];
        } else if (/認証/.test(label)) {
          result.authentication = value
            .split(/[,、，]/)
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
        }
      });

    return result;
  }

  private parseKintoneParamTable($: cheerio.CheerioAPI): ParameterInfo[] {
    const params: ParameterInfo[] = [];

    $("table").each((_i, table) => {
      const headers = $(table)
        .find("tr")
        .first()
        .find("th, td")
        .map((_j, th) => $(th).text().trim())
        .get();
      // "パラメーター名" を含むヘッダーを持つ表を対象
      if (!headers.some((h) => /パラメーター名/.test(h))) return;

      $(table)
        .find("tr")
        .slice(1)
        .each((_j, row) => {
          const cells = $(row).find("td");
          if (cells.length < 4) return;
          const name = $(cells[0]).text().trim();
          const type = this.normalizeType($(cells[1]).text().trim());
          const required = /必須/.test($(cells[2]).text());
          const description = $(cells[3]).text().trim().slice(0, 300);
          if (name) {
            params.push({ name, type, required, description });
          }
        });
    });

    return params;
  }

  private parseKintoneResponseTable($: cheerio.CheerioAPI): FieldInfo[] {
    const fields: FieldInfo[] = [];

    $("table").each((_i, table) => {
      const headers = $(table)
        .find("tr")
        .first()
        .find("th, td")
        .map((_j, th) => $(th).text().trim())
        .get();
      // "プロパティ名" を含むヘッダーを持つ表を対象
      if (!headers.some((h) => /プロパティ名/.test(h))) return;

      $(table)
        .find("tr")
        .slice(1)
        .each((_j, row) => {
          const cells = $(row).find("td");
          if (cells.length < 3) return;
          const name = $(cells[0]).text().trim();
          const type = this.normalizeType($(cells[1]).text().trim());
          const description = $(cells[2]).text().trim().slice(0, 300);
          if (name) {
            fields.push({ name, type, description });
          }
        });
    });

    return fields;
  }

  private normalizeType(raw: string): string {
    const map: Record<string, string> = {
      数値: "number",
      文字列: "string",
      数値または文字列: "number | string",
      文字列の配列: "string[]",
      オブジェクト: "object",
      オブジェクトの配列: "object[]",
      真偽値: "boolean",
      真偽値または文字列: "boolean | string",
    };
    return map[raw.trim()] ?? raw;
  }

  private parseKintoneExamples($: cheerio.CheerioAPI): ExampleInfo[] {
    const examples: ExampleInfo[] = [];

    $("pre code").each((_i, el) => {
      const content = $(el).text().trim();
      if (!content || content.length > 2000) return;

      // JavaScriptはスキップ
      const cls = $(el).attr("class") ?? "";
      if (/javascript|js/.test(cls)) return;

      if (content.startsWith("curl")) {
        examples.push({
          type: "request",
          format: "curl",
          content: content.slice(0, 2000),
        });
      } else if (/^[\[{]/.test(content) || /json/.test(cls)) {
        // 直前のテキストでrequest/responseを判定
        const prevText = $(el).closest("pre").prev().text().toLowerCase();
        const type = /レスポンス|response/.test(prevText)
          ? "response"
          : "request";
        examples.push({ type, format: "json", content: content.slice(0, 2000) });
      }
    });

    return examples;
  }

  private extractDescription($: cheerio.CheerioAPI): string {
    const h1 = $("h1").first();
    let description = "";
    let el = h1.next();

    while (el.length > 0 && description.length < 500) {
      const tag = el.prop("tagName")?.toLowerCase();
      if (tag === "table" || tag === "h2" || tag === "h3") break;
      description += el.text().trim() + " ";
      el = el.next();
    }

    return description.trim().slice(0, 500);
  }

  private parsePermissions($: cheerio.CheerioAPI): string[] {
    const permissions: string[] = [];
    $("h2, h3").each((_i, el) => {
      if (/アクセス権|権限/.test($(el).text())) {
        const next = $(el).next();
        if (next.is("ul")) {
          next.find("li").each((_j, li) => { permissions.push($(li).text().trim()); });
        } else {
          const text = next.text().trim();
          if (text) permissions.push(text);
        }
      }
    });
    return permissions;
  }

  private parseNotes($: cheerio.CheerioAPI): string[] {
    const notes: string[] = [];
    $("h2, h3").each((_i, el) => {
      if (/補足|注意|制限/.test($(el).text())) {
        const next = $(el).next();
        if (next.is("ul")) {
          next
            .find("li")
            .each((_j, li) => { notes.push($(li).text().trim().slice(0, 200)); });
        }
      }
    });
    return notes;
  }
}
