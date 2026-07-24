/*
 * AquaRAS 引擎 Node 适配层
 * ---------------------------------------------------------------------------
 * 将 browser 端 engine.js + knowledge.js 包装为 Node CJS 模块。
 *
 * browser 依赖:
 *   knowledge.js  → window.RAS = window.RAS || {}; window.RAS_KNOWLEDGE = {...}
 *   engine.js     → RAS.engine = (function(){...})();   (RAS 从第 9 行 window.RAS 取得)
 *
 * Node 适配:
 *   global.window.RAS  → 等同于 browser window.RAS
 *   global.RAS         → engine.js 第 11 行直接用 RAS（不带 window.前缀）
 *   global.RAS_KNOWLEDGE → knowledge.js 用的变量名
 */

const path = require("path");

// 构造 browser 全局对象
const _rasNS = {};
global.window = global.window || {};
global.window.RAS = _rasNS;
global.RAS = _rasNS;                    // engine.js L11 直接用 RAS
global.RAS_KNOWLEDGE = undefined;       // knowledge.js 会赋值到这里

// 按依赖顺序加载（knowledge 在前，engine 在后）
require(path.join(__dirname, "..", "assets", "js", "knowledge.js"));
require(path.join(__dirname, "..", "assets", "js", "engine.js"));

// engine.js 暴露 RAS.engine 为 IIFE 返回值
const engine = global.window.RAS.engine;

/**
 * 运行时加载知识库覆盖值并合并
 * 每次 compute 前调用以获取最新覆盖
 */
function getMergedKnowledge() {
  try {
    const db = require("./db");
    const { applyOverrides } = require("./knowledge-merge");
    const overrides = db.listKnowledgeOverrides();
    if (overrides.length === 0) {
      return global.window.RAS_KNOWLEDGE; // 无覆盖，直接用基线
    }
    const merged = applyOverrides(overrides);
    // 临时替换全局变量以便 engine 使用
    global.window.RAS_KNOWLEDGE = merged;
    return merged;
  } catch (e) {
    // 回退：使用基线知识库
    console.warn("[ras-engine] 加载知识库覆盖失败，使用基线:", e.message);
    return global.window.RAS_KNOWLEDGE;
  }
}

// 包装 compute，使每次调用都使用最新的覆盖知识库
const rawCompute = engine.compute || engine;
const wrappedCompute = function(inputs) {
  getMergedKnowledge(); // 刷新 global.window.RAS_KNOWLEDGE
  return rawCompute(inputs);
};

// 同样包装其他分析函数
function wrap(fn) {
  if (!fn) return fn;
  return function() {
    getMergedKnowledge();
    return fn.apply(this, arguments);
  };
}

module.exports = {
  compute: wrappedCompute,
  knowledge: global.window.RAS_KNOWLEDGE,
  optimize: wrap(engine.optimize),
  sensitivity: wrap(engine.sensitivity),
  monteCarlo: wrap(engine.monteCarlo),
  sobol: wrap(engine.sobol),
  tailwaterCompliance: wrap(engine.tailwaterCompliance),
};
