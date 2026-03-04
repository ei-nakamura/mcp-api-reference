/**
 * @module core/generic-parser
 * @description CSSセレクタベースの汎用APIドキュメントパーサー。
 * 設定オブジェクトのCSSセレクタに基づき、任意のAPIドキュメントサイトから
 * エンドポイント情報を抽出する。
 */
import * as cheerio from "cheerio";
import { SiteParser, ParseResult } from "./parser.js";
import { EndpointDocument, HttpMethod, ParameterInfo } from "../types/document.js";

/**
 * GenericParserの設定。CSSセレクタでHTML要素の位置を指定する。
 */
export interface GenericParserConfig {
  /** パーサー名 */
  name: string;
  /** エンドポイントを含む要素のセレクタ（省略時はdocument全体） */
  endpointContainer?: string;
  /** HTTPメソッドのセレクタ */
  method?: string;
  /** パスのセレクタ */
  path?: string;
  /** タイトルのセレクタ（省略時: h1） */
  title?: string;
  /** 説明のセレクタ（省略時: 最初のp） */
  description?: string;
  /** パラメータテーブルのセレクタ */
  parameters?: string;
  /** パラメータ名の列インデックス（0始まり、省略時: 0） */
  parameterNameCol?: number;
  /** 型の列インデックス（省略時: 1） */
  parameterTypeCol?: number;
  /** 必須の列インデックス（省略時: 2） */
  parameterRequiredCol?: number;
  /** 説明の列インデックス（省略時: 3） */
  parameterDescCol?: number;
  /** レスポンステーブルのセレクタ */
  responseFields?: string;
}

/**
 * CSSセレクタ設定に基づき任意のAPIドキュメントHTMLをパースする汎用パーサー。
 * SiteParserインターフェースを実装し、ParserRegistryに登録して使用できる。
 */
export class GenericParser implements SiteParser {
  readonly name: string;
  private config: GenericParserConfig;

  constructor(config: GenericParserConfig) {
    this.name = config.name;
    this.config = config;
  }

  /**
   * HTMLからエンドポイント情報を抽出する。
   * methodまたはpathが取得できない場合は endpoints: [] を返す。
   * @param html - ページのHTML文字列
   * @param pageUrl - ページのURL
   * @param apiId - API識別子
   * @returns パース結果
   */
  parseEndpoint(html: string, pageUrl: string, apiId: string): ParseResult {
    const $ = cheerio.load(html);

    const findFirst = (sel: string) => {
      if (this.config.endpointContainer) {
        return $(this.config.endpointContainer).find(sel).first();
      }
      return $(sel).first();
    };

    const method = this.config.method
      ? findFirst(this.config.method).text().trim()
      : "";
    const path = this.config.path
      ? findFirst(this.config.path).text().trim()
      : "";

    if (!method || !path) {
      return { endpoints: [] };
    }

    const titleSel = this.config.title ?? "h1";
    const title = findFirst(titleSel).text().trim() || path;

    const descSel = this.config.description ?? "p";
    const description = findFirst(descSel).text().trim().slice(0, 500);

    const parameters = this.parseParameterTable($);

    const id = `${apiId}:${method.toUpperCase()}:${path}`;
    const doc: EndpointDocument = {
      id,
      apiId,
      category: "",
      method: method.toUpperCase() as HttpMethod,
      path,
      title,
      description,
      parameters,
      responseFields: [],
      examples: [],
      authentication: [],
      permissions: [],
      notes: [],
      sourceUrl: pageUrl,
    };

    return { endpoints: [doc] };
  }

  /** パラメータテーブルセレクタが設定されている場合、テーブルからパラメータ情報を抽出する */
  private parseParameterTable($: cheerio.CheerioAPI): ParameterInfo[] {
    if (!this.config.parameters) return [];

    const nameCol = this.config.parameterNameCol ?? 0;
    const typeCol = this.config.parameterTypeCol ?? 1;
    const requiredCol = this.config.parameterRequiredCol ?? 2;
    const descCol = this.config.parameterDescCol ?? 3;
    const params: ParameterInfo[] = [];

    $(this.config.parameters)
      .find("tr")
      .slice(1) // ヘッダー行をスキップ
      .each((_i, row) => {
        const cells = $(row).find("td");
        const name = nameCol < cells.length ? $(cells[nameCol]).text().trim() : "";
        if (!name) return;
        const type = typeCol < cells.length ? $(cells[typeCol]).text().trim() : "";
        const requiredText =
          requiredCol < cells.length ? $(cells[requiredCol]).text().trim() : "";
        const required = /true|yes|必須|required/i.test(requiredText);
        const description =
          descCol < cells.length
            ? $(cells[descCol]).text().trim().slice(0, 300)
            : "";
        params.push({ name, type, required, description });
      });

    return params;
  }
}
