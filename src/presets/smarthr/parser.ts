/**
 * @module presets/smarthr/parser
 * @description SmartHR APIドキュメント専用のHTMLパーサー。
 * developer.smarthr.jpのSmartHR API仕様書ページから、HTTPメソッド・パス・パラメータ・
 * レスポンスフィールド等を抽出する。
 *
 * SmartHR API仕様書はRedocベースの単一ページアプリケーションのため、
 * 1つのHTMLから複数のエンドポイントを抽出する。
 */
import * as cheerio from "cheerio";
import { SiteParser, ParseResult } from "../../core/parser.js";
import {
  EndpointDocument,
  ParameterInfo,
  FieldInfo,
  HttpMethod,
} from "../../types/document.js";

const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"] as const;
const HTTP_METHODS_SET = new Set<string>(HTTP_METHODS);

/**
 * SmartHR APIドキュメントのHTMLパーサー。
 * Redocが生成するHTML構造からAPIエンドポイント情報を抽出する。
 * 1ページ内に複数のエンドポイントが含まれるため、全てを抽出して返す。
 */
export class SmartHRParser implements SiteParser {
  readonly name = "smarthr";

  /**
   * SmartHR API仕様書のHTMLからエンドポイント情報を抽出する。
   * Redocベースの単一ページから複数エンドポイントを抽出する。
   * @param html - ページのHTML
   * @param pageUrl - ページのURL
   * @param apiId - API識別子
   * @returns パース結果
   */
  parseEndpoint(html: string, pageUrl: string, apiId: string): ParseResult {
    const $ = cheerio.load(html);
    const endpoints: EndpointDocument[] = [];

    // Redocの各オペレーションセクションを探索
    // id属性が "operation/" で始まる要素がエンドポイントセクション
    $("[id^='operation/']").each((_i, section) => {
      const ep = this.parseOperationSection($, section, pageUrl, apiId);
      if (ep) {
        endpoints.push(ep);
      }
    });

    // operation/ IDが見つからない場合、代替パターンを試行
    if (endpoints.length === 0) {
      const altEndpoints = this.parseAlternativePatterns($, pageUrl, apiId);
      endpoints.push(...altEndpoints);
    }

    return { endpoints };
  }

  /**
   * Redocのoperationセクションからエンドポイント情報を抽出する。
   */
  private parseOperationSection(
    $: cheerio.CheerioAPI,
    section: cheerio.Element,
    pageUrl: string,
    apiId: string
  ): EndpointDocument | null {
    const $section = $(section);
    const sectionId = $section.attr("id") ?? "";

    // タイトルの取得
    const title = $section.find("h1, h2, h3").first().text().trim();

    // メソッドとパスの抽出
    const spec = this.extractMethodPath($section, $);
    if (!spec.method || !spec.path) return null;

    const method = spec.method as HttpMethod;
    const description = this.extractSectionDescription($section, $);
    const parameters = this.extractParameters($section, $);
    const responseFields = this.extractResponseFields($section, $);

    const sourceUrl = sectionId
      ? `${pageUrl}#${sectionId}`
      : pageUrl;

    const id = `${apiId}:${method}:${spec.path}`;

    return {
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
      sourceUrl,
    };
  }

  /**
   * セクション内からHTTPメソッドとAPIパスを抽出する。
   * Redocでは method + path が隣接して表示される。
   */
  private extractMethodPath(
    $section: cheerio.Cheerio<cheerio.Element>,
    $: cheerio.CheerioAPI
  ): { method?: string; path?: string } {
    let method: string | undefined;
    let path: string | undefined;

    // パターン1: テキスト内に "GET /api/v1/..." のような形式がある場合
    $section.find("*").each((_i, el) => {
      if (method && path) return false; // already found
      const text = $(el).text().trim();

      // "GET /api/v1/crews" のようなパターン
      const match = text.match(
        /\b(GET|POST|PUT|DELETE|PATCH)\s+(\/api\/v1\/\S+)/
      );
      if (match && HTTP_METHODS_SET.has(match[1])) {
        method = match[1];
        path = match[2];
        return false;
      }
    });

    if (method && path) return { method, path };

    // パターン2: メソッドとパスが別々の要素に存在する場合
    // Redocではメソッドバッジとパス表示が別要素の場合がある
    $section.find("span, div, code").each((_i, el) => {
      if (method && path) return false;
      const text = $(el).text().trim().toUpperCase();
      if (HTTP_METHODS_SET.has(text)) {
        method = text;
        // 次の兄弟要素やパス要素を探す
        const nextText = $(el).next().text().trim();
        const pathMatch = nextText.match(/(\/api\/v1\/\S+)/);
        if (pathMatch) {
          path = pathMatch[1];
          return false;
        }
        // 親の中でパスを探す
        const parentText = $(el).parent().text().trim();
        const parentPathMatch = parentText.match(/(\/api\/v1\/\S+)/);
        if (parentPathMatch) {
          path = parentPathMatch[1];
          return false;
        }
      }
    });

    return { method, path };
  }

  /**
   * セクション内のエンドポイント説明文を抽出する。
   */
  private extractSectionDescription(
    $section: cheerio.Cheerio<cheerio.Element>,
    $: cheerio.CheerioAPI
  ): string {
    let description = "";

    // h1/h2/h3の次のp要素を取得
    const heading = $section.find("h1, h2, h3").first();
    let el = heading.next();

    while (el.length > 0 && description.length < 500) {
      const tag = el.prop("tagName")?.toLowerCase();
      if (tag === "h1" || tag === "h2" || tag === "h3" || tag === "table") break;
      if (tag === "p" || tag === "div") {
        const text = el.text().trim();
        // HTTPメソッドやパスを含む要素はスキップ
        if (text && !text.match(/^(GET|POST|PUT|DELETE|PATCH)\s+\/api\//)) {
          description += text + " ";
        }
      }
      el = el.next();
    }

    return description.trim().slice(0, 500);
  }

  /**
   * セクション内のパラメータテーブルを抽出する。
   * Redocのパラメータ表示はテーブル形式またはdl形式の場合がある。
   */
  private extractParameters(
    $section: cheerio.Cheerio<cheerio.Element>,
    $: cheerio.CheerioAPI
  ): ParameterInfo[] {
    const params: ParameterInfo[] = [];

    // テーブル形式のパラメータ
    $section.find("table").each((_i, table) => {
      const headers = $(table)
        .find("tr")
        .first()
        .find("th, td")
        .map((_j, th) => $(th).text().trim().toLowerCase())
        .get();

      // パラメータテーブルの判定
      const isParamTable = headers.some(
        (h) =>
          /パラメーター|parameter|name|名前|パラメータ/.test(h)
      );
      // レスポンステーブルは除外
      const isResponseTable = headers.some(
        (h) => /プロパティ|property|response|レスポンス/.test(h)
      );

      if (!isParamTable || isResponseTable) return;

      // ヘッダーのインデックスを取得
      const nameIdx = this.findHeaderIndex(headers, /name|パラメーター名|名前|パラメータ名/);
      const typeIdx = this.findHeaderIndex(headers, /type|型/);
      const requiredIdx = this.findHeaderIndex(headers, /required|必須/);
      const descIdx = this.findHeaderIndex(headers, /description|説明|内容/);

      $(table)
        .find("tr")
        .slice(1)
        .each((_j, row) => {
          const cells = $(row).find("td");
          if (cells.length < 2) return;

          const name = nameIdx >= 0 ? $(cells[nameIdx]).text().trim() : $(cells[0]).text().trim();
          const type = typeIdx >= 0 ? $(cells[typeIdx]).text().trim() : (cells.length >= 2 ? $(cells[1]).text().trim() : "");
          const required = requiredIdx >= 0 ? /必須|required|true|yes/i.test($(cells[requiredIdx]).text()) : false;
          const description = descIdx >= 0 ? $(cells[descIdx]).text().trim().slice(0, 300) : "";

          if (name) {
            params.push({ name, type, required, description });
          }
        });
    });

    return params;
  }

  /**
   * セクション内のレスポンスフィールドテーブルを抽出する。
   */
  private extractResponseFields(
    $section: cheerio.Cheerio<cheerio.Element>,
    $: cheerio.CheerioAPI
  ): FieldInfo[] {
    const fields: FieldInfo[] = [];

    $section.find("table").each((_i, table) => {
      const headers = $(table)
        .find("tr")
        .first()
        .find("th, td")
        .map((_j, th) => $(th).text().trim().toLowerCase())
        .get();

      // レスポンステーブルの判定
      const isResponseTable = headers.some(
        (h) => /プロパティ|property|field|フィールド/.test(h)
      );
      // パラメータテーブルは除外
      const isParamTable = headers.some(
        (h) => /パラメーター名|parameter/.test(h)
      ) && !headers.some((h) => /プロパティ|property/.test(h));

      if (!isResponseTable || isParamTable) return;

      const nameIdx = this.findHeaderIndex(headers, /name|プロパティ名|名前|field|フィールド名/);
      const typeIdx = this.findHeaderIndex(headers, /type|型/);
      const descIdx = this.findHeaderIndex(headers, /description|説明|内容/);

      $(table)
        .find("tr")
        .slice(1)
        .each((_j, row) => {
          const cells = $(row).find("td");
          if (cells.length < 2) return;

          const name = nameIdx >= 0 ? $(cells[nameIdx]).text().trim() : $(cells[0]).text().trim();
          const type = typeIdx >= 0 ? $(cells[typeIdx]).text().trim() : (cells.length >= 2 ? $(cells[1]).text().trim() : "");
          const description = descIdx >= 0 ? $(cells[descIdx]).text().trim().slice(0, 300) : "";

          if (name) {
            fields.push({ name, type, description });
          }
        });
    });

    return fields;
  }

  /**
   * ヘッダー配列からパターンに一致するインデックスを探す。
   */
  private findHeaderIndex(headers: string[], pattern: RegExp): number {
    return headers.findIndex((h) => pattern.test(h));
  }

  /**
   * operation/ IDが見つからない場合の代替パース。
   * ページ全体からHTTPメソッド + パスのパターンを探して抽出する。
   */
  private parseAlternativePatterns(
    $: cheerio.CheerioAPI,
    pageUrl: string,
    apiId: string
  ): EndpointDocument[] {
    const endpoints: EndpointDocument[] = [];
    const seen = new Set<string>();

    // h1, h2, h3 の直後にメソッド+パスが記述されているパターン
    $("h1, h2, h3").each((_i, heading) => {
      const title = $(heading).text().trim();
      let nextEl = $(heading).next();
      let method: string | undefined;
      let path: string | undefined;

      // 見出しの次の数要素を走査
      for (let tries = 0; tries < 5 && nextEl.length > 0; tries++) {
        const text = nextEl.text().trim();
        const match = text.match(
          /\b(GET|POST|PUT|DELETE|PATCH)\s+(\/api\/v1\/\S+)/
        );
        if (match && HTTP_METHODS_SET.has(match[1])) {
          method = match[1];
          path = match[2];
          break;
        }
        nextEl = nextEl.next();
      }

      if (!method || !path) return;

      const key = `${method}:${path}`;
      if (seen.has(key)) return;
      seen.add(key);

      const id = `${apiId}:${method}:${path}`;
      endpoints.push({
        id,
        apiId,
        category: "",
        method: method as HttpMethod,
        path,
        title: title || path,
        description: "",
        parameters: [],
        responseFields: [],
        examples: [],
        authentication: [],
        permissions: [],
        notes: [],
        sourceUrl: pageUrl,
      });
    });

    return endpoints;
  }
}
