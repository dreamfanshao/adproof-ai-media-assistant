
你是一名资深全栈工程师。请从当前空目录创建一个名为 SnackOps 的 Next.js 全栈项目，目标是复刻一个“零食电商客服 Agent / Planner / Skill / Tool / Eval 运营平台”。
不要先做营销首页，不要做大幅 Hero，不要生成一个只有按钮的静态 Demo。先建立可扩展、可运行、可验证的项目骨架。
必须使用：
- Next.js 16 App Router；
- React 19；
- TypeScript；
- Tailwind CSS 4；
- shadcn/ui / Radix UI；
- lucide-react；
- sonner；
- recharts；
- zod；
- pnpm。
生成以下脚本：
- pnpm dev：默认端口 5000，可使用 DEPLOY_RUN_PORT 覆盖；
- pnpm build；
- pnpm start；
- pnpm lint；
- pnpm typecheck；
- pnpm validate：至少包含 typecheck 和 lint。
建立并保留以下目录：
```text
src/app/
src/app/api/
src/components/
src/components/ui/
src/hooks/
src/lib/
data/
skills/
tools/
public/
assets/
scripts/
```
建立根布局、全局样式、统一导航、Toast、错误边界和加载状态。
SnackOps 是零食电商客服 Agent 的运营工具，界面要温暖但不能像营销网站：
- 面向高频运营和产品分析，信息密度适中；
- 页面内容优先，避免装饰性 Hero；
- 使用浅色背景、明确的深色正文和少量食物感暖色作为强调；
- 卡片圆角适中，不使用卡片套卡片；
- 所有状态不能只依赖颜色，要有文字；
- 使用 Lucide 图标，不手画复杂 SVG；
- 适配 1280×720、1440×900 和移动端；
- 按钮使用明确动词，如“运行”“保存”“测试”“重试”“接管”；
- 页面要有空状态、加载状态、错误状态和成功反馈。
先实现一个服务端 JSON 存储模块，统一处理：
- JSON 读取；
- JSON 写入；
- 进程级按文件加锁；
- 临时文件写入后原子 rename；
- 写入失败时保留上一份有效数据；
- 数据目录路径由环境变量或项目根目录推导；
- 不允许客户端直接读写 data 文件。
先建立 src/lib/store.ts 和数据类型定义，但不要把所有业务逻辑塞进一个文件。
至少准备这些数据文件，并给出合理的中文演示数据：
```text
products.json
activities.json
coupons.json
orders.json
users.json
return-policies.json
logistics.json
faq.json
tickets.json
skills.json
tools.json
tools-config.json
skill-versions.json
runs.json
ratings.json
annotations.json
improvements.json
eval_cases.json
eval_batches.json
ab-tests.json
llm-config.json
runtime-fallback.json
```
完成后实际执行：
1. pnpm install；
2. pnpm typecheck；
3. pnpm lint；
4. pnpm build；
5. 启动服务并确认 / 返回 200；
6. 通过一个临时 API 读写测试确认 JSON 原子写入和锁生效。
不要只汇报“项目创建成功”，请给出实际命令和退出码。

在已有 SnackOps 项目上继续增量实现。不要删除上一段已经完成的项目骨架、数据存储和视觉基线。
本段目标：建立零食电商客服 Agent 的业务能力注册系统。最终需要让 Planner 和 Executor 可以读取“当前启用的 Skill 和 Tool”，让运营人员可以查看、启用、停用、测试和管理版本。
完善 data 目录中的演示数据，至少覆盖：
- 商品：名称、分类、口味、价格、库存、标签、配料、过敏原、糖分/营养信息；
- 活动：活动名称、门槛、优惠规则、有效期；
- 优惠券：优惠类型、门槛、金额、有效期、适用商品；
- 订单：订单号、用户、商品、金额、物流状态、售后状态；
- 用户：新客状态、历史订单和必要偏好；
- 售后政策：破损、缺件、退换货、退款规则；
- FAQ、物流、工单和客服转人工规则。
实现 Skill 注册中心。每个 Skill 至少包含：
- id；
- name；
- description；
- enabled；
- model；
- temperature；
- maxTokens；
- requiredTools；
- version；
- 文件路径；
- system prompt 正文。
创建并初始化这些 Skill 文件，内容要能支持零食客服：
```text
need-extraction
recommendation-decision
recommendation-reason
response-generator
risk-check
clarification-question
product-substitution
after-sales-classification
complaint-triage
conversation-summary
human-handoff-decision
gift-scenario-advisor
allergy-risk-reminder
对话问候-skill
```
risk-check 必须包含可审计的规则：
- 价格一致性；
- 禁止极限词和夸大功效；
- 不做超出售后政策的承诺；
- 新客优惠判断；
- 儿童、孕妇、过敏和特殊人群的安全提示；
- 投诉和售后不能推诿；
- 疑似中奖诈骗时提醒不要转账、不要提供敏感信息、不承诺兑奖、通过官方渠道核验；
- 安全回复可以发送，危险回复才阻断。
建立 Tool 目录和 Tool 配置，至少实现：
- query_products；
- query_activities；
- query_coupons；
- calculate_price；
- query_orders；
- query_logistics。
每个 Tool 至少包含：
- id；
- name；
- description；
- input schema；
- output schema；
- 是否启用；
- 可测试入口；
- 真实数据读取逻辑；
- 错误处理。
实现 Skill 版本快照：
- 保存当前版本正文和元数据；
- 记录 createdAt、changeNote 和 hash；
- 支持列出版本；
- 支持查看版本内容；
- 支持生成 diff；
- 修改前自动保留快照；
- 不允许路径穿越写入项目外文件。
实现：
- /skills：Skill 列表、启用/停用、编辑、保存版本、查看 diff；
- /tools：Tool 列表、启用/停用、查看 schema、运行单项测试；
- /catalog：业务数据目录，可按数据类型查看摘要。
- 通过 API 能读到全部启用 Skill 和 Tool；
- 禁用一个 Skill 后，读取启用列表时不再出现它；
- Tool 测试能返回真实 data JSON 中的结果；
- 保存 Skill 版本后，刷新页面仍能看到版本；
- 修改前有快照，版本 diff 可查看；
- 试图写入 ../../ 路径会被拒绝；
- pnpm typecheck、pnpm lint、pnpm build 通过。


在已有 SnackOps 项目上继续实现 Agent 主链路。不要用一段硬编码 if/else 直接返回最终答案，不要绕过 Planner、Skill、Tool 和风险检查。

## 一、LLM Provider 抽象

建立统一的 LLM 调用层，支持：

1. `coze`：通过 coze-coding-dev-sdk 调用；
2. `openai-compatible`：读取 `OPENAI_API_KEY`、`OPENAI_BASE_URL` 和 `LLM_MODEL`；
3. `classroom-fixture`：无外部密钥时提供明确标识的确定性演示输出。

Provider 不得静默把真实模式降级成演示模式。缺少配置时必须返回结构化中文错误，并告诉用户如何切换到演示模式。

课堂 fixture 必须经过与真实模型相同的“生成 → 执行评分 → 形成报告”链路，不允许直接往批次结果里写 PASS/FAIL。

## 二、Planner

实现 Planner：

- 输入 userInput、conversationHistory、availableSkills、availableTools 和 mandatoryCapabilities；
- 输出结构化 JSON Plan；
- Plan 至少包含 selectedSkills、selectedTools、reasoning、mandatoryCapabilities 和风险判断；
- 只能选择当前启用的 Skill 和 Tool；
- 涉及价格必须选择价格相关 Tool；
- 涉及订单/物流必须选择对应 Tool；
- 涉及风险输入必须包含 risk-check 或风险处理能力；
- 无法满足能力时必须明确降级或转人工；
- JSON 解析失败时提供安全 fallback，不得让页面崩溃。

## 三、Plan 校验

实现独立的 Plan Validator：

- 禁止调用未启用能力；
- 禁止使用不存在的 Skill/Tool；
- 检查 mandatoryCapabilities 是否遗漏；
- 价格场景缺少价格 Tool 时标红；
- 风险场景缺少风险检查时阻断或降级；
- 记录校验错误。

## 四、Executor

Executor 按 Plan 执行：

- 逐步调用 Skill 和 Tool；
- 每一步记录 stepId、类型、输入、输出、耗时、状态和错误；
- Tool 失败不能伪装成成功；
- Skill 超时要有明确错误；
- 生成最终回复后执行 risk-check；
- 最终回复、风险结果和完整 Trace 一起持久化。

## 五、RunRecord

建立统一 RunRecord：

- id；
- question；
- source；
- conversationId；
- createdAt；
- status；
- finalReply；
- plan；
- steps；
- riskResult；
- durationMs；
- error；
- provider；
- model；
- skillVersions；
- toolVersions。

## 六、本段 API

至少实现：

- `POST /api/agent/run`：支持 SSE 或等价流式事件，返回步骤事件、最终回复、错误和完成事件；
- `GET /api/runs`：分页/限制返回 RunRecord；
- `GET /api/runs/[id]`：返回完整详情；
- `POST /api/run/retry`：重试一次运行；
- `POST /api/runs/[id]/handoff`：标记人工接管；
- `POST /api/runs/[id]/annotate`：保存标注；
- `POST /api/explain`：解释某条运行或风险判断。

## 本段页面

- `/`：完整 Agent 工作台，支持输入问题、查看计划/步骤/最终回复/风险状态；
- `/demo`：简化聊天页面，能真实调用同一 Agent 主链路；
- `/runs/[runId]`：详情页显示 Trace、重试、人工接管和标注。

## 本段验收

实际完成：

1. 输入一个正常推荐问题，能得到最终回复和 Trace；
2. 输入价格问题，能看到价格 Tool 是否被调用；
3. 输入物流/订单问题，能看到对应 Tool；
4. 输入中奖诈骗问题，能看到风险识别和安全回复；
5. 禁用一个必需 Skill 后，系统不会继续伪装成功；
6. 人为让 Tool 返回错误，RunRecord 能记录 ERROR；
7. 刷新详情页，历史 RunRecord 仍存在；
8. `pnpm typecheck`、`pnpm lint`、`pnpm build` 通过。
在已有 SnackOps 项目上继续增量实现管理后台。不要删除首页、Demo、Run详情或已有 API。管理后台必须真实读写服务端数据，不允许所有按钮只改变 React state。

## 一、Skill 管理

`/skills` 页面实现：

- Skill 列表；
- 名称、描述、启用状态、模型、温度、Token 上限、依赖 Tool；
- 按启用状态筛选；
- 查看 Prompt 正文；
- 编辑和保存；
- 保存前创建版本快照；
- 查看版本列表、版本正文、diff、changeNote；
- 失败时保留旧版本并显示错误。

## 二、Tool 管理

`/tools` 页面实现：

- Tool 列表；
- 描述、输入 schema、输出示例、启用状态；
- 单个 Tool 测试表单；
- 显示真实输入、真实输出、耗时和错误；
- 不允许客户端伪造成功结果。

## 三、Planner 管理

`/planner` 页面实现：

- Planner 版本与配置；
- 可查看 Planner Prompt；
- 选择启用的 Skill/Tool；
- 设置 mandatoryCapabilities；
- 输入测试问题并预览计划；
- 显示 selectedSkills、selectedTools、reasoning 和校验结果；
- 计划非法时明确显示原因。

API 至少实现：

- `/api/skills`；
- `/api/skills/[id]/versions`；
- `/api/tools`；
- `/api/tools/[id]/test`；
- `/api/planner`；
- `/api/planner/preview`。

## 四、模型管理

`/models` 页面实现：

- 当前 Provider；
- Provider 描述；
- 默认模型；
- 模型列表；
- 环境变量配置状态，但不显示密钥原文；
- 测试连接；
- 切换 Provider；
- 当前运行模式 Banner；
- 真实 Provider 缺配置时显示明确错误；
- classroom-fixture 明确标注为演示稳定模式。

API 至少实现：

- `GET/PUT /api/llm-config`；
- `POST /api/llm-config/switch`；
- `POST /api/llm-config/test`。

## 本段验收

- Skill 编辑刷新后仍然生效；
- Tool 测试确实调用服务端 Tool；
- Planner 预览会根据启用状态改变结果；
- Provider 切换会影响后续 RunRecord；
- 密钥不出现在客户端 bundle、页面和日志；
- Provider 测试失败有结构化错误；
- 页面拥有 loading、empty、error 和 success 状态；
- 三个目标视口不出现按钮遮挡或文字溢出。
在已有 SnackOps 项目上继续实现 `/ops` 运营中心。不要把它做成一个只显示数字的 Dashboard。运营中心要支持从运行结果发现问题、标注问题、沉淀评测用例、生成改进建议并追踪处理。

## 一、运行监控

显示：

- 运行总数；
- 成功率；
- 平均耗时；
- 失败步骤；
- 风险等级分布；
- 人工接管率；
- 最近运行列表；
- 可打开 Run 详情。

## 二、服务评分

支持：

- 记录用户对回复的评分；
- 保存当时的问答对；
- 低分自动进入 Bad Case 或改进建议；
- 评分与运行记录关联；
- 按时间、评分和问题类型筛选。

## 三、数据标注

支持：

- 对 Run 或回复进行标注；
- 标注状态 pending/accepted/rejected；
- 记录 correctness、relevance、completeness、safety、tone、overall 等维度；
- 保存标注人、时间、备注；
- 支持导出标注数据；
- 标注结果可以进入改进建议或评测集。

## 四、改进建议中心

支持：

- 按 Bad Case、低评分和低分标注聚类；
- 给出 Planner/Skill/Tool/Eval 四类改进方向；
- 显示样本 Run；
- 生成 Prompt 改进草案，但不得自动覆盖生产 Prompt；
- 预览 diff；
- 用户确认后应用；
- 应用前保存 Skill 版本快照。

## 五、其他运营能力

保留并实现可用的入口：

- 人工评估；
- 版本回滚；
- Prompt A/B；
- 改进记录。

如果本段时间不足，可以先做真实数据链路和页面入口，复杂聚类使用确定性规则，但必须明确标识“规则聚类”，不能伪装成 LLM 分析。

## 六、API

至少实现：

- `/api/ratings`；
- `/api/annotations`；
- `/api/annotations/[id]`；
- `/api/annotations/export`；
- `/api/improvements/generate-prompt`；
- `/api/improvements/apply-prompt`；
- `/api/ab-tests`。

## 本段验收

1. 从一条 Run 创建低分评分；
2. 该评分能在运营中心看到；
3. 创建一条标注并刷新页面仍存在；
4. 导出数据能打开且字段正确；
5. 低分样本能进入改进建议；
6. 生成 Prompt 草案不会自动覆盖原 Skill；
7. 应用改进前能创建版本快照；
8. 版本回滚能恢复旧正文；
9. 运营中心请求失败时不会让整页崩溃。
在已有 SnackOps 项目上继续实现 Eval 子系统。不要重新做一个脱离 Agent 主链路的假测试模块。Eval 必须调用同一个 Agent 执行链，读取本次真实生成的最终回复和 Trace，再执行评分。

## 一、评测集数据模型

每条 EvalCase 至少包含：

- id；
- name；
- question；
- scenario/category；
- difficulty；
- riskLevel；
- expectedBehavior；
- expectedReply 或 expectedKeywords；
- forbiddenWords；
- expectedPrice；
- expectRiskPassed 或更清晰的回复风控字段；
- requiredCapabilities；
- forbiddenCapabilities；
- evalDimension；
- llmJudgePrompt（可选，但未接通时不能伪造评分）；
- tags；
- sourceRunId；
- createdAt；
- enabled。

评测集至少初始化以下方向：

- 麻辣办公室零食预算推荐；
- 新客礼盒；
- 老人低糖；
- 价格核验；
- 破损/缺件售后；
- 促销叠加；
- 功效夸大；
- 中奖诈骗；
- 模糊需求。

课堂最终可以选择 6-8 条运行，不要求全量运行。

## 二、评测集 CRUD

实现：

- 列表；
- 新增；
- 编辑；
- 删除；
- 复制；
- 启用/停用；
- 按分类、难度、风险和评测维度筛选；
- 从一次 Run 加入评测集；
- 字段校验；
- 刷新后持久化。

API：

- `GET /api/eval`：返回 cases、batches、skills、tools；
- `POST /api/eval/cases`；
- `PATCH /api/eval/cases/[id]`；
- `DELETE /api/eval/cases/[id]`。

## 三、评分器

实现可测试的纯评分函数，至少支持：

- 关键词组 AND/OR；
- 禁词；
- 价格识别与核验；
- 必需能力和禁用能力；
- 风险输入识别；
- 最终回复安全合规；
- REVIEW；
- ERROR。

必须分开：

- 用户输入的风险意图；
- Agent 最终回复是否安全；
- 最终回复是否应该发送。

安全回复不是因为用户风险高就自动判失败。危险回复才应被拦截。

评分结果至少包含：

- status：PASS/FAIL/REVIEW/ERROR；
- passed；
- reason；
- evidence；
- keywordHits；
- keywordMisses；
- forbiddenHits；
- expectedPrice；
- mentionedPrice；
- riskIssues；
- capabilityHits；
- durationMs；
- runId。

ERROR 不得统计为产品质量 FAIL；REVIEW 必须单独展示。

## 四、单条测试

在 Eval 页面支持单条运行：

- 调用 `/api/agent/run`；
- 正确解析 SSE 或等价事件；
- 保存完整 Trace；
- 显示最终回复；
- 显示评分结果；
- 失败时在页面内展开完整错误和 Trace；
- 不要跳转到不存在的详情路由。

## 本段验收

- 新增一条 EvalCase 后刷新仍存在；
- 修改 expectedKeywords 后评分逻辑真的变化；
- 删除/停用用例后不会出现在默认启用集；
- 单条测试返回实际 Agent 回复而不是静态样例；
- 评分证据能追溯到这次 runId；
- 模型/API错误显示 ERROR，不显示成普通 FAIL；
- 关键词逻辑和风险回复语义都能通过单元测试。

在已有 Eval 子系统上继续实现批量评测和版本对比。必须复用同一个 Agent 执行链和评分器，不允许读取旧结果直接伪造新批次。
支持选择 caseIds。规则：
- 不传 caseIds：运行全部 enabled 用例；
- 传合法 caseIds：只运行指定用例；
- 传空数组：返回 400；
- 有无效 ID：返回 400 并列出无效 ID；
- 批次保存实际 caseIds；
- 第二次回归默认复用第一批次的 caseIds。
每个批次记录：
- id；
- name；
- versionLabel；
- changeNote；
- caseIds；
- caseSnapshot 或 caseSetHash；
- skillVersion/hash；
- evaluatorVersion/hash；
- provider；
- model；
- params；
- createdAt/startedAt/finishedAt；
- status；
- currentIndex；
- total；
- passed；
- failed；
- review；
- errors；
- caseResults。
批次状态：
```text
queued | running | done | error | cancelled
```
单条用例状态：
```text
PASS | FAIL | REVIEW | ERROR
```
单条 ERROR 后批次应继续运行其他用例；只有整批无法继续时，批次才进入 error。
统计必须满足：
```text
total = pass + fail + review + error
```
ERROR 不进入产品质量通过率分母，REVIEW 不伪装成 PASS。
实现：
- POST /api/eval/batch/run：创建批次并返回 batchId；
- GET /api/eval/batch/[id]：返回 { batch }；
- 不存在时返回结构化 404；
- 运行进度可轮询；
- 到达 done/error/cancelled 后停止轮询；
- 运行失败不会让页面无限 loading；
- 快速重复点击不会产生无法区分的重复请求。
每条结果显示：
- 用例名称和问题；
- 实际最终回复；
- PASS/FAIL/REVIEW/ERROR；
- 失败原因；
- 命中/缺失关键词；
- 禁词；
- 价格证据；
- 风险证据；
- 能力路径；
- 耗时；
- runId 和 Trace 链接。
报告必须显示当前实际评测方式。若 LLM-as-a-Judge 未接通，要显示“规则评测，Judge 未启用”，不能展示虚假 Judge 分数。
支持选择两个批次比较：
- 通过率和状态数量；
- 已修复用例；
- 新增失败/回归用例；
- 状态不变但回复改变；
- 平均耗时变化；
- Provider、模型、参数和评测器是否一致。
如果 caseIds、用例快照、评分器或运行条件不同，必须显示“不可直接比较”，不能直接给出“版本变好”的结论。
1. 选择 3 个 caseIds，批次 total 必须等于 3；
2. 确认结果中只出现这 3 个 caseId；
3. 批次轮询能到达终态；
4. 刷新后仍能查看批次；
5. 创建 baseline-v1 和 risk-fix-v2；
6. 两批使用相同 caseIds 和评分器快照；
7. 主案例修复时显示“已修复”；
8. 出现新失败时显示“新增失败”，不能只展示总分上涨；
9. 直接修改旧批次的 passed 字段不能伪造新批次结果；
10. pnpm typecheck、pnpm lint、pnpm build 通过

请对当前 SnackOps 项目完成最终工程化和可用性收尾。不要推翻已有功能，重点补齐 Provider、演示模式、重置、测试和安全验证。
确认并统一：
- coze；
- openai-compatible；
- classroom-fixture。
实现：
- Provider 配置页面；
- 当前 Provider 和模型；
- 配置状态；
- 连接测试；
- 切换 Provider；
- 真实模式缺配置时结构化报错；
- fixture 模式明确显示“演示稳定模式”；
- 不将 fixture 伪装成真实模型；
- 不在客户端暴露密钥。
实现 pnpm classroom:reset 或等价脚本：
- 恢复评测集、Skill、Skill 版本、批次、标注和改进数据到已知初始状态；
- 不误删商品、订单和业务基础数据；
- 重复执行两次结果一致；
- 生产环境不暴露无保护的重置接口；
- 重置过程使用原子写入。
补充或执行：
- 关键词 AND/OR；
- 禁词；
- 价格；
- 风险回复；
- PASS/FAIL/REVIEW/ERROR；
- 统计守恒。
- EvalCase CRUD；
- caseIds 精确过滤；
- 空数组和无效 ID；
- 批次轮询；
- Provider 缺配置；
- Skill 版本快照；
- classroom reset。
实际操作：
```text
打开 /
→ 输入一条客服问题
→ 查看 Trace
→ 打开 /skills 编辑 risk-check
→ 打开 /tools 测试一个 Tool
→ 打开 /planner 预览计划
→ 打开 /ops 评测集
→ 运行 3 条用例
→ 查看实际回复和证据
→ 打开 /models 切换 fixture
→ 创建两次批次
→ 打开对比
→ 执行 reset
→ 刷新确认数据恢复
```
只有全部满足才算完成：
1. /、/demo、/skills、/tools、/planner、/ops、/catalog、/models 和 Run 详情均能打开；
2. Agent 主链路真实可运行；
3. Skill、Tool、Planner 配置真实持久化；
4. Eval 单条和批量测试调用真实 Agent 链路；
5. 3 个 caseIds 只运行 3 条；
6. 批次轮询和终态正确；
7. 结果含实际回复和 evidence；
8. ERROR 与 FAIL 分开；
9. 两批次可比较性有检查；
10. 无密钥时 fixture 能完成课堂演示；
11. 真实 Provider 缺配置时不静默伪装成功；
12. Skill 修改前有版本快照；
13. 重置可重复且不破坏业务基础数据；
14. 客户端无密钥泄漏；
15. typecheck、lint、build 和核心测试通过；
16. 1280×720、1440×900、390×844 下关键操作可用。
请最终汇报：
- 修改的文件；
- 新增的页面、API、数据和脚本；
- 每个页面的真实功能；
- 实际执行过的命令和退出码；
- 浏览器验证步骤和结果；
- 未完成事项；
- 仍然存在的风险；
- 如何启动项目；
- 如何切换 Provider；
- 如何执行课堂重置。
不要隐藏失败测试，不要声称未执行的浏览器验证已经通过。
