# T05 真实登录与 API 验收记录

> 日期：2026-08-17  
> 环境：本地 React/Vite + Fastify，远程 Supabase Free 测试项目  
> 结论：通过

## 1. 自动检查

- `npm run typecheck`：通过。
- `npm run test:server`：5/5 通过。
- `npm run build`：前端与 Fastify TypeScript 生产构建通过。
- `/api/v1/health`：通过前端 `/api` 代理返回 200，响应包含 UUID request ID。
- 未携带 Bearer Token 请求 `/api/v1/me`：返回 401 `AUTH_REQUIRED`。

## 2. 真实账号链路

- 真实邮箱密码注册成功。
- 验证邮件确认成功。
- 真实邮箱密码登录成功。
- 刷新业务页面后仍保持登录，未跳回登录页。
- 退出入口已提供。

## 3. Profile 与 RLS

- 数据库核对结果：Auth 用户 1、Profile 1、缺失 Profile 的用户 0。
- 前端携带 Supabase Session access token 调用 Fastify `/me`。
- Fastify 验证 Token 后使用用户 Token 调用 Supabase Data API，不使用 service role。
- `user_profiles` 查询通过现有 RLS，侧栏显示真实用户资料和邮箱。
- 请求体不接受 `user_id`，用户身份仅来自已验证 Token。

## 4. 联调修复

- 修复远程 Auth 邮件回跳地址：注册和重发邮件显式使用当前站点 `/login`。
- 增加“重新发送验证邮件”入口。
- 强制 Vite 使用 `vite.config.ts`，恢复 `/api` 到 `127.0.0.1:3001` 的代理。
- 服务端 Supabase 客户端改用官方 `accessToken` 回调传递用户 Token。
- Token 校验优先使用 `getClaims()`，兼容项目在本地/JWKS 不可用时回退到 Auth 服务端 `getUser()`。

## 5. 安全边界

- `.env.local` 被 `.gitignore` 忽略。
- 浏览器与 Fastify 只使用 Publishable Key；未把 service role key 写入应用配置。
- API 日志不记录 Authorization header、Token 或密码。
- 本记录不包含邮箱、Token、密码或 API Key。

## 6. 验收判断

T05 的真实注册、登录、Session 恢复、受保护路由、Token 验证、Fastify `/me` 和 RLS 用户资料读取均已通过。下一验证门为小红书扫码登录、会话状态识别与真实页面读取 PoC。
