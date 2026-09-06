# API 契约验证与读者测试记录

> 日期：2026-08-15  
> 对象：`媒介助手_MVP_API契约_v1_草案.yaml`、`媒介助手_MVP_共享数据Schema_v1_草案.md`

## 1. 机器验证

### OpenAPI 3.1 lint

- 工具：Redocly CLI。
- 结果：契约有效，零错误、零警告。
- 覆盖：YAML 解析、OpenAPI 3.1 结构、内部 `$ref`、未使用组件和常见规范规则。

### TypeScript 类型生成

- 工具：`openapi-typescript 7.13.0`。
- 结果：成功生成 `openapi-types.generated.ts`。
- 后续检查：生成文件使用 TypeScript `--noEmit` 编译通过。
- 说明：该文件仅作为验收证据，正式实现时应由可复现脚本生成到 `packages/shared`。

### 基础检查

- OpenAPI 包含 28 个 Path、45 个 Operation。
- 未发现 API Key、JWT、私钥或其他密钥样式内容。

## 2. 第一轮无上下文读者测试

独立读者只读取当前技术方案、OpenAPI 和共享 Schema，能够正确复述：

- 小红书扫码连接流程。
- 自然语言解析、规则确认和真实达人检索流程。
- 知识库签名上传、解析和向量化流程。
- 图文审核草稿、提交、SSE 和结果流程。
- JWT `sub` 绑定用户、达人真实去重、部分成功和公共广告法不可覆盖等边界。

首次测试指出的主要问题包括：通用任务状态与领域状态缺少映射、SSE Bearer 鉴权、扫码缺少 `task_id`、数值比较结构不一致、达人缺失字段无法表达、审核覆盖不足与法规 Finding 混用、异步 202 的 `task_id` 不够严格、审核列表 DTO 过重，以及缺少通用取消端点。

## 3. 修正内容

- 使用 `status + stage + terminal` 表达通用状态和领域阶段，并补充稳定 `message_code`。
- SSE 使用支持 Header 的 fetch 流式客户端；支持 `after_seq`、`Last-Event-ID`、15 秒心跳和 30 秒空闲重连。
- 扫码创建使用专用响应，强制 `id/task_id` 非空；未连接查询返回 `200 + disconnected`。
- 数值比较统一为 `operator + value`，value 为非负整数；双边区间进入歧义确认。
- 达人指标支持 `null + data_completeness + field_warnings`，禁止用 0 冒充缺失值。
- 法规命中进入 `findings`，OCR 低置信度和输入截断进入结构化 `coverage_warnings`。
- 搜索部分成功补充 `persisted_count`、`partial_reason`、`can_continue` 和 `retry_after_seconds`。
- 知识库文档和审核任务补充 `cancelled`；有结果的搜索取消映射为 `partial + user_cancelled`。
- 审核提交强制返回非空 `task_id`；审核历史使用轻量 `AuditTaskSummary`。
- Finding 来源补充知识库、文档、chunk 及对应版本。

## 4. 第二轮复测

修正后再次由独立读者复核上述阻塞项。结论：未发现严重或中等阻塞问题，可进入用户评审。

## 5. 当前验收结论

API 契约已达到“可供产品负责人评审”的状态；在用户确认前仍属于 T02 任务草案，不进入正式技术文档 current，也不作为数据库实现的冻结基线。

