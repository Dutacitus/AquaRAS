/*
 * AquaRAS 认证中间件
 * 统一管理管理员 Token 验证，供所有路由复用
 *
 * 认证方式：请求头 x-admin-token = 管理员密码
 * 管理员密码通过环境变量 ADMIN_PASSWORD 设置（默认 aquaras2024）
 *
 * 使用：
 *   const { requireAdmin, ADMIN_PASSWORD } = require("./auth");
 *   router.post("/xxx", requireAdmin, handler);
 */

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "aquaras2024";

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
