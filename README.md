# 媒介助手前端

基于 Figma 文件 `媒介助手｜高保真原型` 的 `Core Screens` 页面实现。

## 本地运行

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
```

## Supabase 数据库

数据库 Migration 已接入 `supabase/migrations/`，Supabase CLI 固定为项目开发依赖。

本地运行需要先安装并启动 Docker Desktop：

```bash
npm run supabase:start
npm run db:reset
npm run db:lint
```

远程测试项目需要先执行 `npx supabase login` 和 `npx supabase link`。正式推送前先运行：

```bash
npm run db:push:dry
```

不要把 access token、数据库密码、service role key 或 `.env` 提交到项目。

## 当前范围

- 10 个页面与路由已实现。
- 达人选入、弃用、恢复、筛选和 CSV 导出可在前端演示。
- 内容审核表单、演示结果、审核历史筛选和私有知识库创建可交互。
- 当前使用明确标识的前端演示数据；数据库 Migration 已接入工程，但尚未连接真实 Supabase、认证、小红书实时数据、OCR、AI 或 RAG 服务。

## 路由

| 页面 | 路由 |
| --- | --- |
| 登录 | `/login` |
| 连接小红书 | `/connect` |
| 工作台 | `/dashboard` |
| 找达人 | `/creators` |
| 已选达人 | `/selected` |
| 已弃用达人 | `/discarded` |
| 新建审核 | `/audit/new` |
| 审核结果 | `/audit/result` |
| 审核记录 | `/audit/history` |
| 私有知识库 | `/knowledge` |
