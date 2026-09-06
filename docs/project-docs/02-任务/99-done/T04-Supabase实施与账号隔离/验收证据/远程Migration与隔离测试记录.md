# T04 远程 Migration 与隔离测试记录

> 日期：2026-08-17  
> 环境：Supabase Free 测试项目 `medium-ai-dev`，新加坡区域  
> 结论：通过

## 1. Migration

- dry-run 确认目标为全新的远程测试项目。
- 001–006 Migration 按顺序全部执行完成：
  1. `extensions_and_types`
  2. `core_tables`
  3. `functions_and_triggers`
  4. `indexes`
  5. `rls_and_grants`
  6. `storage`
- `supabase_migrations.schema_migrations` 中六条记录完整。
- CLI 提示 Docker 缺失并导致 migration catalog 缓存失败；该提示出现在远程执行完成之后，不影响已应用的 Schema。

## 2. RLS 与 Storage

执行 `supabase/tests/database/rls_smoke.sql`，结果通过：

- 用户 A/B 只能读取自己的项目、审核任务和私有知识库。
- 用户 A/B 不能修改对方数据，也不能把资源挂到对方项目下。
- 公共广告法知识库及文档对已登录用户可见，但不可被普通用户修改。
- Storage 对象按用户隔离，跨用户对象不可见。
- 上传路径必须匹配有效且未过期的 `upload_intent`。
- `authenticated` 不能访问 `private.jobs` 或 `public.platform_sessions`。

## 3. Job fencing

执行 `supabase/tests/database/job_fencing_smoke.sql`，结果通过：

- Worker A 首次领取获得 `lease_version = 1`。
- 租约过期后 Worker B 重领并获得下一版本租约。
- Worker A 使用旧租约写入时被数据库以 SQLSTATE `55000` 拒绝。
- Worker B 可以在同一数据库事务中完成 Job 状态更新与事件追加。

## 4. 数据清理

两组测试均在事务中执行并最终 `ROLLBACK`。测试结束后只读核对结果：

- 一次性 Auth 用户：0
- 一次性项目：0
- 一次性 Job：0
- 一次性 Storage 对象：0

## 5. Lint 与类型

- `public` Schema：无错误。
- `private` Schema：无错误。
- CLI 结果：`No schema errors found`。
- 已生成 `src/lib/database.types.ts`。
- `npm run typecheck`：通过。
- `npm run build`：通过。

## 6. 验收判断

T04 的 Migration、数据隔离、Storage 权限、Worker fencing、数据库 lint 和类型生成验收项全部通过。本机没有 Docker，因此未运行本地 `supabase db reset`；本次使用全新的远程空项目完整执行 001–006 Migration，覆盖了空库顺序执行验证。
