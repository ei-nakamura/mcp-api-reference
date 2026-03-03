/**
 * @module utils/logger
 * @description 構造化ロガー。
 * ログレベルに応じたフィルタリングを行い、stderrにタイムスタンプ付きで出力する。
 * stdoutはMCPプロトコル通信に使用されるため、ログは全てstderrに出力する。
 */

/** ログレベル */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** ログレベルの数値マッピング (小さいほど詳細) */
const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * 構造化ロガー。
 * 設定されたログレベル以上のメッセージのみ出力する。
 * 出力先はstderr (stdoutはMCP通信に使用)。
 */
export class Logger {
  private level: LogLevel;

  /**
   * @param level - 最低出力ログレベル (デフォルト: "info")
   */
  constructor(level: LogLevel = "info") {
    this.level = level;
  }

  /**
   * ログメッセージを出力する (内部メソッド)。
   * 設定レベル未満のメッセージはスキップされる。
   */
  private log(level: LogLevel, message: string, data?: unknown): void {
    if (LOG_LEVELS[level] < LOG_LEVELS[this.level]) return;
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    if (data !== undefined) {
      process.stderr.write(`${prefix} ${message} ${JSON.stringify(data)}\n`);
    } else {
      process.stderr.write(`${prefix} ${message}\n`);
    }
  }

  debug(message: string, data?: unknown): void { this.log("debug", message, data); }
  info(message: string, data?: unknown): void { this.log("info", message, data); }
  warn(message: string, data?: unknown): void { this.log("warn", message, data); }
  error(message: string, data?: unknown): void { this.log("error", message, data); }
}

/** ロガーのファクトリ関数 */
export function createLogger(level: LogLevel = "info"): Logger {
  return new Logger(level);
}
