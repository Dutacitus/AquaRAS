/*
 * knowledge-merge.js — 将 DB 覆盖值合并到 knowledge.js 基线
 * 
 * 设计原则：knowledge.js 为不可变基线，DB 覆盖值为增量修改。
 * 深度合并时，DB 中的覆盖值覆盖对应路径，其余路径保持 knowledge.js 原值。
 */
const path = require("path");
const fs = require("fs");

// 私有 IP 叙述（meta.note / meta.sourceMap / references / economics.capexCalibration），
// 仅存在于服务端，绝不进入前端静态包；仅通过管理员接口合并后下发。
let PRIVATE = null;
try { PRIVATE = require("./knowledge-private"); } catch (e) { /* 私有文件缺失不影响基础计算 */ }

let _base = null;

function ensureGlobals() {
  if (!global.window) global.window = {};
  if (!global.window.RAS) {
    const ns = {};
    global.window.RAS = ns;
    global.RAS = ns;
  }
  if (!global.RAS_KNOWLEDGE) {
    // 加载 knowledge.js（与 ras-engine.js 同样的方式）
    const kPath = path.join(__dirname, "..", "assets", "js", "knowledge.js");
    const src = fs.readFileSync(kPath, "utf-8");
    // knowledge.js 由全局变量模式构成：window.RAS_KNOWLEDGE = { ... }
    // 不包含 "use strict"，直接 eval 即可（与 require() 一致的行为）
    eval(src);
  }
}

function getBase() {
  if (!_base) {
    ensureGlobals();
    _base = JSON.parse(JSON.stringify(global.window.RAS_KNOWLEDGE));
  }
  return _base;
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * 将 DB 覆盖值合并到基线知识库
 * @param {Array} overrides - DB 覆盖记录数组 [{category, item_key, value}]
 * @returns {Object} 合并后的完整知识库
 */
function applyOverrides(overrides) {
  const base = getBase();
  const result = deepClone(base);

  for (const ov of overrides) {
    // 构建完整路径：category.item_key（如 process.tanPerFeed）
    const fullPath = ov.item_key.includes(".") ? ov.item_key : (ov.category + "." + ov.item_key);
    const parts = fullPath.split(".");
    let target = result;
    let found = true;
    for (let i = 0; i < parts.length - 1; i++) {
      if (target[parts[i]] === undefined || target[parts[i]] === null) {
        found = false;
        break;
      }
      if (typeof target[parts[i]] !== "object" || Array.isArray(target[parts[i]])) {
        // 中间路径不是对象，无法继续
        found = false;
        break;
      }
      target = target[parts[i]];
    }
    if (found && target && typeof target === "object") {
      target[parts[parts.length - 1]] = ov.value;
    }
  }

  return result;
}

/**
 * 获取指定类别的所有可编辑叶子路径
 * 返回 [{key: "biofilter.rate", value: 0.60, value_type: "number", label: "硝化速率"}]
 */
const CATEGORY_META = {
  biofilter:   { label: "生物滤池",           parent: "equipment" },
  drumFilter:  { label: "微滤机",             parent: "equipment" },
  oxygen:      { label: "增氧系统",           parent: "equipment" },
  degasser:    { label: "CO₂脱气塔",          parent: "equipment" },
  uv:          { label: "UV 消毒",            parent: "equipment" },
  skimmer:     { label: "泡沫分离器",         parent: "equipment" },
  ozone:       { label: "臭氧系统",           parent: "equipment" },
  pump:        { label: "水泵系统",           parent: "equipment" },
  heat:        { label: "温控系统",           parent: "equipment" },
  misc:        { label: "其他设备",           parent: "equipment" },
};

function getCategoryLeaves(category) {
  const base = getBase();
  const leaves = [];

  function walk(obj, prefix, catLabel) {
    if (obj === null || obj === undefined) return;
    if (typeof obj !== "object" || Array.isArray(obj)) {
      leaves.push({ key: prefix, value: obj, value_type: typeof obj === "number" ? "number" : typeof obj === "boolean" ? "boolean" : "string", label: prefix.split(".").pop() });
      return;
    }
    for (const k of Object.keys(obj)) {
      walk(obj[k], prefix ? prefix + "." + k : k, catLabel);
    }
  }

  const data = base[category];
  if (!data) { return leaves; }

  if (Array.isArray(data)) {
    // 数组类别（species、regions 等），每个元素一个对象
    data.forEach((item, idx) => {
      const idKey = item.key || item.name || item.type || ("item" + idx);
      walk(item, idKey, category);
    });
  } else if (typeof data === "object") {
    walk(data, "", category);
  }

  return leaves;
}

/**
 * 获取类别列表（带描述和叶子数量）
 */
function getCategoryList() {
  const base = getBase();
  const CATS = [
    { key: "waterQuality",       label: "水质控制目标",       desc: "TAN/NO₂/NO₃/DO/CO₂/pH/SS/DOC/消毒上限阈值" },
    { key: "standards",          label: "尾水排放标准",       desc: "DB44/2462-2024 淡水/海水 × 一级/二级" },
    { key: "tailwaterTreatment", label: "尾水处理工艺库",     desc: "6种可选深度处理工艺参数" },
    { key: "equipment",          label: "单元设备设计基准",   desc: "生物滤池/微滤机/增氧/脱气/UV/臭氧/泵/温控等系数" },
    { key: "process",            label: "工艺过程常数",       desc: "质量平衡/化学计量/碳酸盐体系/水足迹等约35个系数" },
    { key: "uncertainty",        label: "不确定性参数区间",   desc: "蒙特卡洛分析的8个模型系数区间" },
    { key: "building",           label: "建筑占地模型",       desc: "单位水体占地/层高等" },
    { key: "defaults",           label: "输入默认值",         desc: "补水率/循环次数/安全系数等" },
    { key: "climate",            label: "气候地区预设",       desc: "8个地区的温度/成本/电价/碳因子" },
    { key: "species",            label: "养殖品种数据库",     desc: "12个品种的FCR/密度/水温/价格等" },
    { key: "pv",                 label: "光伏投资模型",       desc: "光伏板单价/逆变器/安装费系数" },
    { key: "economics",          label: "经济参数",           desc: "CAPEX单价/OPEX/财务模型等" },
  ];
  return CATS.map(c => ({
    ...c,
    leafCount: getCategoryLeaves(c.key).length,
    overridesCount: 0, // 由调用方填入
  }));
}

// 重新加载知识库（清除缓存）
function reloadBase() {
  _base = null;
  // 同时重新 require knowledge.js
  const kPath = path.join(__dirname, "..", "assets", "js", "knowledge.js");
  delete require.cache[require.resolve(kPath)];
  require(kPath);
  return getBase();
}

/**
 * 将私有 IP 叙述合并进已合并覆盖值后的知识库（仅管理员接口调用）
 */
function mergePrivate(kb) {
  if (!PRIVATE) return kb;
  if (PRIVATE.meta) {
    kb.meta = kb.meta || {};
    if (PRIVATE.meta.note !== undefined) kb.meta.note = PRIVATE.meta.note;
    if (PRIVATE.meta.sourceMap !== undefined) kb.meta.sourceMap = PRIVATE.meta.sourceMap;
  }
  if (PRIVATE.references !== undefined) kb.references = PRIVATE.references;
  if (PRIVATE.capexCalibration !== undefined) {
    kb.economics = kb.economics || {};
    kb.economics.capexCalibration = PRIVATE.capexCalibration;
  }
  return kb;
}

/**
 * 获取面向管理员的完整知识库（基线 + DB 覆盖 + 私有 IP 叙述）
 * @param {Array} overrides - DB 覆盖记录数组
 */
function getFull(overrides) {
  return mergePrivate(applyOverrides(overrides || []));
}

module.exports = { applyOverrides, getCategoryLeaves, getCategoryList, getBase, reloadBase, getFull };
