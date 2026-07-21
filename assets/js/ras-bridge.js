#!/usr/bin/env node
/**
 * RAS 引擎 Node 桥接脚本
 * ---------------------------------------------------------------
 * 用途：让 Laravel/PHP 后端（或任何外部进程）调用**同一份**已审计的
 *       JS 引擎（assets/js/engine.js + knowledge.js），保证前后端
 *       计算结果 100% 一致，杜绝"双份逻辑悄悄漂移"。
 *
 * 用法：node ras-bridge.js <method> <json-payload>
 *   method ∈ compute | optimize | monteCarlo | sensitivity | tailwaterCompliance | knowledge
 *   例：  node ras-bridge.js compute '{"speciesKey":"bass","annualTons":100,"designTemp":18}'
 *
 * 输出：成功 → 单行 JSON 至 stdout；失败 → JSON {error} 至 stderr 并 exit 1。
 *
 * 实现：用 vm 创建隔离沙箱，加载 knowledge.js / engine.js（二者均为
 *       赋值 window.* 的脚本），再以方法名派发。knowledge.js / engine.js
 *       与浏览器前端完全一致，故本桥接即"生产引擎"的权威实现入口。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ENGINE_DIR = __dirname; // assets/js

function loadCode(file) {
  return fs.readFileSync(path.join(ENGINE_DIR, file), 'utf8');
}

// 隔离沙箱：标准 JS 内置（Math/JSON/Date/isNaN 等）由 vm 自动提供
const sandbox = { console };
sandbox.window = sandbox; // 让 window.X 与顶层全局一致
vm.createContext(sandbox);

try {
  vm.runInContext(loadCode('knowledge.js'), sandbox, { filename: 'knowledge.js' });
  vm.runInContext(loadCode('engine.js'), sandbox, { filename: 'engine.js' });
} catch (err) {
  process.stderr.write(JSON.stringify({ error: '引擎加载失败: ' + (err && err.message ? err.message : String(err)) }));
  process.exit(1);
}

const E = sandbox.RAS && sandbox.RAS.engine;
const K = sandbox.RAS_KNOWLEDGE;

if (!E || typeof E.compute !== 'function') {
  process.stderr.write(JSON.stringify({ error: '引擎未正确初始化（缺少 RAS.engine）' }));
  process.exit(1);
}

const method = process.argv[2] || 'compute';
let payload = {};
if (process.argv[3]) {
  try {
    payload = JSON.parse(process.argv[3]);
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: 'JSON 参数解析失败: ' + err.message }));
    process.exit(1);
  }
}

try {
  if (method === 'knowledge') {
    process.stdout.write(JSON.stringify(K));
    process.exit(0);
  }
  const fn = E[method];
  if (typeof fn !== 'function') {
    process.stderr.write(JSON.stringify({ error: '未知方法: ' + method + '（可用: compute/optimize/monteCarlo/sensitivity/tailwaterCompliance/knowledge）' }));
    process.exit(2);
  }
  // tailwaterCompliance(opts, K) 需要知识库作第二参；其余方法忽略多余参数
  const result = fn.call(E, payload, K);
  process.stdout.write(JSON.stringify(result));
  process.exit(0);
} catch (err) {
  process.stderr.write(JSON.stringify({ error: String((err && err.stack) || err) }));
  process.exit(1);
}
