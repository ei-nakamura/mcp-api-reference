/**
 * @module utils/glob
 * @description URLパターンマッチングユーティリティ。
 * globパターン ("**", "*", "?") を正規表現に変換してURL判定を行う。
 */

/**
 * globパターンを正規表現に変換する。
 * - `**` → 任意の文字列 (パス区切り含む)
 * - `*` → パス区切り以外の任意の文字列
 * - `?` → パス区切り以外の任意の1文字
 * @param pattern - globパターン文字列
 * @returns 対応する正規表現
 */
export function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "__DOUBLE_STAR__")
    .replace(/\*/g, "[^/]*")
    .replace(/__DOUBLE_STAR__/g, ".*")
    .replace(/\?/g, "[^/]");

  return new RegExp(`^${escaped}$`);
}

/**
 * URLがinclude/excludeパターンに一致するか判定する。
 * includeパターンが指定されている場合、いずれかに一致する必要がある。
 * excludeパターンに一致するURLは常に除外される。
 * @param url - 判定対象のURL
 * @param includePatterns - 許可パターンの配列 (空の場合は全URL許可)
 * @param excludePatterns - 除外パターンの配列
 * @returns パターンに一致する場合true
 */
export function matchesPatterns(
  url: string,
  includePatterns: string[],
  excludePatterns: string[]
): boolean {
  if (includePatterns.length > 0) {
    const included = includePatterns.some((p) => globToRegex(p).test(url));
    if (!included) return false;
  }
  const excluded = excludePatterns.some((p) => globToRegex(p).test(url));
  return !excluded;
}
