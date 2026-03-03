/**
 * @module index
 * @description MCPサーバーのCLIエントリポイント。
 * コマンドライン引数を解析し、サーバーの起動またはキャッシュ操作を実行する。
 */
import { parseArgs } from "node:util";
import * as fs from "node:fs";
import { createServer, defaultCacheDir } from "./server.js";

/**
 * メイン関数。CLIオプションに応じてサーバー起動またはキャッシュクリアを行う。
 *
 * CLIオプション:
 * - `--refresh <api-id>` / `-r`: 指定APIのドキュメントを強制再取得
 * - `--clear-cache`: 全キャッシュを削除して終了
 * - `--config <path>` / `-c`: カスタムサイト設定ファイルのパス
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      refresh: { type: "string", short: "r" },
      "clear-cache": { type: "boolean" },
      config: { type: "string", short: "c" },
    },
    allowPositionals: false,
  });

  // --clear-cache が指定された場合はキャッシュを削除して終了
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

// グレースフルシャットダウン: SIGTERMを受信したらプロセスを正常終了
process.on("SIGTERM", () => {
  console.error("[mcp-api-reference] Received SIGTERM, shutting down");
  process.exit(0);
});

// グレースフルシャットダウン: SIGINT (Ctrl+C) を受信したらプロセスを正常終了
process.on("SIGINT", () => {
  console.error("[mcp-api-reference] Received SIGINT, shutting down");
  process.exit(0);
});

// 未処理のPromise拒否をキャッチしてログ出力
process.on("unhandledRejection", (reason) => {
  console.error("[mcp-api-reference] Unhandled rejection:", reason);
});

main().catch((err) => {
  console.error("[mcp-api-reference] Fatal:", err);
  process.exit(1);
});
