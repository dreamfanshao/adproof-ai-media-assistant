from pathlib import Path
import sys, re, json, hashlib

HERE = Path(__file__).resolve().parent
OLD = HERE.parent / '2026-09-11'
sys.path.insert(0, str(OLD))
from build_annotated_guide import build_pdf

BASE = OLD / '汪非凡_AI产品经理面试_批注融合与口语润色版_75题增补版.md'
ADD = HERE / '新增面试题_传统产品基础.md'
OUT = HERE / '汪非凡_AI产品经理面试_批注融合与口语润色版_99题基础补全版'
original = BASE.read_text(encoding='utf-8')
addition = ADD.read_text(encoding='utf-8')
assert re.findall(r'^### (Q\d{2})｜', addition, re.M) == [f'Q{i}' for i in range(76,100)]
assert addition.count('主回答：') == 24
assert addition.count('概念速记：') == 24
assert len(re.findall(r'^追问\d+：', addition, re.M)) == 48

navigation = '''## 补课导航｜先理解概念，再做场景题

这次补的是你目前缺少的产品基础，不是简历技能清单。全册在 75 题基础上新增 Q76-Q99，共 99 道主问题、201 道追问。保留原题号和原答案，新增四类基础放在经历题前面；书签可以直接跳到题目。

建议读法：先用“概念速记”弄懂意思，再遮住正文复述绿色框提纲，最后用自己的话回答。含公式的题要亲手算一遍；方法题要说明“我会怎么做”，不要背成已经发生的经历。

### 第一轮｜先补面试最容易卡住的概念

需求与设计：Q76 需求与方案；Q78 BRD/MRD/PRD；Q79 故事、旅程与状态；Q81 优先级；Q83 Demo/PoC/MVP/PMF。

数据指标：Q84 北极星与护栏；Q85 PV/UV/活跃；Q86 激活、漏斗、转化；Q87 留存、同期群和流失；Q98 准确率、精确率、召回率。

技术沟通：Q95 QPS、并发和延迟；Q96 异步、幂等与重试；Q97 调用量与成本；Q99 SFT、LoRA、Embedding 与 RAG。

### 第二轮｜把概念转成分析与协作能力

补 Q77 用户研究、Q80 原型验收、Q82 版本管理、Q88 商业指标、Q89-Q90 SQL、Q91 埋点、Q92 分析方法、Q93 A/B 基础和 Q94 敏捷协作。

然后回到原有题：Q10/Q12 用需求与优先级讲媒介助手；Q26-Q33 用流程与状态讲豪森；Q43/Q68 用指标解释问题；Q47 练实验场景；Q66/Q69/Q70 练数据与排障协作。

### 自检｜不用背长段落，也能判断是否理解

每个概念回答三件事：它是什么；什么情况下会用；用错最容易导致什么判断。指标再补分母、时间窗和排除项，技术词再补用户体验、成本与风险的取舍。

本次新增中的数字、方案与假设均为教学示例，不是新增项目成绩。注册人数、生产状态、审核提效仍按已确认事实表述。窗口函数、实验和微调概念的学习，也不自动等于熟练实操经历。

'''

sources = '''## 基础补充来源｜概念核对与延伸阅读

本次于 2026-09-12 核对以下官方或方法提出方资料。用于定义核对，不表示个人项目已采用相应工具。正文采用口语化原创解释，业务示例为教学用途，非来源案例或个人线上成果。

- [S1｜Intercom：RICE 优先级方法](https://www.intercom.com/blog/rice-simple-prioritization-for-product-managers/)：Q81 的四项要素与依赖项例外；分数辅助判断，不是绝对排序。
- [S2｜Amplitude：留存分析的时间口径](https://www.amplitude.com/docs/analytics/charts/retention-analysis/retention-analysis-time)：Q87 的自然日与滚动时间区别。
- [S3｜PostgreSQL：窗口函数](https://www.postgresql.org/docs/current/tutorial-window.html)：Q90 的窗口与保留明细；[关联查询](https://www.postgresql.org/docs/current/tutorial-join.html)补充 Q89。
- [S4｜Microsoft Research：实验进行中的可信度检查](https://www.microsoft.com/en-us/research/articles/patterns-of-trustworthy-experimentation-during-experiment-stage/)：Q93 的数据质量、分流比例异常与护栏。
- [S5｜Scrum Guide 2020](https://scrumguides.org/scrum-guide.html)：Q94 的角色、Sprint、Review、Retrospective 与 Definition of Done。
- [S6｜Google SRE：服务等级目标](https://sre.google/sre-book/service-level-objectives/)：Q95 的 SLI、SLO、SLA 与服务质量取舍。
- [S7｜Google：分类评估指标](https://developers.google.com/machine-learning/crash-course/classification/accuracy-precision-recall)：Q98 的准确率、精确率与召回率；[scikit-learn 评估指标](https://scikit-learn.org/stable/modules/model_evaluation.html)补充 F1。
- [S8｜Hugging Face：SFT Trainer](https://huggingface.co/docs/trl/main/en/sft_trainer)：Q99 的监督微调；[S9｜LoRA 概念](https://huggingface.co/docs/peft/main/en/conceptual_guides/lora)说明参数高效微调与基础权重冻结。

### 容易混淆的六句话

“DAU 增长”不自动等于价值增长；“注册”不自动等于激活；“没有在 D7 回来”不自动等于永久流失；“p 小于 0.05”不等于 95% 概率方案有效；“调用成功”不等于任务完成；“模型自报 95% 置信度”不等于实际准确率 95%。

'''

text = original
text = text.replace('本次新增：原题 3—13', '9 月 11 日增补记录：原题 3—13', 1)
text = text.replace('全册 75 道主问题、153 道追问。', '当时全册 75 道主问题、153 道追问；9 月 12 日版本继续补至 99 道主问题、201 道追问。', 1)
text = text.replace('75 题增补版 · 2026-09-11', '99 题基础补全版 · 2026-09-12', 1)
assert text.count('## 一｜') == 1
text = text.replace('## 一｜', navigation + addition + '\n\n## 一｜', 1)
text = text.replace('## 批注回看｜', sources + '## 批注回看｜', 1)

old_blocks = list(re.finditer(r'^### (Q\d{2})｜[^\n]+\n(?:(?!^### |^## ).|\n)*', original, re.M))
assert len(old_blocks) == 75
for m in old_blocks:
    assert m.group(0).strip() in text, m.group(1)

OUT.with_suffix('.md').write_text(text, encoding='utf-8')
summary = build_pdf(text, output=OUT.with_suffix('.pdf'), question_count=99,
                    expected_follow_count=201, expanded=True, edition='批注融合 · 基础补全版',
                    date_stamp='2026.09.12',
                    cover_focus='新增 24 题：传统产品概念 / 指标与 SQL / 实验 / 技术沟通')
summary['original_75_answers_preserved'] = True
summary['new_questions'] = list(range(76,100))
summary['source_sha256'] = hashlib.sha256(BASE.read_bytes()).hexdigest()
summary['sections_added'] = re.findall(r'^## (.+)$', addition, re.M)
summary['definition_cards'] = addition.count('概念速记：')
summary['output'] = str(OUT.with_suffix('.pdf'))
(HERE / 'verification_foundation.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(summary, ensure_ascii=False, indent=2))
