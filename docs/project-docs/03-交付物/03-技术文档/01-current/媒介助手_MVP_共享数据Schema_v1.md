# 媒介助手 MVP 共享数据 Schema v1

> 状态：已确认，当前有效  
> 版本：v1.0  
> 日期：2026-08-15  
> 机器可读契约：`媒介助手_MVP_API契约_v1.yaml`  
> 上游：`03-交付物/03-技术文档/01-current/媒介助手_MVP_技术方案_v1.md`

## 1. 目的

本文补充 OpenAPI 文件中不适合仅靠 Schema 表达的前后端约定：页面与接口映射、字段命名、身份边界、状态机、错误码、SSE 行为及关键业务规则。发生冲突时，以确认后的 OpenAPI 契约和数据库约束为准。

## 2. 通用约定

### 2.1 身份与资源所有权

- Web 使用 Supabase Auth 获取 access token。
- API 从已验证 JWT 的 `sub` 获取 `user_id`。
- 所有用户私有资源均由服务端按 `user_id` 校验；请求 DTO 不包含 `user_id`。
- 对不属于当前用户的资源统一返回 `404 RESOURCE_NOT_FOUND`，避免泄露资源是否存在。
- 前端不得保存或展示小红书 Cookie、Token、Storage State、验证码和 OpenAI API Key。

### 2.2 命名与时间

- HTTP JSON 使用 `snake_case`。
- OpenAPI 生成的传输 DTO 保持 `snake_case`，不手工复制第二套接口类型。
- React 页面 ViewModel 可使用 `camelCase`，但必须在 `api/adapters` 中集中转换。
- ID 使用 UUID；小红书用户 ID 使用字符串 `platform_creator_id`，不可假设为数字。
- 时间统一返回 ISO 8601 UTC，页面再按用户时区格式化。
- 金额、token 与费用不属于线上 API；只由 `/local-eval` 记录。

### 2.3 响应外壳

JSON 成功响应：

```ts
type ApiResponse<T> = {
  data: T;
  meta: {
    request_id: string;
    next_cursor?: string | null;
  };
};
```

错误响应：

```ts
type ApiErrorResponse = {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  };
  meta: { request_id: string };
};
```

`message` 可以直接展示，但页面主要根据稳定的 `code` 决定动作。堆栈、SQL、选择器、Cookie 或上游原始错误不得返回 Web。

### 2.4 幂等与分页

- 创建连接、项目、检索任务、知识库文档解析和审核提交使用 `Idempotency-Key`。
- 键为客户端生成 UUID，作用域是“当前用户 + HTTP 方法 + 路径”。
- 项目创建在 `projects.idempotency_key` 持久化该键；异步操作同时在业务表和 `private.jobs` 中持久化并受唯一约束保护。
- 游标分页默认 20 条，最大 100 条。
- 游标只作为不透明字符串传回，不允许前端解析或拼接。

## 3. 页面与 API 映射

| 前端路由 | 页面目标 | 主要 API |
| --- | --- | --- |
| `/login` | 注册与登录 | Supabase Auth SDK；成功后 `GET /me` |
| `/connect` | 小红书扫码连接 | `POST/GET/DELETE /platform-connections/xiaohongshu`；POST 返回 `task_id`，连接事件通过任务 SSE 或状态轮询；未连接时 GET 返回 `200 + disconnected` |
| `/dashboard` | 工作台统计和快捷入口 | `GET /projects`；默认项目 `GET /projects/{projectId}` |
| `/creators` | 规则解析、检索和候选列表 | `POST /projects/{id}/search-rules:parse` → 用户确认 → `POST /projects/{id}/search-tasks` → SSE → `GET /projects/{id}/creators` |
| `/selected` | 已选达人 | `GET /projects/{id}/creators?decision_status=selected`；`PATCH /project-creators/{id}` |
| `/discarded` | 已弃用达人 | `GET /projects/{id}/creators?decision_status=discarded`；状态可改回 `pending` |
| `/audit/new` | 新建图文审核 | 创建图片 upload intent → 上传 Storage → `POST /audit-tasks` → `POST /audit-tasks/{id}/submit` |
| `/audit/result` | 审核进度和结果 | `GET /audit-tasks/{id}`；进行中订阅 `GET /tasks/{taskId}/events` |
| `/audit/history` | 审核记录 | `GET /audit-tasks` 返回轻量 `AuditTaskSummary`；重新审核调用 `POST /audit-tasks/{id}/reruns` |
| `/knowledge` | 公共广告法库和私有知识库 | `GET/POST /knowledge-bases`；签名上传后 `POST /knowledge-bases/{id}/documents` |

## 4. 核心类型与唯一键

| 领域 | 资源 ID | 业务唯一键 | 说明 |
| --- | --- | --- | --- |
| 用户 | Supabase `auth.users.id` | 邮箱由 Auth 管理 | 线上 DTO 不暴露内部权限信息 |
| 项目 | `project.id` | `user_id + project.id` | 名称允许重复 |
| 分组 | `group.id` | `project_id + name` | 同一项目不允许同名分组 |
| 达人主档 | `creator.id` | `platform + platform_creator_id` | 平台 ID 是真实去重依据 |
| 项目达人 | `project_creator.id` | `project_id + creator_id` | 状态、标签和分组不参与唯一性 |
| 检索任务 | `search_task.id` | `user_id + idempotency_key` | 同一项目可多次续搜，已有达人自动排除 |
| 知识库 | `knowledge_base.id` | 资源 ID | 公共广告法库全局共享只读 |
| 知识库文档 | `document.id` | `knowledge_base_id + checksum_sha256` | 相同文件不重复解析 |
| 审核任务 | `audit_task.id` | `user_id + idempotency_key` | 重新审核创建新 ID，不覆盖历史 |
| 通用任务 | `task.id` | 资源 ID | 供 SSE 和统一进度查询使用 |

## 5. 状态枚举

异步任务统一使用两层状态：

- `status`：跨领域的通用状态，供页面判断运行中、终态、部分成功和失败。
- `stage`：当前领域处理阶段，供页面显示具体进度文案。
- `terminal`：是否已经结束，前端不应仅靠字符串猜测终态。

| 领域状态示例 | 通用 `status` | `stage` | `terminal` |
| --- | --- | --- | --- |
| `validating_session` | `running` | `validating_session` | false |
| `collecting` | `running` | `collecting` | false |
| `parsing` | `running` | `parsing_document` | false |
| `extracting` | `running` | `extracting_assets` | false |
| `completed` | `completed` | `completed` | true |
| `partial` | `partial` | `partial` | true |
| `needs_attention` | `needs_attention` | `needs_attention` | true |
| `session_expired/rate_limited/failed` | `failed` | `failed` | true |

完整映射规则：

| 任务类型 | 领域状态 | 通用状态与终态规则 |
| --- | --- | --- |
| `xhs_connect` | `qr_pending/qr_scanned` | `running`，对应 `xhs_qr_pending/xhs_qr_scanned`，`terminal=false` |
| `xhs_connect` | `connected` | `completed/completed/true` |
| `xhs_connect` | `expired/restricted/failed` | `failed/failed/true`，用 `error_code` 区分原因 |
| `creator_search` | 各处理中状态 | `running` + 对应 stage + `terminal=false` |
| `creator_search` | 正常完成 | `completed/completed/true` |
| `creator_search` | 中断且 `persisted_count>0` | `partial/partial/true`，必须给 `partial_reason` |
| `creator_search` | 用户取消且尚无落库结果 | `cancelled/cancelled/true` |
| `creator_search` | 用户取消且已有落库结果 | `partial/partial/true`，`partial_reason=user_cancelled` |
| `knowledge_ingest` | `uploaded` 至 `validating` | `queued/running` + 对应文档 stage + `terminal=false` |
| `knowledge_ingest` | `ready` | `completed/completed/true` |
| `knowledge_ingest` | `needs_attention` | `needs_attention/needs_attention/true` |
| `knowledge_ingest` | `cancelled/failed` | 对应 `cancelled/failed` + 同名 stage + `terminal=true` |
| `content_audit` | `draft` | 尚未创建通用任务，不产生 `task_id` |
| `content_audit` | `queued` 至 `validating_result` | `queued/running` + 对应审核 stage + `terminal=false` |
| `content_audit` | `completed/needs_attention/cancelled/failed` | 对应同名通用状态和 stage，`terminal=true` |

### 5.1 项目与达人

```ts
type ProjectStatus = "active" | "archived";
type CreatorDecisionStatus = "pending" | "selected" | "discarded";
type ContactStatus = "not_contacted" | "contacting" | "cooperated" | "unreachable";
```

达人状态可以在 `pending`、`selected`、`discarded` 之间互转。弃用不是删除；弃用达人继续参与项目内去重。

前端中文映射：

| 值 | 中文 |
| --- | --- |
| `pending` | 待处理 |
| `selected` | 已选入 |
| `discarded` | 已弃用 |
| `not_contacted` | 未联系 |
| `contacting` | 沟通中 |
| `cooperated` | 已合作 |
| `unreachable` | 无法联系 |

### 5.2 小红书连接

```text
disconnected → qr_pending → qr_scanned → connected
                     ↘ expired | restricted | failed
connected → expired | restricted | disconnected
```

| 状态 | 页面行为 |
| --- | --- |
| `qr_pending` | 展示二维码与过期倒计时 |
| `qr_scanned` | 展示“已扫码，等待手机确认” |
| `connected` | 允许进入工作台并启动检索 |
| `expired` | 隐藏旧二维码，提供重新生成 |
| `restricted` | 停止自动重试，提示验证码、频控或平台限制 |
| `failed` | 展示可重试与 `request_id`，不展示内部错误 |

未建立连接时，`GET /platform-connections/xiaohongshu` 仍返回 200，数据为 `status=disconnected` 且 `id/task_id=null`；断开接口保持幂等。

### 5.3 达人检索任务

```text
queued → validating_session → collecting → hard_filtering
→ analyzing → persisting → completed
                         ↘ partial | cancelled | session_expired | rate_limited | failed
```

- `completed`：数据源处理结束并正常落库，不保证一定达到 50 人。
- `partial`：已有真实结果，但任务因限制提前结束。
- `session_expired`：必须重新扫码，不能原地盲目重试。
- `rate_limited`：前端展示建议等待时间，不自动循环提交。

部分成功必须同时返回 `persisted_count`、`partial_reason`、`can_continue` 和可选 `retry_after_seconds`，不能只依赖自由文本说明。

### 5.4 知识库与文档

```ts
type KnowledgeBaseStatus = "empty" | "processing" | "ready" | "needs_attention" | "failed";
type KnowledgeDocumentStatus =
  | "uploaded"
  | "parsing"
  | "chunking"
  | "embedding"
  | "validating"
  | "ready"
  | "needs_attention"
  | "cancelled"
  | "failed";
```

`ready` 的知识库可加入审核。`needs_attention` 只有在至少一份文档为 `ready` 时才可令 `selectable=true`，并在审核结果加入覆盖警告；没有成功文档时不可选择。公共广告法库始终 `scope=public_law`、只读且审核时不可关闭。

`KnowledgeDocument.task_id` 对公共广告法文档为 `null`；用户提交私有文档后的 `202` 响应使用 `QueuedKnowledgeDocument`，其中 `task_id` 必须是非空 UUID。

### 5.5 审核任务

```text
draft → queued → validating → extracting → retrieving
→ analyzing → validating_result → completed
             ↘ needs_attention | cancelled | failed
```

- 只有 `draft` 允许修改输入。
- `needs_attention` 表示图片文字、文档或覆盖范围需人工处理，不等同于低风险。
- `completed` 只表示流程结束；结论由 `result.overall_risk` 表示。

## 6. 自然语言规则 Schema

前端先调用解析接口，再让用户确认，不能把 AI 首次解析结果直接用于真实检索。

```ts
type ParsedSearchRule = {
  hard_filters: {
    followers?: NumericComparison;
    posts_last_30d?: NumericComparison;
    days_since_last_post?: NumericComparison;
  };
  semantic_conditions: Array<{
    id: string;
    type: "experience" | "concern" | "content_topic" | "persona" | "custom";
    terms: string[];
    match: "any" | "all" | "none";
  }>;
  ranking: Array<{
    field: "activity" | "followers" | "match_score" | "recent_post_at";
    direction: "asc" | "desc";
  }>;
  limit: number;
  ambiguities: string[];
  schema_version: "search-rule.v1";
};
```

`activity`、`match_score` 和唯一性由代码计算；AI 只返回结构化条件和语义证据。

`NumericComparison.value` 只接受非负整数。`search-rule.v1` 每个数值字段只支持一个比较；用户输入“1000 到 1500 粉”等双边区间时，解析器必须写入 `ambiguities` 并要求用户确认或拆分，不能静默保留一侧。

## 7. 达人 DTO 约定

- `id` 是项目达人资源 ID，用于状态更新。
- `platform_creator_id` 是小红书用户 ID，用于真实去重。
- `profile_url` 只能来自真实页面解析，前端不自行拼接。
- `captured_at` 必须展示或在详情中可见，避免把历史快照说成实时值。
- `followers` 是最后采集值；缺失数据不能编造为 0。
- `followers`、`activity_score` 和 `match_score` 均允许 `null`；缺失时 `data_completeness=partial` 并在 `field_warnings` 说明原因，排序时 null 放在末尾。
- 非空 `activity_score` 和 `match_score` 为 0–100 的代码计算分。
- `evidence_summary` 用于列表；完整 `evidence[]` 用于详情与人工确认。
- `confidence` 是证据结论置信度，不代表达人真实身份得到验证。

## 8. 上传协议

### 8.1 两阶段上传

```text
1. Web 发送文件名、MIME、大小和 SHA-256
2. API 返回 upload_id、storage_path、签名 URL 和过期时间
3. Web 直接 PUT 到私有 Supabase Storage
4. Web 使用相同 upload_id/storage_path 创建业务资源
5. Worker 再校验真实 MIME、大小、checksum 和可解析性
```

### 8.2 限制

| 类型 | 格式 | 限制 |
| --- | --- | --- |
| 审核图片 | JPG、PNG | 每张不超过 10 MB；每个审核 1–9 张 |
| 知识库文档 | PDF、DOCX、TXT、MD | 每份不超过 20 MB；每库最多 20 份 |

签名 URL 过期不代表业务资源失败，前端可以重新请求 upload intent。前端不能把 Storage 公共 URL写入业务记录。

未提交的 upload intent 和孤儿对象由 Worker 按创建时间清理：过期 intent 至少保留 1 小时供诊断，未绑定业务资源的对象最长保留 24 小时；清理过程不读取文件正文。

## 9. 审核结果规则

- 公共广告法和私有规则分别检索并分别标记 `source.scope`。
- `source` 必须带 `knowledge_base_id/version`、`document_id/version` 和 `chunk_id`，且这些 ID 必须属于该任务的知识库快照和本次检索集合。
- `findings[]` 只放有规则依据的风险项；OCR 低置信度、抽取失败和输入截断进入结构化 `coverage_warnings[]`，页面可将其展示为“待人工确认”卡片。
- 私有规则可以增加风险，不能消除公共广告法风险。
- `overall_risk` 由代码合成，不由模型自由决定。
- 任意图片 `extract_status=low_confidence/failed` 时，结果必须包含覆盖不足警告。
- 页面固定展示：`AI辅助审核结果，不构成法律意见，需人工复核。`

风险合成顺序：

```text
存在有效 high → high
否则存在 medium → medium
否则存在 needs_confirmation 或关键覆盖不足 → needs_confirmation
否则 → low
```

## 10. SSE 事件

```ts
type TaskEvent = {
  seq: number;
  task_id: string;
  status: "queued" | "running" | "completed" | "partial" | "needs_attention" | "cancelled" | "failed";
  stage: string;
  terminal: boolean;
  progress: number;
  message_code: string;
  error_code: string | null;
  retry_after_seconds: number | null;
  data?: Record<string, unknown>;
  occurred_at: string;
};
```

客户端规则：

1. 使用支持自定义 Header 的 fetch 流式 SSE 客户端，携带 `Authorization: Bearer`；不直接使用无法设置该 Header 的浏览器原生 `EventSource`。
2. 保存最后处理的 `seq`。
3. 重连时发送 `after_seq` 或 `Last-Event-ID`。
4. 忽略重复或更小的 `seq`。
5. 服务端最长每 15 秒发送一次 SSE 注释心跳 `: heartbeat`；心跳不增加 `seq`。
6. 客户端 30 秒未收到业务事件或心跳时主动 abort 当前 fetch 并重连，不等待 TCP 自行报错。
7. SSE 连续失败后每 3 秒轮询 `GET /tasks/{taskId}`。
8. 达到终态后关闭连接，并重新读取对应业务资源。

前端使用的稳定 `message_code` 包括 `XHS_QR_READY`、`XHS_QR_SCANNED`、`XHS_CONNECTED`、`SEARCH_COLLECTING`、`SEARCH_ANALYZING`、`SEARCH_PARTIAL`、`KB_PARSING`、`KB_EMBEDDING`、`KB_READY`、`AUDIT_EXTRACTING`、`AUDIT_RETRIEVING`、`AUDIT_ANALYZING`、`AUDIT_COMPLETED`、`TASK_NEEDS_ATTENTION` 和 `TASK_FAILED`。完整枚举以 OpenAPI 为准。

Worker 每次领取任务都会得到递增的 `lease_version`。续租、写业务结果和追加事件必须在同一事务中校验 `job_id + worker_id + lease_version + 未过期租约`；旧 Worker 的写入会被拒绝。任务领取只改变通用 `status=running`，不会制造契约外的 `stage=running`。

检索、知识库解析和内容审核在不可中断提交阶段前可通过 `POST /tasks/{taskId}/cancel` 请求取消；不支持取消时返回 `TASK_NOT_CANCELLABLE`。知识库文档和审核任务均包含 `cancelled` 领域状态；检索在已有落库结果时按 `partial + user_cancelled` 表达，而不是丢弃结果。

## 11. 稳定错误码

| HTTP | code | retryable | 前端动作 |
| --- | --- | --- | --- |
| 401 | `AUTH_TOKEN_MISSING` | 否 | 回到登录页 |
| 401 | `AUTH_TOKEN_INVALID` | 否 | 清除本地 Session 后登录 |
| 401 | `AUTH_TOKEN_EXPIRED` | 是 | 先由 Supabase 刷新 Token |
| 403 | `FORBIDDEN` | 否 | 提示无权操作 |
| 404 | `RESOURCE_NOT_FOUND` | 否 | 返回列表或项目页 |
| 400 | `VALIDATION_FAILED` | 否 | 按 `details.fields` 标记表单字段 |
| 409 | `IDEMPOTENCY_CONFLICT` | 否 | 不重复提交，读取原任务 |
| 409 | `PROJECT_ARCHIVED` | 否 | 禁用项目写操作 |
| 409 | `GROUP_NOT_EMPTY` | 否 | 先移动达人再删除分组 |
| 422 | `XHS_CONNECTION_REQUIRED` | 否 | 跳转扫码页 |
| 422 | `XHS_QR_EXPIRED` | 是 | 重新生成二维码 |
| 422 | `XHS_SESSION_EXPIRED` | 否 | 重新扫码 |
| 422 | `XHS_RESTRICTED` | 否 | 停止自动重试并显示平台限制 |
| 429 | `XHS_RATE_LIMITED` | 是 | 按 `Retry-After` 等待 |
| 429 | `SEARCH_CONCURRENT_LIMIT` | 是 | 展示当前运行任务 |
| 422 | `SEARCH_RULE_INVALID` | 否 | 返回规则确认步骤 |
| 409 | `TASK_NOT_CANCELLABLE` | 否 | 刷新任务状态 |
| 429 | `TASK_CONCURRENT_LIMIT` | 是 | 等待同类任务结束 |
| 400 | `UPLOAD_INVALID` | 否 | 重新选择符合限制的文件 |
| 422 | `UPLOAD_EXPIRED` | 是 | 重新获取签名 URL |
| 404 | `UPLOAD_NOT_FOUND` | 否 | 重新上传 |
| 403 | `KB_PUBLIC_READ_ONLY` | 否 | 隐藏公共库编辑按钮 |
| 409 | `KB_LIMIT_REACHED` | 否 | 提示每库最多 20 份文档 |
| 409 | `KB_DOCUMENT_DUPLICATE` | 否 | 显示已有同 checksum 文档 |
| 422 | `KB_DOCUMENT_PARSE_FAILED` | 视情况 | 显示失败原因并允许换文件 |
| 422 | `KB_NOT_READY` | 是 | 等待解析完成后再审核 |
| 409 | `AUDIT_DRAFT_REQUIRED` | 否 | 刷新任务，不修改非草稿 |
| 422 | `AUDIT_ASSET_REQUIRED` | 否 | 至少上传 1 张图 |
| 422 | `AUDIT_KB_NOT_READY` | 是 | 取消未就绪私有库或等待 |
| 504 | `AI_TIMEOUT` | 是 | 提供重新提交操作 |
| 502 | `AI_OUTPUT_INVALID` | 是 | 显示处理失败和 request_id |
| 429 | `AI_RATE_LIMITED` | 是 | 按 Retry-After 等待 |
| 500 | `INTERNAL_ERROR` | 视情况 | 显示 request_id，避免暴露内部信息 |

## 12. 共享类型生成

建议流程：

```text
OpenAPI YAML
→ OpenAPI lint
→ 生成 TypeScript transport types
→ packages/shared 导出枚举、Schema 和 API client 类型
→ server 使用 Zod 运行时校验
→ Web 只通过 api client 调用
```

禁止手工维护三套相互独立的 TypeScript 类型、Zod Schema 和 OpenAPI Schema。实现阶段应选择一个可复现的生成脚本，并在 CI 或本地检查中检测契约漂移。

## 13. 确认记录

产品负责人于 2026-08-15 确认本 API 契约，确认内容包括：

1. 规则解析和真实检索采用两步接口。
2. MVP Excel 最多导出 50 人，同步生成。
3. 审核采用“上传图片 → 保存草稿 → 提交任务”的三步流程。
4. 项目分组作为独立资源；删除非空分组时不自动迁移达人。
5. `needs_confirmation` 作为审核风险等级，与任务状态 `needs_attention` 分离。

本文件与 OpenAPI YAML 现位于 `03-交付物/03-技术文档/01-current/`，作为数据库和后端实现的当前契约基线。
