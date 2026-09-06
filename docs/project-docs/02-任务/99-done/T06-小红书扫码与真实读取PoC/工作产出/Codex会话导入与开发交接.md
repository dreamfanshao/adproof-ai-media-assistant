# Codex 会话导入与开发交接

> 用途：把 2026-08-11 至 2026-08-18 在 Codex 中进行的「媒介助手」项目对话导入当前工作区，供后续会话（含 DSH/本工作区）无痕接续开发。
> 导入日期：2026-08-18
> 来源：`C:\Users\wff\.codex\sessions\2026\08\{11..18}\rollout-*.jsonl`（Codex 会话 rollup）
> 原始旧工作区：`C:\Users\wff\Documents\Codex\2026-08-11\adproof-ai-vibe-coding`（已迁出，不再依赖）

---

## 1. 导入内容清单

已从 9 个 Codex 会话 rollup 提取并解析为可读 Markdown 转录（存放于本工作区 `.codex-import-tmp/out/`，含每个会话的用户消息、助手回复、工具调用与结果）：

| 时间 | 会话 | 主题 | 提取文件 |
| --- | --- | --- | --- |
| 08-11 | 主线会话 019ff007… | ChatGPT 迁移、产品画布、七步成诗 PRD、Figma/FigWright、前端设计与技术方案 | `2026-08-11_00-原PRD历史会话.md` |
| 08-14 | 工作区迁移会话 A/B | 建立 docs/project-docs 工作区体系，迁移 PRD 与资料 | `2026-08-14_01/02-*.md` |
| 08-15 | 前端与 API 会话 | T01 前端实现、T02 技术方案与 API 契约 | `2026-08-15_03-前端与API会话.md` |
| 08-15 | 夜间会话 A/B | 技术方案与契约收尾 | `2026-08-15_04/05-*.md` |
| 08-16 | 真实登录 PoC 主会话 | T03 数据库与 RLS、T04 Supabase 实施、双用户隔离测试 | `2026-08-16_06-真实登录PoC主会话.md` |
| 08-16 | 夜间会话 | 数据库方案收尾 | `2026-08-16_07-夜间会话.md` |
| 08-18 | 审批子会话 | 包含主线全量转录（[1]–[196]），最后动作为"重新启动本项目" | `2026-08-18_08-*.md` |

主线会话 id：`019ff007-08a3-7511-ac70-1276b771698a`（Codex 内部主线对话，08-11 起持续到 08-18）。

## 2. 项目是什么

**媒介助手（AdProof AI / 媒介助手）**——面向小红书媒介专员的验证型 MVP：

1. **达人筛选**：用户一句话描述规则（如"粉丝<1500、活跃度高、做过医美/有斑点困扰"），系统经扫码登录小红书后实时分析博主图文/流量/主页数据，返回候选列表（默认 50 人），支持选入/弃用/自定义分组/导出 Excel，后续检索去重（user_id+自定义标签唯一键）。
2. **图文内容审核**：平台内置公共 RAG（仅《广告法》），用户可上传私有规则文档；上传达人图文，按规则库辅助审核，输出通过/警告/不通过 + 风险定位 + 依据 + 修改建议。

约束：一周 MVP、无开发/评审人员、数据必须扫码后实时获取、禁止静态数据冒充、Eval 只本地运行、凭据不入文档。

## 3. 已确认决策（D001–D013，详见 `00-工作台/决策与待确认事项/决策与待确认事项.md`）

- D001 工作区采用 AI 协同资料体系；D002 PRD 为产品基线。
- D003 多个人账号、数据按 `user_id` 隔离；D004 公共 RAG 只内置广告法；D005 Eval 与用量记录仅本地。
- D006 前端以 Figma「媒介助手｜高保真原型 / Core Screens」为唯一视觉基准。
- D007 技术栈：React/Vite + Fastify/TypeScript + 新建 Supabase 项目 + 独立 Node.js Worker（Playwright Chromium）。
- D008 小红书真实数据链路为后端首要验证门；D009 技术方案 v1 确认；D010 API 契约 v1 确认。
- D011 数据库、RLS 与 Worker 数据边界确认（Embedding 维度延后）。
- D012 真实读取技术门首轮通过（真实扫码 + 搜索页/达人主页 HTTP 200）。
- D013 小红书扫码改为**检索时按需触发**：登录媒介助手直接进工作台，首次检索且无有效会话才扫码；有效期内重登不重复扫码；过期/失效/受限补扫并继续原检索。

## 4. 开发进度时间线

- **08-11~13**：产品画布、MVP 界定、七步成诗完成 PRD，Figma 高保真原型，FigWright MCP 接入。
- **08-14**：文档迁入 `E:\code\AICoding\agent_medium`，建立工作区体系。
- **08-15**：T01 前端实现（登录/工作台/找达人/选入/弃用/分组/知识库/审核/历史页）；T02 技术方案 + OpenAPI 3.1 契约确认（两步检索、50 人 Excel 导出、`needs_confirmation` 等级、SSE 心跳等）。
- **08-16**：T03 数据库与 RLS 设计（public/private 双信任区、复合外键、Job fencing 租约）；T04 新建 Supabase 项目 `medium-ai-dev`（ref `euibutsqbypzrixqesti`）并推送 001–006 Migration，RLS/Storage/双用户隔离测试通过。
- **08-17**：T05 真实账号与 API 基础验收归档；T06 真实扫码 PoC 通过（用户本人扫码、搜索页 40 内容链接+41 达人链接、达人主页 2 指标+2 内容链接、无凭据落盘）；随后完成连接 API（POST/GET/DELETE `/api/v1/platform-connections/xiaohongshu`）、状态机（qr_pending/qr_scanned/connected/expired/restricted/failed）、前端真实二维码展示、按需扫码、AES-256-GCM 会话加密与 `platform_sessions` 持久化代码；修复"登录秒闪退"前端竞态（signIn 后确认 session 再跳转）；扫码按钮上移、受控 Edge 窗口移出屏幕、二维码直显当前页。
- **08-18**：用户请求"重新启动本项目"；API(3001)/Web(5173) 已在运行且健康。本轮（DSH 会话）完成 Codex 对话导入。

## 5. 当前代码与运行状态（2026-08-18 核对）

- 服务：API `http://127.0.0.1:3001`（`/api/v1/health` 200）、前端 `http://127.0.0.1:5173`（200）。
- 测试：`npm run test:server` 9/9 通过（health、me、profile、平台连接创建/鉴权/断开、加密会话防篡改）。
- 结构：`server/src/`（Fastify：config/auth/errors/app + profile + platform-connections + xhs-connection-service + xhs-session-persistence）；`src/`（React 前端）；`worker/src/poc/`（xhs-browser-poc、qr-smoke、dom-diagnostic）；`supabase/migrations/001-006`；`supabase/.temp/` 记录链接项目 ref。
- 环境：`.env.local` 已有 `VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`、`VITE_API_BASE_URL`、`SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY`、`API_HOST/PORT`、`WEB_ORIGINS`。
- **缺口**：`SUPABASE_SERVICE_ROLE_KEY` 与 `XHS_SESSION_ENCRYPTION_KEY` 未配置 → 当前连接服务运行在"本机内存会话"模式（服务重启后需重新扫码）。两者必须同时配置（config.ts superRefine），配置后自动切换 Supabase 加密持久化。

## 6. T06 剩余工作与下一步

1. 用户授权并提供 Supabase **服务端 service_role key**（Settings → API Keys → 新式 `service_role` 密钥）；本地生成 32 字节 `XHS_SESSION_ENCRYPTION_KEY`（hex/base64 均可）。
2. 写入 `.env.local`，重启 API，验证：
   - 首次发起检索 → 展示真实二维码 → 扫码 → connected；
   - **服务重启 / 重新登录媒介助手 → 后续检索免扫码**（从 `platform_sessions` 解密恢复 storageState）；
   - 会话过期/失效 → 自动补扫 → 成功后继续原检索。
3. 更新验收证据与任务包状态；T06 收尾后进入达人检索主链路（T07 候选）。

## 7. 安全与红线备忘

- 项目红线：不把密码/Cookie/Token/二维码/API Key 写入项目文档；不用静态数据冒充实时链路；AI 审核结果不作法律结论。
- 处理中事项：Supabase CLI 曾意外展示过一条旧版 `service_role` key（视为已暴露，建议用户在 Settings → API Keys → Legacy 停用旧 anon/service_role，不影响新 Publishable Key）；T04 期间用户提供的数据库密码仅用于迁移，未写入任何文档。
- `.env.local` 为 gitignore 忽略项，不提交；密钥配置属红线操作，须经用户授权后进行。

## 8. 参考文档入口

- 索引：`docs/project-docs/99-工作区索引.md`
- 状态：`docs/project-docs/00-工作台/当前任务与状态/当前任务与状态.md`
- 决策：`docs/project-docs/00-工作台/决策与待确认事项/决策与待确认事项.md`
- PRD：`docs/project-docs/03-交付物/01-产品文档/01-current/媒介助手_MVP_PRD.md`
- 技术方案：`docs/project-docs/03-交付物/03-技术文档/01-current/媒介助手_MVP_技术方案_v1.md`
- API 契约：`docs/project-docs/03-交付物/03-技术文档/01-current/媒介助手_MVP_API契约_v1.yaml`
- 验收记录：`02-任务/01-current/T06-小红书扫码与真实读取PoC/验收证据/真实扫码与页面读取记录.md`
