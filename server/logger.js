/*
 * AquaRAS 日志系统
 * 
 * 在 PM2 环境下将日志写入文件，在普通终端也输出到控制台。
 * 日志目录：server/logs/
 *   - app.log   : 所有 Info 级别及以上日志
 *   - error.log : 仅 Error 日志
 * 
 * 使用：
 *   const logger = require("./logger");
 *   logger.info("服务启动", { port: 3000 });
 *   logger.warn("磁盘空间不足", { disk: "C:", freeGB: 2.5 });
 *   logger.error("数据库写入失败", { error: e.message });
 */

const fs = require("fs");
const path = require("path");

const LOG_DIR = path.join(__dirname, "logs");
const APP_LOG = path.join(LOG_DIR, "app.log");
const ERROR_LOG = path.join(LOG_DIR, "error.log");

// 确保日志目录存在
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/** 格式化日志消息 */
function formatLog(level, message, meta) {
  const now = new Date();
  const timestamp = now.toISOString();
  const dateStr = now.toLocaleDateString("zh-CN");
  const timeStr = now.toLocaleTimeString("zh-CN", { hour12: false });
  const metaStr = meta ? " " + JSON.stringify(meta) : "";
  return `[${dateStr} ${timeStr}] [${level}] ${message}${metaStr}`;
}

/** 写入日志文件 */
function writeLog(filePath, line) {
  try {
    fs.appendFileSync(filePath, line + "\n", "utf-8");
  } catch (_) {
    // 日志写入失败不应影响主流程
  }
}

/** 日志到控制台（不输出详细时间戳，保持精简） */
function consoleLog(level, message, meta) {
  const prefix = {
    INFO:  "\x1b[36m[info]\x1b[0m",    // 青色
    WARN:  "\x1b[33m[warn]\x1b[0m",    // 黄色
    ERROR: "\x1b[31m[error]\x1b[0m",   // 红色
    DEBUG: "\x1b[90m[debug]\x1b[0m",   // 灰色
  };
  const metaStr = meta ? " " + JSON.stringify(meta) : "";
  console.log(`${prefix[level]} ${message}${metaStr}`);
}

const logger = {
  info(message, meta) {
    const line = formatLog("INFO", message, meta);
    writeLog(APP_LOG, line);
    if (process.env.NODE_ENV !== "production") consoleLog("INFO", message, meta);
  },

  warn(message, meta) {
    const line = formatLog("WARN", message, meta);
    writeLog(APP_LOG, line);
    writeLog(ERROR_LOG, line);
    consoleLog("WARN", message, meta);
  },

  error(message, meta) {
    const line = formatLog("ERROR", message, meta);
    writeLog(APP_LOG, line);
    writeLog(ERROR_LOG, line);
    consoleLog("ERROR", message, meta);
  },

  debug(message, meta) {
    const line = formatLog("DEBUG", message, meta);
    writeLog(APP_LOG, line);
    if (process.env.DEBUG) consoleLog("DEBUG", message, meta);
  },
};

module.exports = logger;
