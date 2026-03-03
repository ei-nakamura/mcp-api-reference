import { PresetConfig } from "../../types/config.js";

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
