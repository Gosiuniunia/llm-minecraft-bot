/**
 * Minimal logger with timestamps and log levels.
 * Replace with a proper library (pino, winston) for production use.
 */

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL = LEVELS[process.env.LOG_LEVEL ?? "info"] ?? LEVELS.info;

function format(level, args) {
  const ts = new Date().toISOString();
  const msg = args
    .map((a) => (typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)))
    .join(" ");
  return `[${ts}] [${level.toUpperCase()}] ${msg}`;
}

function log(level, ...args) {
  if (LEVELS[level] < MIN_LEVEL) return;
  const line = format(level, args);
  if (level === "error" || level === "warn") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (...a) => log("debug", ...a),
  info: (...a) => log("info", ...a),
  warn: (...a) => log("warn", ...a),
  error: (...a) => log("error", ...a),
};
