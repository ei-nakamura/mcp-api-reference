/**
 * @module presets/kintone/config
 * @description kintone REST APIプリセットの設定。
 * cybozu.dev上のkintone REST APIリファレンスをクロール対象として定義する。
 */
import { PresetConfig } from "../../types/config.js";

/**
 * kintone REST APIのプリセット設定。
 * - クロール対象: cybozu.dev/ja/kintone/docs/rest-api/ 配下
 * - 除外: overview, changelog ページ
 * - 最大200ページ、リクエスト間隔1000ms
 */
export const kintoneConfig: PresetConfig = {
  id: "kintone",
  name: "kintone REST API",
  description: "Cybozu kintone REST API reference documentation",
  baseUrl: "https://cybozu.dev",
  presetModule: "kintone",
  crawl: {
    startUrl: "https://cybozu.dev/ja/kintone/docs/rest-api/",
    includePatterns: [
      "https://cybozu.dev/ja/kintone/docs/rest-api/**",
    ],
    excludePatterns: [
      "https://cybozu.dev/ja/kintone/docs/rest-api/overview/**",
      "https://cybozu.dev/ja/kintone/docs/rest-api/changelog/**",
    ],
    maxPages: 200,
    delayMs: 1000,
  },
  parser: {
    type: "preset",
  },
};
