/*
 * AquaRAS 后端路由 — /api/ras/designs CRUD
 * 字段映射与前端 cloudsync.js 的 toPayload/fromApi 完全对齐
 */
const express = require("express");
const router = express.Router();
const db = require("./db");

/* ========== LIST ========== */
router.get("/", (_req, res) => {
  try {
    const items = db.list();
    res.json(items);
  } catch (e) {
    console.error("[ras] list error:", e.message);
    res.status(500).json({ error: "数据库读取失败" });
  }
});

/* ========== GET by ID ========== */
router.get("/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "无效的 id" });
    const item = db.getById(id);
    if (!item) return res.status(404).json({ error: "方案不存在" });
    res.json({ data: item });
  } catch (e) {
    console.error("[ras] get error:", e.message);
    res.status(500).json({ error: "数据库读取失败" });
  }
});

/* ========== CREATE ========== */
router.post("/", (req, res) => {
  try {
    const { name, speciesKey, annualTons, inputs, result, notes } = req.body;
    if (!name) return res.status(400).json({ error: "name 是必填字段" });

    const id = db.create({ name, speciesKey, annualTons, inputs, result, notes });
    res.status(201).json({ id, name });
  } catch (e) {
    console.error("[ras] create error:", e.message);
    res.status(500).json({ error: "创建方案失败" });
  }
});

/* ========== UPDATE ========== */
router.put("/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "无效的 id" });

    const { name, speciesKey, annualTons, inputs, result, notes } = req.body;
    const ok = db.update(id, { name, speciesKey, annualTons, inputs, result, notes });
    if (!ok) return res.status(404).json({ error: "方案不存在" });
    res.json({ id, updated: true });
  } catch (e) {
    console.error("[ras] update error:", e.message);
    res.status(500).json({ error: "更新方案失败" });
  }
});

/* ========== DELETE ========== */
router.delete("/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "无效的 id" });
    const ok = db.remove(id);
    if (!ok) return res.status(404).json({ error: "方案不存在" });
    res.json({ id, deleted: true });
  } catch (e) {
    console.error("[ras] delete error:", e.message);
    res.status(500).json({ error: "删除方案失败" });
  }
});

module.exports = router;
