type LogLevel = "info" | "warn" | "error" | "debug";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  [key: string]: unknown;
}

function formatEntry(level: LogLevel, message: string, context?: Record<string, unknown>): string {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  };
  return JSON.stringify(entry);
}

export const logger = {
  info(message: string, context?: Record<string, unknown>) {
    console.log(formatEntry("info", message, context));
  },
  warn(message: string, context?: Record<string, unknown>) {
    console.warn(formatEntry("warn", message, context));
  },
  error(message: string, context?: Record<string, unknown>) {
    console.error(formatEntry("error", message, context));
  },
  debug(message: string, context?: Record<string, unknown>) {
    if (process.env.DEBUG) {
      console.debug(formatEntry("debug", message, context));
    }
  },
};
