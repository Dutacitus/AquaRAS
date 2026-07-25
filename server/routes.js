/*
 * AquaRAS 后端路由 — /api/ras/designs CRUD
 * 字段映射与前端 cloudsync.js 的 toPayload/fromApi 完全对齐
 * 
 * 写操作 (POST/PUT/DELETE) 需要 x-admin-token 管理员鉴权
 */
const express = require("express");
const router = express.Router();
const db = require("./db");
const { requireAdmin } = require("./auth");
const logger = require("./logger");

/* ========== LIST（公开） ========== */
router.get("/", requireAdmin, (_req, res) => {
  try {
    const items = db.list();
    res.json(items);
  } catch (e) {
    logger.error("方案列表读取失败", { error: e.message });
    res.status(500).json({ error: "数据库读取失败" });
  }
});

/* ========== GET by ID（公开） ========== */
router.get("/:id", requireAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "无效的 id" });
    const item = db.getById(id);
    if (!item) return res.status(404).json({ error: "方案不存在" });
    res.json({ data: item });
  } catch (e) {
    logger.error("方案详情读取失败", { error: e.message, id: req.params.id });
    res.status(500).json({ error: "数据库读取失败" });
  }
});

/* ========== CREATE（需管理员） ========== */
router.post("/", requireAdmin, (req, res) => {
  try {
    const { name, speciesKey, annualTons, inputs, result, notes } = req.body;
    if (!name) return res.status(400).json({ error: "name 是必填字段" });

    const id = db.create({ name, speciesKey, annualTons, inputs, result, notes });
    logger.info("方案已创建", { id, name });
    res.status(201).json({ id, name });
  } catch (e) {
    logger.error("创建方案失败", { error: e.message, name: req.body?.name });
    res.status(500).json({ error: "创建方案失败" });
  }
});

/* ========== UPDATE（需管理员） ========== */
router.put("/:id", requireAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "无效的 id" });

    const { name, speciesKey, annualTons, inputs, result, notes } = req.body;
    const ok = db.update(id, { name, speciesKey, annualTons, inputs, result, notes });
    if (!ok) return res.status(404).json({ error: "方案不存在" });
    logger.info("方案已更新", { id, name });
    res.json({ id, updated: true });
  } catch (e) {
    logger.error("更新方案失败", { error: e.message, id: req.params.id });
    res.status(500).json({ error: "更新方案失败" });
  }
});

/* ========== DELETE（需管理员） ========== */
router.delete("/:id", requireAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "无效的 id" });
    const ok = db.remove(id);
    if (!ok) return res.status(404).json({ error: "方案不存在" });
    logger.info("方案已删除", { id });
    res.json({ id, deleted: true });
  } catch (e) {
    logger.error("删除方案失败", { error: e.message, id: req.params.id });
    res.status(500).json({ error: "删除方案失败" });
  }
});

module.exports = router;
