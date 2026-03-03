/**
 * @module utils/hash
 * @description 設定オブジェクトのハッシュ生成ユーティリティ。
 * キャッシュの無効化判定に使用する。
 */
import { createHash } from "node:crypto";

/**
 * 設定オブジェクトのSHA-256ハッシュ (先頭16文字) を生成する。
 * キーをソートした上でJSONシリアライズするため、プロパティの順序に依存しない。
 * @param config - ハッシュ対象の設定オブジェクト
 * @returns 16文字の16進数ハッシュ文字列
 */
export function hashConfig(config: unknown): string {
  const json = JSON.stringify(config, Object.keys(config as object).sort());
  return createHash("sha256").update(json).digest("hex").slice(0, 16);
}
