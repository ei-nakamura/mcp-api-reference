import { parseArgs } from "node:util";
import * as fs from "node:fs";
import { createServer, defaultCacheDir } from "./server.js";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      refresh: { type: "string", short: "r" },
      "clear-cache": { type: "boolean" },
      config: { type: "string", short: "c" },
    },
    allowPositionals: false,
  });

  if (values["clear-cache"]) {
    const cacheDir = defaultCacheDir();
    if (fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true });
    }
    console.error("[mcp-api-reference] Cache cleared.");
    process.exit(0);
  }

  const server = await createServer({
    refreshTarget: values["refresh"] as string | undefined,
    configPath: values["config"] as string | undefined,
  });

  await server.start();
}

// Graceful shutdown
process.on("SIGTERM", () => {
  console.error("[mcp-api-reference] Received SIGTERM, shutting down");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.error("[mcp-api-reference] Received SIGINT, shutting down");
  process.exit(0);
});

process.on("unhandledRejection", (reason) => {
  console.error("[mcp-api-reference] Unhandled rejection:", reason);
});

main().catch((err) => {
  console.error("[mcp-api-reference] Fatal:", err);
  process.exit(1);
});
