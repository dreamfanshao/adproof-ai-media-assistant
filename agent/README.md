# Skills Agent（达人检索）

```powershell
$env:OPENAI_API_KEY = "..."
$env:OPENAI_BASE_URL = "https://api.openai.com/v1"
$env:OPENAI_MODEL = "gpt-5.6-sol"
npx tsx agent/server.ts
```

打开 `http://127.0.0.1:3092/agent`，管理 Skill 打开 `/skills`。

达人检索使用 LLM 做意图结构化、语义匹配和图片理解；代码只做候选加载、去重、排序和运行记录。未配置 Key 时会明确返回 `pending_llm`，不会生成假结果。

内容审核继续使用主系统已有的 `content_audit` Workflow，不由本 Agent 接管。
