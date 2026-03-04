import * as cheerio from "cheerio";
import { SiteParser, ParseResult } from "../../core/parser.js";
import {
  EndpointDocument,
  ParameterInfo,
  FieldInfo,
  HttpMethod,
} from "../../types/document.js";

/**
 * Backlog API v2ドキュメントのHTMLパーサー。
 * developer.nulab.comのHTML構造に特化した抽出ロジックを持つ。
 * メソッドとパスは <pre><code>METHOD /api/v2/...</code></pre> 形式で記述される。
 */
export class BacklogParser implements SiteParser {
  readonly name = "backlog";

  parseEndpoint(html: string, pageUrl: string, apiId: string): ParseResult {
    const $ = cheerio.load(html);

    const title = $("h1").first().text().trim();
    const spec = this.parseMethodPath($);

    if (!spec.method || !spec.path) {
      return { endpoints: [] };
    }

    const method = spec.method as HttpMethod;
    const id = `${apiId}:${method}:${spec.path}`;
    const description = this.extractDescription($);
    const parameters = this.parseParamTable($);
    const responseFields = this.parseResponseTable($);

    const doc: EndpointDocument = {
      id,
      apiId,
      category: "",
      method,
      path: spec.path,
      title: title || spec.path,
      description,
      parameters,
      responseFields,
      examples: [],
      authentication: [],
      permissions: [],
      notes: [],
      sourceUrl: pageUrl,
    };

    return { endpoints: [doc] };
  }

  /**
   * 最初の <pre><code> ブロックから "METHOD /api/v2/..." 形式を抽出する。
   */
  private parseMethodPath($: cheerio.CheerioAPI): { method?: string; path?: string } {
    const methods = ["GET", "POST", "PUT", "DELETE", "PATCH"];
    let method: string | undefined;
    let path: string | undefined;

    $("pre code").each((_i, el) => {
      if (method) return; // already found
      const text = $(el).text().trim();
      const match = text.match(/^(GET|POST|PUT|DELETE|PATCH)\s+(\/api\/v2\/\S+)/);
      if (match && methods.includes(match[1])) {
        method = match[1];
        path = match[2];
      }
    });

    return { method, path };
  }

  /** h1直後のp要素から説明文を抽出する (最大500文字) */
  private extractDescription($: cheerio.CheerioAPI): string {
    const h1 = $("h1").first();
    let description = "";
    let el = h1.next();

    while (el.length > 0 && description.length < 500) {
      const tag = el.prop("tagName")?.toLowerCase();
      if (tag === "h2" || tag === "h3" || tag === "table") break;
      if (tag === "p") {
        description += el.text().trim() + " ";
      }
      el = el.next();
    }

    return description.trim().slice(0, 500);
  }

  /** "パラメーター名" ヘッダーを持つテーブルからリクエストパラメータを抽出する */
  private parseParamTable($: cheerio.CheerioAPI): ParameterInfo[] {
    const params: ParameterInfo[] = [];

    $("table").each((_i, table) => {
      const headers = $(table)
        .find("tr")
        .first()
        .find("th, td")
        .map((_j, th) => $(th).text().trim())
        .get();

      if (!headers.some((h) => /パラメーター名/.test(h))) return;

      $(table)
        .find("tr")
        .slice(1)
        .each((_j, row) => {
          const cells = $(row).find("td");
          if (cells.length < 2) return;
          const name = $(cells[0]).text().trim();
          const type = $(cells[1]).text().trim();
          const description = cells.length >= 3 ? $(cells[2]).text().trim().slice(0, 300) : "";
          if (name) {
            params.push({ name, type, required: false, description });
          }
        });
    });

    return params;
  }

  /** "プロパティ名" ヘッダーを持つテーブルからレスポンスフィールドを抽出する */
  private parseResponseTable($: cheerio.CheerioAPI): FieldInfo[] {
    const fields: FieldInfo[] = [];

    $("table").each((_i, table) => {
      const headers = $(table)
        .find("tr")
        .first()
        .find("th, td")
        .map((_j, th) => $(th).text().trim())
        .get();

      if (!headers.some((h) => /プロパティ名/.test(h))) return;

      $(table)
        .find("tr")
        .slice(1)
        .each((_j, row) => {
          const cells = $(row).find("td");
          if (cells.length < 2) return;
          const name = $(cells[0]).text().trim();
          const type = $(cells[1]).text().trim();
          const description = cells.length >= 3 ? $(cells[2]).text().trim().slice(0, 300) : "";
          if (name) {
            fields.push({ name, type, description });
          }
        });
    });

    return fields;
  }
}
