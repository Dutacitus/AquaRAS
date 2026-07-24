/*
 * SQLite 数据库层 — AquaRAS 方案存储
 * 表结构与 cloudsync.js 的 toPayload/fromApi 字段映射对齐
 */
const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = process.env.AQUARAS_DB || path.join(__dirname, "aquaras.db");

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS designs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      speciesKey TEXT    NOT NULL DEFAULT 'bass',
      annualTons REAL    NOT NULL DEFAULT 0,
      inputs     TEXT    NOT NULL DEFAULT '{}',   -- JSON
      result     TEXT    NOT NULL DEFAULT '{}',   -- JSON
      notes      TEXT,
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_designs_created ON designs(created_at);
  `);
}

/* ======== CRUD ======== */

function list() {
  const d = getDb();
  return d.prepare("SELECT * FROM designs ORDER BY updated_at DESC").all().map(row => ({
    ...row,
    inputs: JSON.parse(row.inputs),
    result: JSON.parse(row.result),
  }));
}

function getById(id) {
  const d = getDb();
  const row = d.prepare("SELECT * FROM designs WHERE id = ?").get(id);
  if (!row) return null;
  return {
    ...row,
    inputs: JSON.parse(row.inputs),
    result: JSON.parse(row.result),
  };
}

function create({ name, speciesKey, annualTons, inputs, result, notes }) {
  const d = getDb();
  const stmt = d.prepare(`
    INSERT INTO designs (name, speciesKey, annualTons, inputs, result, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    name,
    speciesKey || "bass",
    annualTons || 0,
    JSON.stringify(inputs || {}),
    JSON.stringify(result || {}),
    notes || null
  );
  return info.lastInsertRowid;
}

function update(id, { name, speciesKey, annualTons, inputs, result, notes }) {
  const d = getDb();
  const stmt = d.prepare(`
    UPDATE designs SET
      name = COALESCE(?, name),
      speciesKey = COALESCE(?, speciesKey),
      annualTons = COALESCE(?, annualTons),
      inputs = COALESCE(?, inputs),
      result = COALESCE(?, result),
      notes = COALESCE(?, notes),
      updated_at = datetime('now')
    WHERE id = ?
  `);
  const info = stmt.run(
    name || null,
    speciesKey || null,
    annualTons != null ? annualTons : null,
    inputs ? JSON.stringify(inputs) : null,
    result ? JSON.stringify(result) : null,
    notes !== undefined ? notes : null,
    id
  );
  return info.changes > 0;
}

function remove(id) {
  const d = getDb();
  const info = d.prepare("DELETE FROM designs WHERE id = ?").run(id);
  return info.changes > 0;
}

/* ======== 供应商库 CRUD ======== */

function initSuppliersSchema() {
  const d = getDb();
  d.exec(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      category    TEXT    NOT NULL,
      name        TEXT    NOT NULL,
      brand       TEXT,
      product     TEXT,
      contact     TEXT,
      region      TEXT,
      website     TEXT,
      tags        TEXT    NOT NULL DEFAULT '[]',
      description TEXT,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      hidden      INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_suppliers_category ON suppliers(category);
    CREATE INDEX IF NOT EXISTS idx_suppliers_sort ON suppliers(sort_order);
  `);
  // 兼容已有数据库：如果 hidden 列不存在则添加
  try {
    const cols = d.pragma("table_info(suppliers)");
    const hasHidden = cols.some(c => c.name === "hidden");
    if (!hasHidden) {
      console.log("[db] 正在为 suppliers 表添加 hidden 列...");
      d.exec("ALTER TABLE suppliers ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0");
      console.log("[db] hidden 列添加成功");
    } else {
      console.log("[db] suppliers.hidden 列已存在，无需迁移");
    }
  } catch (e) {
    console.error("[db] 添加 hidden 列失败:", e.message);
  }
}

// 在 initSchema 中追加供应商表初始化
const _origInitSchema = initSchema;
initSchema = function() {
  _origInitSchema();
  initSuppliersSchema();
};

function listSuppliers({ category, keyword, region, includeHidden } = {}) {
  const d = getDb();
  let sql = "SELECT * FROM suppliers WHERE 1=1";
  const params = [];
  if (!includeHidden) { sql += " AND hidden = 0"; }
  if (category) { sql += " AND category = ?"; params.push(category); }
  if (keyword)  { sql += " AND (name LIKE ? OR brand LIKE ? OR product LIKE ? OR tags LIKE ?)"; params.push("%"+keyword+"%", "%"+keyword+"%", "%"+keyword+"%", "%"+keyword+"%"); }
  if (region)   { sql += " AND region = ?"; params.push(region); }
  sql += " ORDER BY sort_order ASC, id ASC";
  return d.prepare(sql).all(...params).map(row => ({
    ...row,
    tags: JSON.parse(row.tags || "[]"),
  }));
}

function getSupplierById(id) {
  const d = getDb();
  const row = d.prepare("SELECT * FROM suppliers WHERE id = ?").get(id);
  if (!row) return null;
  return { ...row, tags: JSON.parse(row.tags || "[]") };
}

function getSupplierCategories(includeHidden) {
  const d = getDb();
  const hiddenFilter = includeHidden ? "" : " WHERE hidden = 0";
  const rows = d.prepare("SELECT category, COUNT(*) AS cnt FROM suppliers" + hiddenFilter + " GROUP BY category ORDER BY cnt DESC").all();
  const catOrder = ["equipment", "material", "construction", "design", "consumable"];
  const catNames = { equipment:"设备供应商", material:"材料供应商", construction:"施工供应商", design:"设计供应商", consumable:"耗材供应商" };
  return rows.map(r => ({ key: r.category, label: catNames[r.category] || r.category, count: r.cnt }))
    .sort((a, b) => catOrder.indexOf(a.key) - catOrder.indexOf(b.key));
}

function createSupplier({ category, name, brand, product, contact, region, website, tags, description, sort_order }) {
  const d = getDb();
  const stmt = d.prepare(`
    INSERT INTO suppliers (category, name, brand, product, contact, region, website, tags, description, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(
    category,
    name,
    brand || null,
    product || null,
    contact || null,
    region || null,
    website || null,
    JSON.stringify(tags || []),
    description || null,
    sort_order || 0
  ).lastInsertRowid;
}

function updateSupplier(id, fields) {
  const d = getDb();
  const allowed = ["category","name","brand","product","contact","region","website","tags","description","sort_order"];
  const sets = [];
  const vals = [];
  for (const f of allowed) {
    if (fields[f] !== undefined) {
      sets.push(`${f} = ?`);
      vals.push(f === "tags" ? JSON.stringify(fields[f] || []) : fields[f]);
    }
  }
  if (sets.length === 0) return false;
  sets.push("updated_at = datetime('now')");
  vals.push(id);
  const info = d.prepare(`UPDATE suppliers SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  return info.changes > 0;
}

function removeSupplier(id) {
  const d = getDb();
  return d.prepare("DELETE FROM suppliers WHERE id = ?").run(id).changes > 0;
}

function hideSupplier(id, hidden) {
  const d = getDb();
  return d.prepare("UPDATE suppliers SET hidden = ?, updated_at = datetime('now') WHERE id = ?").run(hidden ? 1 : 0, id).changes > 0;
}

function bulkImportSuppliers(records) {
  const d = getDb();
  const stmt = d.prepare(`
    INSERT OR REPLACE INTO suppliers (id, category, name, brand, product, contact, region, website, tags, description, sort_order, hidden)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 0))
  `);
  const insertMany = d.transaction((rows) => {
    let count = 0;
    for (const r of rows) {
      stmt.run(
        r.id || null,
        r.category,
        r.name,
        r.brand || null,
        r.product || null,
        r.contact || null,
        r.region || null,
        r.website || null,
        JSON.stringify(r.tags || []),
        r.description || null,
        r.sort_order || 0,
        r.hidden != null ? r.hidden : 0
      );
      count++;
    }
    return count;
  });
  return insertMany(records);
}

/* ======== 知识库覆盖层 ======== */

function initKnowledgeSchema() {
  const d = getDb();
  d.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_overrides (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      category    TEXT    NOT NULL,
      item_key    TEXT    NOT NULL,
      value       TEXT    NOT NULL,
      value_type  TEXT    NOT NULL DEFAULT 'number',
      notes       TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(category, item_key)
    );
    CREATE TABLE IF NOT EXISTS knowledge_audit (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      category    TEXT    NOT NULL,
      item_key    TEXT    NOT NULL,
      action      TEXT    NOT NULL,
      old_value   TEXT,
      new_value   TEXT,
      notes       TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_kov_category ON knowledge_overrides(category);
    CREATE INDEX IF NOT EXISTS idx_kaudit_category ON knowledge_audit(category);
    CREATE INDEX IF NOT EXISTS idx_kaudit_created ON knowledge_audit(created_at);
  `);
}
initKnowledgeSchema();

function listKnowledgeOverrides(category) {
  const d = getDb();
  const sql = category
    ? "SELECT * FROM knowledge_overrides WHERE category = ? ORDER BY item_key"
    : "SELECT * FROM knowledge_overrides ORDER BY category, item_key";
  const rows = category ? d.prepare(sql).all(category) : d.prepare(sql).all();
  return rows.map(r => ({ ...r, value: JSON.parse(r.value) }));
}

function saveKnowledgeOverrides(category, overrides) {
  const d = getDb();
  const insertStmt = d.prepare(`
    INSERT INTO knowledge_overrides (category, item_key, value, value_type, notes)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(category, item_key) DO UPDATE SET value=excluded.value, value_type=excluded.value_type, notes=excluded.notes, updated_at=datetime('now')
  `);
  const deleteStmt = d.prepare("DELETE FROM knowledge_overrides WHERE category = ? AND item_key = ?");
  const auditStmt = d.prepare(`
    INSERT INTO knowledge_audit (category, item_key, action, old_value, new_value, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const txn = d.transaction((items) => {
    for (const ov of items) {
      if (ov._delete) {
        const old = d.prepare("SELECT value FROM knowledge_overrides WHERE category=? AND item_key=?").get(category, ov.item_key);
        deleteStmt.run(category, ov.item_key);
        auditStmt.run(category, ov.item_key, "delete", old ? old.value : null, null, ov.notes || "");
      } else {
        const old = d.prepare("SELECT value FROM knowledge_overrides WHERE category=? AND item_key=?").get(category, ov.item_key);
        insertStmt.run(category, ov.item_key, JSON.stringify(ov.value), ov.value_type || "number", ov.notes || null);
        auditStmt.run(category, ov.item_key, old ? "update" : "create", old ? old.value : null, JSON.stringify(ov.value), ov.notes || "");
      }
    }
  });
  txn(overrides);
  return listKnowledgeOverrides(category);
}

function resetKnowledgeOverrides(category) {
  const d = getDb();
  if (!category) {
    d.prepare("DELETE FROM knowledge_overrides").run();
    d.prepare("INSERT INTO knowledge_audit (category, item_key, action, notes) VALUES ('*', '*', 'reset_all', '全部重置')").run();
  } else {
    const overrides = listKnowledgeOverrides(category);
    d.prepare("DELETE FROM knowledge_overrides WHERE category = ?").run(category);
    for (const ov of overrides) {
      d.prepare("INSERT INTO knowledge_audit (category, item_key, action, old_value, notes) VALUES (?, ?, 'reset', ?, ?)")
        .run(category, ov.item_key, ov.value, "重置为默认值");
    }
  }
  return true;
}

function listKnowledgeAudit(category, limit = 100) {
  const d = getDb();
  const sql = category
    ? "SELECT * FROM knowledge_audit WHERE category = ? ORDER BY created_at DESC LIMIT ?"
    : "SELECT * FROM knowledge_audit ORDER BY created_at DESC LIMIT ?";
  return category
    ? d.prepare(sql).all(category, limit)
    : d.prepare(sql).all(limit);
}

module.exports = { getDb, list, getById, create, update, remove,
  listSuppliers, getSupplierById, getSupplierCategories,
  createSupplier, updateSupplier, removeSupplier, hideSupplier, bulkImportSuppliers,
  listKnowledgeOverrides, saveKnowledgeOverrides, resetKnowledgeOverrides,
  listKnowledgeAudit };
