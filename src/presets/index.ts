import { ParserRegistry } from "../core/parser.js";
import { Logger } from "../utils/logger.js";
import { kintoneConfig } from "./kintone/config.js";
import { KintoneParser } from "./kintone/parser.js";

/**
 * 全プリセットを ParserRegistry に登録して返す
 * Phase 1: kintone のみ対応
 */
export function createRegistryWithPresets(logger: Logger): ParserRegistry {
  const registry = new ParserRegistry(logger);
  const kintoneParser = new KintoneParser();
  registry.register(kintoneConfig.id, kintoneConfig, kintoneParser);
  return registry;
}

export { kintoneConfig } from "./kintone/config.js";
export { KintoneParser } from "./kintone/parser.js";
