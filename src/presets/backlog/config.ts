import { PresetConfig } from "../../types/config.js";

export const backlogConfig: PresetConfig = {
  id: "backlog",
  name: "Backlog API v2",
  description: "Nulab Backlog REST API v2 reference documentation",
  baseUrl: "https://developer.nulab.com",
  presetModule: "backlog",
  crawl: {
    startUrl: "https://developer.nulab.com/ja/docs/backlog/",
    includePatterns: ["https://developer.nulab.com/ja/docs/backlog/api/**"],
    excludePatterns: [],
    maxPages: 200,
    delayMs: 1000,
  },
  parser: { type: "preset" },
};
