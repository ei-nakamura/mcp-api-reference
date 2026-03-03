export function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "__DOUBLE_STAR__")
    .replace(/\*/g, "[^/]*")
    .replace(/__DOUBLE_STAR__/g, ".*")
    .replace(/\?/g, "[^/]");

  return new RegExp(`^${escaped}$`);
}

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
