export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  private level: LogLevel;

  constructor(level: LogLevel = "info") {
    this.level = level;
  }

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

export function createLogger(level: LogLevel = "info"): Logger {
  return new Logger(level);
}
