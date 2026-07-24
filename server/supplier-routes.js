/*
 * AquaRAS 供应商库路由 — /api/suppliers
 *   GET   /                      — 列表（公开）
 *   GET   /categories            — 分类统计（公开）
 *   GET   /:id                   — 详情（公开）
 *   POST  /                      — 新增（需 admin）
 *   PUT   /:id                   — 更新（需 admin）
 *   DELETE /:id                  — 删除（需 admin）
 *   POST  /admin/verify          — 验证管理员密码
 */
const express = require("express");
const router = express.Router();
const db = require("./db");
const { requireAdmin, isAdminReq } = require("./auth");
const logger = require("./logger");

/* ========== 验证管理员密码 ========== */
router.post("/admin/verify", (req, res) => {
  const { password } = req.body || {};
  if (password === ADMIN_PASSWORD) {
    return res.json({ ok: true });
  }
  res.status(401).json({ ok: false, error: "密码错误" });
});

/* ========== 分类统计（须在 /:id 之前注册） ========== */
router.get("/categories", (req, res) => {
  try {
    const includeHidden = isAdminReq(req);
    const cats = db.getSupplierCategories(includeHidden);
    res.json(cats);
  } catch (e) {
    console.error("[suppliers] categories error:", e.message);
    res.status(500).json({ error: "读取分类失败" });
  }
});

/* ========== 列表（支持 ?category=&keyword=&region=） ========== */
router.get("/", (req, res) => {
  try {
    const { category, keyword, region } = req.query;
    const includeHidden = isAdminReq(req);
    const items = db.listSuppliers({ category, keyword, region, includeHidden });
    res.json(items);
  } catch (e) {
    console.error("[suppliers] list error:", e.message);
    res.status(500).json({ error: "读取供应商列表失败" });
  }
});

/* ========== 详情 ========== */
router.get("/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "无效的 id" });
    const item = db.getSupplierById(id);
    if (!item) return res.status(404).json({ error: "供应商不存在" });
    // 非管理员无法查看已隐藏的供应商
    if (item.hidden && !isAdminReq(req)) return res.status(404).json({ error: "供应商不存在" });
    res.json(item);
  } catch (e) {
    console.error("[suppliers] get error:", e.message);
    res.status(500).json({ error: "读取供应商失败" });
  }
});

/* ========== 新增（需管理员） ========== */
router.post("/", requireAdmin, (req, res) => {
  try {
    const { category, name, brand, product, contact, region, website, tags, description, sort_order } = req.body || {};
    if (!category || !name) {
      return res.status(400).json({ error: "category 和 name 为必填字段" });
    }
    const validCategories = ["equipment", "material", "construction", "design", "consumable"];
    if (!validCategories.includes(category)) {
      return res.status(400).json({ error: "无效的分类" });
    }
    const id = db.createSupplier({ category, name, brand, product, contact, region, website, tags, description, sort_order });
    const item = db.getSupplierById(id);
    res.status(201).json(item);
  } catch (e) {
    console.error("[suppliers] create error:", e.message);
    res.status(500).json({ error: "创建供应商失败" });
  }
});

/* ========== 更新（需管理员） ========== */
router.put("/:id", requireAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "无效的 id" });
    const existing = db.getSupplierById(id);
    if (!existing) return res.status(404).json({ error: "供应商不存在" });

    const { category, name, brand, product, contact, region, website, tags, description, sort_order } = req.body || {};
    if (category && !["equipment", "material", "construction", "design", "consumable"].includes(category)) {
      return res.status(400).json({ error: "无效的分类" });
    }
    db.updateSupplier(id, { category, name, brand, product, contact, region, website, tags, description, sort_order });
    const item = db.getSupplierById(id);
    res.json(item);
  } catch (e) {
    console.error("[suppliers] update error:", e.message);
    res.status(500).json({ error: "更新供应商失败" });
  }
});

/* ========== 删除（需管理员） ========== */
router.delete("/:id", requireAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "无效的 id" });
    const existing = db.getSupplierById(id);
    if (!existing) return res.status(404).json({ error: "供应商不存在" });
    db.removeSupplier(id);
    res.json({ ok: true });
  } catch (e) {
    console.error("[suppliers] delete error:", e.message);
    res.status(500).json({ error: "删除供应商失败" });
  }
});

/* ========== 隐藏/取消隐藏（需管理员） ========== */
router.post("/:id/hide", requireAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    console.log("[suppliers] hide 请求: id=", id, "params:", req.params);
    if (isNaN(id)) return res.status(400).json({ error: "无效的 id" });
    const existing = db.getSupplierById(id);
    if (!existing) { console.log("[suppliers] hide: 供应商不存在 id=", id); return res.status(404).json({ error: "供应商不存在" }); }
    const result = db.hideSupplier(id, true);
    console.log("[suppliers] hide 结果: changes=", result, "supplier:", existing.name);
    res.json({ ok: true, hidden: true });
  } catch (e) {
    console.error("[suppliers] hide error:", e.message, e.stack);
    res.status(500).json({ error: "操作失败" });
  }
});

router.post("/:id/unhide", requireAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    console.log("[suppliers] unhide 请求: id=", id);
    if (isNaN(id)) return res.status(400).json({ error: "无效的 id" });
    const existing = db.getSupplierById(id);
    if (!existing) return res.status(404).json({ error: "供应商不存在" });
    const result = db.hideSupplier(id, false);
    console.log("[suppliers] unhide 结果: changes=", result);
    res.json({ ok: true, hidden: false });
  } catch (e) {
    console.error("[suppliers] unhide error:", e.message, e.stack);
    res.status(500).json({ error: "操作失败" });
  }
});

module.exports = router;
