/**
 * @module presets
 * @description プリセットの一括登録モジュール。
 * 組み込みのAPIプリセット (現在はkintoneのみ) をParserRegistryに登録する。
 */
import { ParserRegistry } from "../core/parser.js";
import { Logger } from "../utils/logger.js";
import { kintoneConfig } from "./kintone/config.js";
import { KintoneParser } from "./kintone/parser.js";
import { backlogConfig } from "./backlog/config.js";
import { BacklogParser } from "./backlog/parser.js";
import { smarthrConfig } from "./smarthr/config.js";
import { SmartHRParser } from "./smarthr/parser.js";

/**
 * 全プリセットをParserRegistryに登録して返す。
 * 新しいプリセットを追加する場合はこの関数内でregister()を呼ぶ。
 * @param logger - ロガー
 * @returns プリセット登録済みのParserRegistry
 */
export function createRegistryWithPresets(logger: Logger): ParserRegistry {
  const registry = new ParserRegistry(logger);
  const kintoneParser = new KintoneParser();
  registry.register(kintoneConfig.id, kintoneConfig, kintoneParser);
  registry.register(backlogConfig.id, backlogConfig, new BacklogParser());
  registry.register(smarthrConfig.id, smarthrConfig, new SmartHRParser());
  return registry;
}

export { kintoneConfig } from "./kintone/config.js";
export { KintoneParser } from "./kintone/parser.js";
export { backlogConfig } from "./backlog/config.js";
export { BacklogParser } from "./backlog/parser.js";
export { smarthrConfig } from "./smarthr/config.js";
export { SmartHRParser } from "./smarthr/parser.js";
