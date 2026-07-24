/*
 * AquaRAS 后端服务入口
 * ---------------------------------------------------------------------------
 * 启动:  node server.js
 * 默认监听 0.0.0.0:3000，可通过 PORT 环境变量覆盖
 *
 * 端点:
 *   GET    /api/ras/designs        — 方案列表
 *   GET    /api/ras/designs/:id    — 单个方案
 *   POST   /api/ras/designs        — 新建方案
 *   PUT    /api/ras/designs/:id    — 更新方案
 *   DELETE /api/ras/designs/:id    — 删除方案
 *   GET    /api/suppliers           — 供应商列表
 *   POST   /api/suppliers/:id/hide  — 隐藏供应商(admin)
 *   POST   /api/suppliers/:id/unhide— 取消隐藏(admin)
 *   GET    /api/knowledge/*         — 知识库CRUD
 *   GET    /api/health              — 健康检查 (v1.19.0)
 */

const express = require("express");
const cors = require("cors");
const path = require("path");

const rasRoutes = require("./routes");
const supplierRoutes = require("./supplier-routes");
const knowledgeRoutes = require("./knowledge-routes");

const app = express();
const PORT = process.env.PORT || 3000;

// ---- 中间件 ----
app.use(cors());                             // 允许跨域（前端可不同端口）
app.use(express.json({ limit: "5mb" }));    // 解析 JSON body（支持大方案 result）

// ---- 路由 ----
app.use("/api/ras/designs", rasRoutes);
app.use("/api/suppliers", supplierRoutes);
app.use("/api/knowledge", knowledgeRoutes);

// 计算端点 —— 复用 engine.js 做服务端估算
app.post("/api/ras/compute", (req, res) => {
  try {
    const { compute } = require("./ras-engine");
    const inputs = req.body || {};
    if (!inputs.speciesKey) return res.status(400).json({ error: "speciesKey 是必填字段" });
    const result = compute(inputs);
    res.json(result);
  } catch (e) {
    console.error("[ras] compute error:", e.message);
    res.status(500).json({ error: "计算失败: " + e.message });
  }
});

// 健康检查
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", version: "1.19.0", timestamp: new Date().toISOString() });
});

// 可选：静态文件服务（生产环境可直接用此后端 serve 前端 dist/）
if (process.env.SERVE_STATIC === "1") {
  const distDir = path.join(__dirname, "..", "dist");
  app.use(express.static(distDir));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
  console.log("[static] 静态文件服务已启用 (dist/)");
}

// ---- 启动 ----
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[AquaRAS] 后端服务已启动 → http://localhost:${PORT}`);
  console.log(`[AquaRAS] API → http://localhost:${PORT}/api/ras/designs`);
  console.log(`[AquaRAS] 供应商库 → http://localhost:${PORT}/api/suppliers (含 hide/unhide)`);
  console.log(`[AquaRAS] 知识库 → http://localhost:${PORT}/api/knowledge`);
  console.log(`[AquaRAS] 版本 v1.19.0 | 模式: ${process.env.SERVE_STATIC === "1" ? "生产(含静态)" : "API only"}`);
});
