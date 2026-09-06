Exit code: 0
Wall time: 0.4 seconds
Output:
# 媒介助手 MVP 数据库与 RLS 设计 v1

> 状态：已确认  
> 版本：v1.0  
> 日期：2026-08-16  
> 上游：已确认技术方案、OpenAPI 3.1 与共享数据 Schema  
> 执行边界：Migration 已接入 `supabase/migrations/`；远程 Supabase 连接与运行验收由 T04 执行

## 1. 结论

数据库使用 Supabase PostgreSQL，分为两个信任区：

- `public`：产品业务数据。用户资源全部启用 RLS，公共广告法仅认证用户只读。
- `private`：Worker 任务、任务事件和上传意图。撤销 `anon/authenticated` 权限，只允许 `service_role` 或受控数据库连接访问。

数据模型通过复合外键同时校验资源 ID 和 `user_id`，避免服务端代码漏写租户条件时把 A 用户的子资源挂到 B 用户资源。平台会话虽然加密保存，但仍不向浏览器角色授予表权限。

## 2. Migration 顺序

| 文件 | 内容 |
| --- | --- |
| `202608160001_extensions_and_types.sql` | `pgcrypto`、`pgvector`、`private` Schema 和状态枚举 |
| `202608160002_core_tables.sql` | 业务表、Worker 表、唯一约束、复合外键和字段检查 |
| `202608160003_functions_and_triggers.sql` | Auth 资料触发器、所有权守卫、知识库计数、任务领取与事件追加 |
| `202608160004_indexes.sql` | 列表查询、去重、并发限制和任务领取索引 |
| `202608160005_rls_and_grants.sql` | 角色权限和所有业务表 RLS |
| `202608160006_storage.sql` | 三个私有 Bucket 和用户目录策略 |

Migration 必须在新 Supabase 项目的空库按编号执行。未验证前不在远程项目运行。

## 3. 数据域

### 3.1 用户与平台连接

| 表 | 说明 | 浏览器权限 |
| --- | --- | --- |
| `user_profiles` | `auth.users` 的产品资料；注册后自动建立 | 仅查看和修改自己的 `display_name` |
| `platform_sessions` | 小红书状态、短时二维码路径和 AES-GCM 密文 | 无直接表权限；仅 API/Worker |

`platform_sessions` 对 `(user_id, platform)` 唯一，MVP 每个用户只有一个小红书连接。密文、nonce 和 tag 必须同时为空或同时存在，避免保存半成品会话。

### 3.2 项目与达人

| 表 | 说明 | 关键约束 |
| --- | --- | --- |
| `projects` | 推广项目 | `(id, user_id)` 可被子表复合引用 |
| `project_groups` | 项目内自定义分组 | `(project_id, name)` 唯一 |
| `search_tasks` | 已确认规则和检索进度 | 用户最多 1 个运行中检索；目标最多 50 人 |
| `creators` | 跨项目共享的达人主档 | `(platform, platform_creator_id)` 全局唯一 |
| `project_creators` | 达人在具体项目中的状态和快照 | `(project_id, creator_id)` 唯一 |
| `creator_evidence` | AI 语义结论的公开证据 | 通过 `(project_creator_id, user_id)` 防串租户 |
| `creator_tags` | 用户自定义标签 | 项目达人内大小写不敏感去重 |

达人主档允许被多个用户的项目引用，但认证用户只能在自己已有 `project_creators` 关联时读取该达人。昵称、标签、分组和状态都不参与达人身份去重。

缺失的粉丝、活跃度或匹配分保存为 `NULL`，同时记录 `data_completeness=partial` 和 `field_warnings`，禁止用 0 冒充采集结果。

### 3.3 知识库

| 表 | 说明 | 关键约束 |
| --- | --- | --- |
| `knowledge_bases` | 公共广告法库或用户私有库 | 全库最多一个 `public_law`；scope 与 `user_id` 一致 |
| `knowledge_documents` | 原始文档和解析状态 | `(knowledge_base_id, checksum_sha256)` 去重 |
| `knowledge_chunks` | 条款/章节切块、定位、元数据与向量 | chunk 必须与文档和知识库一致 |

公共广告法记录 `user_id=NULL`，认证用户只读。私有库 `user_id` 必须存在。文档状态变化后触发器重新计算：

- 没有文档：`empty`。
- 全部 ready：`ready`。
- 至少一个 ready、同时存在失败或未完成：`needs_attention + selectable=true`。
- 没有 ready 但仍在处理：`processing`。
- 全部失败：`failed`。

Embedding 列暂用无固定维度的 `extensions.vector`，不创建 HNSW/IVFFlat。原因是 Embedding 模型和维度尚未通过中文检索 Eval；MVP 每个知识库最多 20 份文档，可以先顺序检索。模型确认后单独增加固定维度和 ANN 索引 Migration。

### 3.4 图文审核

| 表 | 说明 | 关键约束 |
| --- | --- | --- |
| `audit_tasks` | 草稿、异步任务状态、总风险和摘要 | 草稿无 `task_id`，提交后必须有 `task_id` |
| `audit_assets` | 1–9 张审核图片和抽取结果 | 同任务 `sort_order` 唯一；每张不超过 10 MB |
| `audit_knowledge_snapshots` | 审核时实际使用的知识库/文档版本 | 历史结果不随知识库更新漂移 |
| `audit_findings` | 有法规或私有规则依据的风险项 | 来源必须属于本次 snapshot 和 chunk |
| `audit_coverage_warnings` | OCR 低置信度、抽取失败或覆盖不足 | 不伪造法规来源 |

提交后的标题、正文、要求和图片元数据不可修改。Worker 仍可更新图片抽取状态、审核状态和结果。重新审核创建新 `audit_tasks`，通过 `parent_audit_task_id` 关联旧任务。

审核知识快照创建后禁止 UPDATE；浏览器角色没有 DELETE 权限，父审核或账号由服务端清理时仍可级联删除。Finding 写入时必须同时命中快照中的知识库版本与 `document_versions` 成员，并校验 chunk 所属文档和版本，避免引用本次审核未选中的规则版本。

### 3.5 Worker 私有数据

| 表/函数 | 说明 |
| --- | --- |
| `private.jobs` | Job 状态、payload、租约、重试、取消和幂等键 |
| `private.job_events` | SSE 事件，`(job_id, seq)` 唯一 |
| `private.upload_intents` | 签名上传登记、过期与提交状态 |
| `private.claim_jobs()` | `FOR UPDATE SKIP LOCKED` 领取任务，递增 `lease_version` 并设置租约 |
| `private.lock_job_for_write()` | 锁定 Job 行并校验 Worker、租约代次和有效期，拒绝过期 Worker |
| `private.renew_job_lease()` | 当前 Worker 使用相同 `lease_version` 续租 |
| `private.transition_job_and_append_event()` | 同一事务迁移 Job 状态并顺序追加事件 |

`private` Schema 不授权给 `anon/authenticated`，也不通过浏览器 PostgREST 暴露。Worker 使用 `service_role` 或单独数据库连接，并在业务记录和 Job 之间通过 `(task_id, user_id)` 复合外键校验所有权。

Worker 领取后必须保存返回的 `lease_version`。所有业务结果写入前，都要在同一事务先调用 `private.lock_job_for_write()`；状态迁移和事件追加只调用 `private.transition_job_and_append_event()`。这样租约过期并被新 Worker 重领后，旧 Worker 即使继续运行也无法提交旧结果。任务领取只把通用 `status` 改为 `running`，领域 `stage` 保持合法枚举值。

## 4. RLS 权限矩阵

| 资源 | authenticated 读取 | authenticated 写入 | service_role |
| --- | --- | --- | --- |
| 用户资料 | 自己 | 仅 `display_name` | 全部 |
| 平台会话 | 无直接权限 | 无 | 全部 |
| 项目 | 自己 | 创建和编辑；不物理删除 | 全部 |
| 项目分组 | 自己 | 自己项目内增改删；非空分组受 FK 阻止 | 全部 |
| 检索任务 | 自己 | 无直接写入，API 与 Job 同事务创建 | 全部 |
| 达人主档 | 仅已关联到自己项目的达人 | 无 | 全部 |
| 项目达人 | 自己 | 仅决策状态、分组、联系状态、弃用原因 | 全部 |
| 证据 | 自己 | 无 | 全部 |
| 标签 | 自己 | 自己项目达人内增改删 | 全部 |
| 公共广告法库/文档/chunk | 所有认证用户 | 无 | 维护 |
| 私有知识库 | 自己 | 名称和描述；删除由 API 编排 Storage 后执行 | 全部 |
| 私有文档/chunk | 自己 | 文档删除和解析写入由 API/Worker 完成 | 全部 |
| 审核任务 | 自己 | 创建/编辑草稿；提交与结果由 API/Worker | 全部 |
| 审核图片/快照/结果 | 自己 | 无直接写入 | 全部 |
| `private.*` | 无 | 无 | 全部 |

RLS 不是唯一防线：子表同时保存 `user_id`，复合外键和触发器阻止跨用户挂接；敏感表还撤销浏览器角色的表级权限。

## 5. Storage 设计

| Bucket | 路径格式 | 浏览器访问 |
| --- | --- | --- |
| `audit-assets` | `{user_id}/{upload_id}/{safe_file_name}` | 仅自己的目录，且必须匹配未过期的 `audit_asset` upload intent |
| `knowledge-documents` | `{user_id}/{upload_id}/{safe_file_name}` | 仅自己的目录，且必须匹配未过期的 `knowledge_document` upload intent |
| `ephemeral-qr` | `{user_id}/{connection_id}/qr.png` | 无直接策略；仅服务端生成短时签名 URL |

Bucket 均为 private。Storage INSERT 策略同时校验用户目录和 `private.upload_intents`，不能绕过 API 任意直传；孤儿上传对象由 Worker 清理。业务删除应先确认资源所有权，再删除对象和数据库记录。

## 6. 关键事务边界

### 6.1 创建检索任务

同一数据库事务：验证项目归属和无运行任务 → 插入 `private.jobs` → 插入 `search_tasks` 并绑定相同 `user_id/task_id` → 写入首个事件。任何一步失败整体回滚。

### 6.2 提交审核

同一事务：锁定草稿 → 校验至少 1 张图片和知识库可用性 → 插入 `private.jobs` → 把草稿状态改为 queued 并绑定 `task_id` → 复制知识库和文档版本 snapshot → 写入首个事件。

### 6.3 提交知识库文档

同一事务：锁定未过期 upload intent → 核验 `user_id/path/checksum` → 插入 `private.jobs` → 插入 `knowledge_documents` → 标记 intent committed → 写入首个事件。

### 6.4 达人落库

同一批次事务：upsert `creators` → 插入 `project_creators`，由 `(project_id, creator_id)` 去重 → 写 evidence 和 tags → 更新搜索计数。唯一冲突按“已存在达人”计入 duplicate，不创建第二条项目记录。

## 7. 删除与历史保留

- 项目 API 的 DELETE 只将状态改为 archived，不执行物理删除。
- 弃用达人不删除，继续参与项目内去重。
- 审核历史不允许物理删除，重新审核创建新版本。
- 私有知识库或文档删除必须由 API 编排对象存储清理；历史审核保留 snapshot 和引用内容。
- 历史 snapshot/finding 保存知识库、文档和 chunk 的 UUID 与版本，但不使用会阻止源文档删除的实时外键；插入时由触发器验证来源，删除后依靠不可变快照继续追溯。
- 断开小红书连接时清除加密会话和二维码对象，但不删除项目历史。
- `private.jobs/job_events` 的清理周期在部署阶段按诊断需要确定，MVP 不自动清除未验收证据。

## 8. 双用户隔离验收

创建真实测试账号 A 和 B 后必须验证：

1. A 只能看到自己的资料、项目、分组、任务、项目达人、标签、私有知识库和审核。
2. A 用 B 的资源 UUID 查询时得到空结果或 API 404。
3. A 不能把自己的分组、搜索任务、达人证据或审核资源挂到 B 的项目。
4. A 和 B 都能读取公共广告法，但都不能修改或删除。
5. A 不能读取 B 的 Storage 路径，不能访问 `private.jobs` 和平台会话表。
6. service role 测试必须显式传入资源的 `user_id`，并验证复合外键拒绝不一致写入。

可执行测试模板放在 `验收证据/rls_smoke_test_template.sql`，需要先在目标 Supabase 项目注册两个测试账号并替换占位 UUID。

## 9. 当前待确认

本轮只需要确认两个数据库决策：

1. Embedding 维度暂不锁定，不创建 ANN 索引；本地 Eval 后再补 Migration。
2. 浏览器不直接访问 `platform_sessions`、`private.jobs`、解析写入和审核结果写入；这些操作统一经 Fastify API/Worker。

用户确认本设计后，再创建新 Supabase 项目并执行 Migration。执行远程 Migration 属于下一步外部状态变更，需要单独确认和提供项目连接方式。

