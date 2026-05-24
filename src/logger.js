const fs = require("fs");
const path = require("path");
const config = require("./config");

fs.mkdirSync(config.logDir, { recursive: true });

const logFile = path.join(config.logDir, "openlib-crawler.log");

function write(level, message, meta = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...meta
  };

  const line = JSON.stringify(entry);
  fs.appendFile(logFile, `${line}\n`, (err) => {
    if (err) console.error("log write failed", err.message);
  });

  const printableMeta = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
  const output = `[${entry.ts}] ${level.toUpperCase()} ${message}${printableMeta}`;
  if (level === "error") console.error(output);
  else if (level === "warn") console.warn(output);
  else console.log(output);
}

module.exports = {
  debug: (message, meta) => {
    if (config.env !== "production") write("debug", message, meta);
  },
  info: (message, meta) => write("info", message, meta),
  warn: (message, meta) => write("warn", message, meta),
  error: (message, meta) => write("error", message, meta)
};
