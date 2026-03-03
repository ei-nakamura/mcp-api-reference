/**
 * @module presets
 * @description プリセットの一括登録モジュール。
 * 組み込みのAPIプリセット (現在はkintoneのみ) をParserRegistryに登録する。
 */
import { ParserRegistry } from "../core/parser.js";
import { Logger } from "../utils/logger.js";
import { kintoneConfig } from "./kintone/config.js";
import { KintoneParser } from "./kintone/parser.js";

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
  return registry;
}

export { kintoneConfig } from "./kintone/config.js";
export { KintoneParser } from "./kintone/parser.js";
