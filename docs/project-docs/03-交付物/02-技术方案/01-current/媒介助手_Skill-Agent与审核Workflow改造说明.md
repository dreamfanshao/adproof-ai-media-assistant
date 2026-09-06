# 媒介助手：Skill Agent + 内容审核 Agent 改造说明

## 1. 边界

- 达人检索改为 Skills Agent：Planner/Executor 只允许调用已启用的 Skill/Tool，并记录每一步的输入、输出和状态。
- 内容审核也改为固定计划的 Agent + Skills。广告法、公共 RAG、企业私有知识库、确定性规则扫描仍作为工具层和证据兜底；模型不可用时不伪造结论，结果进入人工复核。
- 两条链路都不把 LLM 当作硬性数据源：粉丝数、去重、版本快照、风险合成和持久化由代码负责。

## 2. 达人检索 Agent

内置 Skills：

1. creator_intent_structuring：自然语言需求结构化。
2. creator_semantic_matching：依据简介、笔记文本和图片证据进行语义匹配。
3. creator_image_understanding：理解博主笔记图片中的项目、场景和可见文字。
4. creator_ranking：确定性代码排序。
5. creator_evidence_summary：输出可人工核验的证据摘要。

内置 Tools：加载候选、去重、排序、记录运行。

模型只负责意图、语义和图像证据；代码负责硬性数据校验、去重、排序和持久化。模型不能编造粉丝数、活跃度或主页链接。

## 3. 内容审核 Agent

固定计划（每次审核均记录）：

1. audit_retrieve_knowledge：读取公共广告法和用户选择的私有知识库。
2. audit_deterministic_rule_scan：执行广告法核心规则扫描，作为可复现兜底。
3. audit_intent_structuring：结构化审核要求、脚本和审核目标。
4. audit_image_understanding：分析图中文字、卖点、功效暗示和视觉表达。
5. audit_text_compliance：结合正文、图片证据和知识片段识别风险。
6. audit_risk_decision：输出风险等级、置信度和建议动作。
7. audit_review_summary：生成带证据引用的人工复核摘要。
8. audit_persist_findings：由代码持久化发现项、知识快照和运行状态。

工具层：

- audit_retrieve_knowledge：检索并固定知识库版本。
- audit_deterministic_rule_scan：正则/规则扫描，仅作高确定性提示，不替代语义判断。
- audit_load_assets：加载短时签名的审核素材 URL。
- audit_persist_findings：写入审核发现、覆盖警告和结果。

### Skill 调用边界

每个 Skill 都声明 useWhen、notFor、requiredInputs 和 outputContract：

- 图像 Skill 只在存在图片资产且可以访问素材时调用；不适用于推断不可见信息、身份属性或医学诊断。
- 文本合规 Skill 只判断宣传表达与规则风险；不适用于替代律师意见、事实核验或平台最终裁决。
- 风险决策 Skill 必须基于已提供的证据和规则命中；不适用于无证据直接给出“通过”。
- 审核摘要 Skill 只做证据归纳；不适用于新增事实或改变风险等级。
- 规则扫描 Tool 只做确定性命中；不适用于覆盖隐喻、上下文、图片语义等开放性判断。

## 4. LLM 配置与数据边界

只通过环境变量配置，不写入仓库：

    OPENAI_API_KEY=...
    OPENAI_BASE_URL=https://api.openai.com/v1
    OPENAI_MODEL=gpt-5.6-sol

已获得项目授权：审核正文、私有知识片段和短时签名图片 URL 可以发送到配置的 LLM API。系统不保存账号密码、Cookie 或验证码；签名图片 URL 仅短时有效。

未配置 Key 或模型调用失败时返回 pending_llm/needs_confirmation，展示确定性规则结果和覆盖警告，不冒充 AI 已完成。

## 5. 结果与审计

- audit_tasks.result_schema_version = content-audit-agent.v1。
- Worker Job 结果记录 agent_status、计划、步骤状态和免责声明。
- 审核发现项保留知识库范围、版本、文档、chunk、定位和引用片段。
- 图片存在但模型未完成时写入覆盖警告，整体结果不得直接视为“通过”。
- 代码最终按最高风险、低置信度和覆盖缺口合成 overall_risk，保留人工复核入口。

## 6. 本地运行

    npx tsx agent/http-server.ts
    npm run dev:worker

默认打开：

- http://127.0.0.1:3092/agent：Agent 执行页
- http://127.0.0.1:3092/skills：Skill 管理页
- http://127.0.0.1:5173：主系统
- http://127.0.0.1:3081：本地 Eval/质量中心

运行记录存于 agent/data/runs.json，Skill 配置存于 agent/data/skills.json；这些文件不应提交密钥。

## 7. 当前接入状态

- worker/src/xhs-search-executor.ts 已调用达人 Skills Agent。
- worker/src/audit-executor.ts 已调用内容审核 Agent，并保留公共广告法、私有知识库、确定性规则和人工复核兜底。
- worker/src/xhs-field-mapper.ts 已采集公开小红书图片 URL，并写入 creator 快照与 analysis_json。
- 粉丝数等硬条件、去重、知识快照、风险合成和持久化由代码执行。