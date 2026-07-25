/*
 * AquaRAS 知识库路由 — /api/knowledge
 *   GET    /categories              — 类别列表（含覆盖统计，仅元数据，无数值）
 *   GET    /leaves/:category         — 获取某类别的所有叶子参数（含当前覆盖值）【管理员】
 *   GET    /full                    — 面向管理员的完整知识库（含私有 IP 叙述）【管理员】
 *   GET    /overrides               — 列表所有覆盖值
 *   PUT    /overrides               — 批量保存覆盖值 { category, overrides: [{item_key, value, value_type, notes}] }
 *   POST   /reset                   — 重置覆盖值（body: { category } 或 {} 全部重置）
 *   GET    /export                  — 导出合并后的完整知识库 JSON
 *   GET    /audit                   — 审计日志 (?category=&limit=)
 */
const express = require("express");
const router = express.Router();
const db = require("./db");
const { getCategoryList, getCategoryLeaves, applyOverrides, getBase, getFull } = require("./knowledge-merge");
const { requireAdmin } = require("./auth");
const logger = require("./logger");

/* ===== 读取操作 ===== */

// 类别列表（仅元数据/描述，不含任何数值系数，可公开用于知识库管理面板导航）
router.get("/categories", (_req, res) => {
  try {
    const cats = getCategoryList();
    const overrides = db.listKnowledgeOverrides();
    // 统计每个类别的覆盖数量
    const ovCountMap = {};
    overrides.forEach(ov => { ovCountMap[ov.category] = (ovCountMap[ov.category] || 0) + 1; });
    cats.forEach(c => { c.overridesCount = ovCountMap[c.key] || 0; });
    res.json(cats);
  } catch (e) {
    console.error("[knowledge] categories error:", e.message);
    res.status(500).json({ error: "读取类别失败" });
  }
});

// 某类别叶子参数（含当前覆盖值）—— 含完整系数，仅管理员可访问
router.get("/leaves/:category", requireAdmin, (req, res) => {
  try {
    const { category } = req.params;
    const leaves = getCategoryLeaves(category);
    const overrides = db.listKnowledgeOverrides(category);
    const ovMap = {};
    overrides.forEach(ov => { ovMap[ov.item_key] = ov; });
    // 标记哪些值被覆盖了
    const enriched = leaves.map(leaf => ({
      ...leaf,
      overrideValue: ovMap[leaf.key] ? ovMap[leaf.key].value : null,
      isOverridden: !!ovMap[leaf.key],
      overrideNotes: ovMap[leaf.key] ? ovMap[leaf.key].notes : null,
    }));
    res.json(enriched);
  } catch (e) {
    console.error("[knowledge] leaves error:", e.message);
    res.status(500).json({ error: "读取参数失败" });
  }
});

// 导出合并后的完整知识库（含私有 IP 叙述）
router.get("/export", requireAdmin, (_req, res) => {
  try {
    const overrides = db.listKnowledgeOverrides();
    const merged = getFull(overrides);
    res.json(merged);
  } catch (e) {
    console.error("[knowledge] export error:", e.message);
    res.status(500).json({ error: "导出失败" });
  }
});

// 面向管理员的完整知识库（基线 + 覆盖 + 私有 IP 叙述），用于"设计计算书"等机密视图
router.get("/full", requireAdmin, (_req, res) => {
  try {
    const overrides = db.listKnowledgeOverrides();
    res.json(getFull(overrides));
  } catch (e) {
    console.error("[knowledge] full error:", e.message);
    res.status(500).json({ error: "读取完整知识库失败" });
  }
});

// 审计日志
router.get("/audit", requireAdmin, (req, res) => {
  try {
    const { category, limit } = req.query;
    const rows = db.listKnowledgeAudit(category || null, parseInt(limit) || 100);
    res.json(rows);
  } catch (e) {
    console.error("[knowledge] audit error:", e.message);
    res.status(500).json({ error: "读取审计日志失败" });
  }
});

/* ===== 写操作（需管理员） ===== */

// 批量保存覆盖值
router.put("/overrides", requireAdmin, (req, res) => {
  try {
    const { category, overrides } = req.body || {};
    if (!category || !Array.isArray(overrides)) {
      return res.status(400).json({ error: "缺少 category 或 overrides 数组" });
    }
    const result = db.saveKnowledgeOverrides(category, overrides);
    res.json({ ok: true, overrides: result });
  } catch (e) {
    console.error("[knowledge] save overrides error:", e.message);
    res.status(500).json({ error: "保存覆盖值失败" });
  }
});

// 重置覆盖值
router.post("/reset", requireAdmin, (req, res) => {
  try {
    const { category } = req.body || {};
    db.resetKnowledgeOverrides(category || null);
    res.json({ ok: true });
  } catch (e) {
    console.error("[knowledge] reset error:", e.message);
    res.status(500).json({ error: "重置失败" });
  }
});

module.exports = router;
