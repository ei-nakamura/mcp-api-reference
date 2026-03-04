/**
 * @module types/document
 * @description エンドポイントドキュメントの型定義とZodスキーマ。
 * パーサーが抽出したAPI情報を保持するデータ構造を定義する。
 * キャッシュからの復元時にZodスキーマでデータの完全性を検証する。
 */
import { z } from "zod";

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

/** EndpointDocumentのZodスキーマ。キャッシュ復元時のデータ検証に使用する。 */
export const EndpointDocumentSchema = z.object({
  id: z.string(),
  apiId: z.string(),
  category: z.string(),
  method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]),
  path: z.string(),
  title: z.string(),
  description: z.string(),
  parameters: z.array(z.object({
    name: z.string(),
    type: z.string(),
    required: z.boolean(),
    description: z.string(),
  })),
  responseFields: z.array(z.object({
    name: z.string(),
    type: z.string(),
    description: z.string(),
  })),
  examples: z.array(z.object({
    type: z.enum(["request", "response"]),
    format: z.enum(["json", "curl", "url"]),
    content: z.string(),
  })),
  authentication: z.array(z.string()),
  permissions: z.array(z.string()),
  notes: z.array(z.string()),
  sourceUrl: z.string(),
});

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
