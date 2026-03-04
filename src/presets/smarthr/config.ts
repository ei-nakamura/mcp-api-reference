/**
 * @module presets/smarthr/config
 * @description SmartHR APIプリセットの設定。
 * developer.smarthr.jp上のSmartHR APIリファレンスをクロール対象として定義する。
 */
import { PresetConfig } from "../../types/config.js";

/**
 * SmartHR APIのプリセット設定。
 * - クロール対象: developer.smarthr.jp/api 配下
 * - 除外: about_api, about_webhook, about_sandbox (概要ページ)
 * - 最大50ページ、リクエスト間隔1000ms
 *
 * SmartHR API仕様書はRedocベースの単一ページアプリケーションで、
 * /api ページに全エンドポイントのドキュメントが含まれる。
 */
export const smarthrConfig: PresetConfig = {
  id: "smarthr",
  name: "SmartHR API",
  description: "SmartHR REST API reference documentation",
  baseUrl: "https://developer.smarthr.jp",
  presetModule: "smarthr",
  crawl: {
    startUrl: "https://developer.smarthr.jp/api/",
    includePatterns: [
      "https://developer.smarthr.jp/api/**",
    ],
    excludePatterns: [
      "https://developer.smarthr.jp/api/about_api**",
      "https://developer.smarthr.jp/api/about_webhook**",
      "https://developer.smarthr.jp/api/about_sandbox**",
    ],
    maxPages: 50,
    delayMs: 1000,
  },
  parser: {
    type: "preset",
  },
};
