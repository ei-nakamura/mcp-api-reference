import { createHash } from "node:crypto";

export function hashConfig(config: unknown): string {
  const json = JSON.stringify(config, Object.keys(config as object).sort());
  return createHash("sha256").update(json).digest("hex").slice(0, 16);
}
