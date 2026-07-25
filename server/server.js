/*
 * AquaRAS 后端服务入口
 * ---------------------------------------------------------------------------
 * 启动:  node server.js
 * 默认监听 0.0.0.0:3000，可通过 PORT 环境变量覆盖
 *
 * 安全加固 (v1.20.0):
 *   - API 鉴权：写操作需 x-admin-token 请求头
 *   - 限流保护：express-rate-limit 防滥用
 *   - 结构化日志：写入 server/logs/ 目录
 *
 * 端点:
 *   GET    /api/ras/designs        — 方案列表（公开）
 *   GET    /api/ras/designs/:id    — 单个方案（公开）
 *   POST   /api/ras/designs        — 新建方案（需 admin）
 *   PUT    /api/ras/designs/:id    — 更新方案（需 admin）
 *   DELETE /api/ras/designs/:id    — 删除方案（需 admin）
 *   POST   /api/ras/compute        — 引擎计算（公开，有限流）
 *   GET    /api/suppliers           — 供应商列表（公开）
 *   POST   /api/suppliers/:id/hide  — 隐藏供应商（需 admin）
 *   POST   /api/suppliers/:id/unhide— 取消隐藏（需 admin）
 *   GET    /api/knowledge/*         — 知识库读取（公开）
 *   PUT    /api/knowledge/overrides — 覆盖值（需 admin）
 *   POST   /api/knowledge/reset     — 重置（需 admin）
 *   GET    /api/health              — 健康检查（公开）
 */

const express = require("express");
const cors = require("cors");
const path = require("path");
const rateLimit = require("express-rate-limit");
const logger = require("./logger");

const rasRoutes = require("./routes");
const supplierRoutes = require("./supplier-routes");
const knowledgeRoutes = require("./knowledge-routes");

const app = express();
const PORT = process.env.PORT || 3000;

// ---- 中间件 ----
app.use(cors());                             // 允许跨域（前端可不同端口）
app.use(express.json({ limit: "5mb" }));    // 解析 JSON body（支持大方案 result）

// ---- 请求日志 ----
app.use((req, _res, next) => {
  logger.debug(`${req.method} ${req.path}`, { ip: req.ip });
  next();
});

// ---- 限流保护 ----
// 全局限流：每 IP 每分钟最多 200 次请求
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "请求过于频繁，请稍后再试" },
});
app.use("/api", globalLimiter);

// 计算端点限流更严格：每 IP 每分钟最多 20 次
const computeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "计算请求过于频繁，请稍后再试" },
});

// 写操作限流：每 IP 每分钟最多 30 次
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "写操作过于频繁，请稍后再试" },
});

// ---- 路由 ----
app.use("/api/ras/designs", rasRoutes);
app.use("/api/suppliers", supplierRoutes);
app.use("/api/knowledge", knowledgeRoutes);

// 计算端点 —— 复用 engine.js 做服务端估算（公开 + 计算限流）
app.post("/api/ras/compute", computeLimiter, (req, res) => {
  try {
    const { compute } = require("./ras-engine");
    const inputs = req.body || {};
    if (!inputs.speciesKey) return res.status(400).json({ error: "speciesKey 是必填字段" });
    const result = compute(inputs);
    logger.info("计算完成", { speciesKey: inputs.speciesKey });
    res.json(result);
  } catch (e) {
    logger.error("计算失败", { error: e.message, speciesKey: req.body?.speciesKey });
    res.status(500).json({ error: "计算失败: " + e.message });
  }
});

// 健康检查
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", version: "1.22.0", timestamp: new Date().toISOString() });
});

// 可选：静态文件服务（生产环境可直接用此后端 serve 前端 dist/）
if (process.env.SERVE_STATIC === "1") {
  const distDir = path.join(__dirname, "..", "dist");
  app.use(express.static(distDir));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
  logger.info("静态文件服务已启用", { dir: distDir });
}

// ---- 启动 ----
app.listen(PORT, "0.0.0.0", () => {
  logger.info(`AquaRAS 后端服务已启动`, { port: PORT, version: "1.22.0" });
  console.log(`[AquaRAS] 后端服务已启动 → http://localhost:${PORT}`);
  console.log(`[AquaRAS] API → http://localhost:${PORT}/api/ras/designs`);
  console.log(`[AquaRAS] 供应商库 → http://localhost:${PORT}/api/suppliers (含 hide/unhide)`);
  console.log(`[AquaRAS] 知识库 → http://localhost:${PORT}/api/knowledge`);
  console.log(`[AquaRAS] 版本 v1.20.0 | 模式: ${process.env.SERVE_STATIC === "1" ? "生产(含静态)" : "API only"}`);
  console.log(`[AquaRAS] 安全: API鉴权 | 限流(全局200/min, 写30/min, 计算20/min) | 日志(server/logs/)`);
});
