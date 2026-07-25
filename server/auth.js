/*
 * AquaRAS 认证中间件
 * 统一管理管理员 Token 验证，供所有路由复用
 *
 * 认证方式：请求头 x-admin-token = 管理员密码
 * 管理员密码通过环境变量 ADMIN_PASSWORD 设置（无默认值，未配置时启动时随机生成并写入 .env）
 *
 * 使用：
 *   const { requireAdmin, ADMIN_PASSWORD } = require("./auth");
 *   router.post("/xxx", requireAdmin, handler);
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

/*
 * 管理员密码必须来自环境变量 ADMIN_PASSWORD，绝不在源码中硬编码默认密码
 * （此前曾硬编码默认密码于源码中，会随公开仓库泄露，导致任何人可篡改方案/供应商/知识库）。
 * - 若设置了 ADMIN_PASSWORD 环境变量，直接使用；
 * - 若未设置，则尝试从 server/.env 读取（本文件内置极简 .env 加载）；
 * - 若仍无，则启动时随机生成并写入 server/.env（.env 已在 .gitignore 中，不会被提交），
 *   保证每次部署的密码唯一且不在源码里。
 */
function loadEnvFile() {
  try {
    const txt = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
    txt.split(/\r?\n/).forEach((line) => {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    });
  } catch (e) { /* 无 .env 文件，忽略 */ }
}

loadEnvFile();
let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  ADMIN_PASSWORD = crypto.randomBytes(16).toString("hex");
  try {
    fs.writeFileSync(path.join(__dirname, ".env"), "ADMIN_PASSWORD=" + ADMIN_PASSWORD + "\n", { flag: "a" });
  } catch (e) { /* 写入失败不致命 */ }
  console.log(
    "[auth] 未检测到 ADMIN_PASSWORD，已生成并写入 server/.env（重启后保持不变）：\n" +
    "        " + ADMIN_PASSWORD + "\n" +
    "        请妥善保管；如需自定义，编辑 server/.env 修改 ADMIN_PASSWORD 后重启。"
  );
}

/** 
 * 管理员验证中间件
 * 检查 x-admin-token 请求头
 */
function requireAdmin(req, res, next) {
  const token = req.headers["x-admin-token"];
  if (!token || token !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "需要管理员权限，请提供正确的 x-admin-token" });
  }
  next();
}

/** 
 * 判断当前请求是否为管理员
 * 用于公开端点中条件性展示隐藏数据（如供应商隐藏）
 */
function isAdminReq(req) {
  const token = req.headers["x-admin-token"];
  return token === ADMIN_PASSWORD;
}

module.exports = { requireAdmin, isAdminReq, ADMIN_PASSWORD };
