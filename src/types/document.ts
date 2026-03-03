/**
 * @module types/document
 * @description エンドポイントドキュメントの型定義。
 * パーサーが抽出したAPI情報を保持するデータ構造を定義する。
 */

/** サポートするHTTPメソッド */
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

/** リクエストパラメータの情報 */
export interface ParameterInfo {
  /** パラメータ名 */
  name: string;
  /** データ型 (例: "string", "number", "object[]") */
  type: string;
  /** 必須パラメータかどうか */
  required: boolean;
  /** パラメータの説明 */
  description: string;
}

/** レスポンスフィールドの情報 */
export interface FieldInfo {
  /** フィールド名 */
  name: string;
  /** データ型 */
  type: string;
  /** フィールドの説明 */
  description: string;
}

/** リクエスト/レスポンスのサンプルコード */
export interface ExampleInfo {
  /** サンプルの種類 */
  type: "request" | "response";
  /** フォーマット */
  format: "json" | "curl" | "url";
  /** サンプルコードの内容 */
  content: string;
}

/**
 * APIエンドポイントのドキュメント。
 * パーサーが1つのAPIエンドポイントページから抽出した全情報を保持する。
 */
export interface EndpointDocument {
  /** 一意識別子 ("{apiId}:{method}:{path}" 形式) */
  id: string;
  /** API識別子 (例: "kintone") */
  apiId: string;
  /** カテゴリ名 (例: "レコード", "アプリ") */
  category: string;
  /** HTTPメソッド */
  method: HttpMethod;
  /** エンドポイントパス (例: "/k/v1/record.json") */
  path: string;
  /** エンドポイントのタイトル */
  title: string;
  /** エンドポイントの説明文 */
  description: string;
  /** リクエストパラメータの配列 */
  parameters: ParameterInfo[];
  /** レスポンスフィールドの配列 */
  responseFields: FieldInfo[];
  /** サンプルコードの配列 */
  examples: ExampleInfo[];
  /** 認証方式の配列 */
  authentication: string[];
  /** 必要なアクセス権の配列 */
  permissions: string[];
  /** 注記・制限事項の配列 */
  notes: string[];
  /** ドキュメントの元URL */
  sourceUrl: string;
}
