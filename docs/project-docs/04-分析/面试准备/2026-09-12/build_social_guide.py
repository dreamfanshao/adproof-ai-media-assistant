from pathlib import Path
import sys, re, json, hashlib

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / '2026-09-11'))
from build_annotated_guide import build_pdf

BASE = HERE / '汪非凡_AI产品经理面试_批注融合与口语润色版_99题基础补全版.md'
ADD = HERE / '新增面试题_社交媒体红字版.md'
OUT = HERE / '汪非凡_AI产品经理面试_111题近期面经红字增补版'
original = BASE.read_text(encoding='utf-8')
addition = ADD.read_text(encoding='utf-8')

navigation = '''## 本次更新｜12 道主问题、24 道追问全部标红

更新日期：2026-09-12。本版保留上一版 99 道主问题及 201 道追问，新增 Q100-Q111，全册共 111 道主问题、225 道追问。仅此次新增的题目、提纲、答案、说明与来源使用红色；之前的基础补课不是本轮新增，维持原色。旧版阅读说明保留作为版本记录，其中的 64、75、99 题为当时数量，以本页和封面的 111 题为准。

本轮检索覆盖牛客和小红书。已读取并采用 6 篇牛客帖的公开正文或可见预览。小红书搜索页要求登录，尚未读取到可核实的近期原帖正文，所以没有将其计入本版证据，也未以转载、搜索摘要替代原帖。后续补到正文后可继续增补。

“近期”的边界：所用牛客页面显示发布时间在 08-12 至 09-07 之间；部分页面不显示年份，附录按页面原样记录。9 月发布的合集含更早的面试，不能当成 9 月新发生的面试。个人复盘与题目合集已分别标识。选题与旧题去重，不宣称统计出了真实被问概率。

推荐先练六题：Q100 产品壁垒；Q104 单/多 Agent；Q105 工具失败与风险；Q106 企业落地；Q109 冷启动评估；Q111 优化定位。它们分别检验产品判断、技术取舍和验证能力，适合开发转 AI 应用产品岗位。

分类 A：Q100-Q103，产品壁垒、垂类增长、功能增量、内容转化。分类 B：Q104-Q108，Agent 架构、执行风险、B/C 端、主动通知、AI+RPA。分类 C：Q109-Q111，冷启动评估、图片 PDF、Prompt/RAG/工作流优化。三个红字段落分别插入相关主题旁，可通过书签直接跳转。

每道新题保留“记忆提纲 → 口语回答 → 两道追问及答案”。帖子只提供提问角度，答案为结合你的经历独立撰写的备考建议，不是企业标准答案，也不把其他候选人的案例或数据变成你的成绩。

事实边界延续上一版：未重新核实生产上线和真实使用人数；不新增注册用户、付费、模型训练或线上事故经历。媒介助手的一天个人计时只说明名单任务自测，不等于审核提效或线上平均表现。方案题说“我会”，经历题只讲自己确实做过的部分。

'''

sources = '''## 本次来源｜公开面经、日期与采用范围

检索与读取时间：2026-09-12。以下为社区用户自述或作者整理，未独立验证面试确实发生，也不是相关公司的官方题库。帖子中有付费部分的，只使用无需付费即可读取的预览，不推测隐藏内容。未将点赞量、浏览量视为真实性证明。

### N1｜较新发布的字节题目合集，不是 9 月单场复盘

- [字节面经-字节AI产品经理岗面经-01｜牛客原帖](https://www.nowcoder.com/discuss/926271539031412736)

作者：林小白zii。页面显示 09-07 00:32，未显示年份；正文可见条目明确标注 2026 年 3-6 月等面试日期。性质：合集、部分内容付费，本次仅读公开预览。采用角度：应用差异化、单/多 Agent、工具失败、功能增量和内容转化；对应 Q100、Q102-Q105。没有复制作者未公开的回答或具体公司内部结论。

### N2｜8 月 AI 产品题目合集

- [字节面经-字节跳动产品经理岗面经-01｜牛客原帖](https://www.nowcoder.com/discuss/921941734647439360)

作者：林小白zii。页面显示 08-27 02:26 已编辑，未显示年份；采用的条目明确写面试时间为 2026-08-04。性质：合集，仅读公开预览。采用角度：Prompt 与 Agent 工作流的优化分工，对应 Q111；回答质量与留存问题已有 Q45、Q68 等覆盖，未再重复设题。

### N3｜与转岗更接近的社招个人复盘

- [某游戏中厂-AI产品经理面经｜牛客原帖](https://www.nowcoder.com/discuss/921913772581605376)

作者：牛客620914717号。页面显示 08-25 23:56，未显示年份，正文未明确实际面试日期。性质：匿名公司社招个人复盘，可见正文为付费内容之前的预览。作者自述具有游戏发行经历，不是你的履历。采用角度：缺少历史投放数据时怎样先评价内容，对应 Q109；已改写为你的图文初审场景，不套用游戏行业业绩。

### N4｜Shopee AI 产品个人面试复盘

- [Shopee AI产品经理一面面经｜牛客原帖](https://www.nowcoder.com/feed/main/detail/066865138d224529ba82ee70fe87aefb)

作者：wwwswww。页面显示 08-12 14:45，文中面试时间为 8.9，年份未显示。性质：个人复盘，15 道问题正文可读。采用角度：企业与个人 Agent、持续通知、图片型 PDF 信息提取；对应 Q106、Q107、Q110。简历解析和通知均为扩展设计题，不表示你的简历助手已经实现这些功能。

### N5｜AI+RPA 企业落地复盘

- [AI产品经理 | 明源云 | 一面｜牛客原帖](https://www.nowcoder.com/discuss/921837102587727872)

作者：大美女一号。页面显示 08-25 18:53 已编辑，未显示年份，实际面试日期未明确。性质：个人复盘，问题与个人回答正文可读。采用角度：自然语言自动化、账号权限和客户信任，对应 Q108。原帖的具体架构判断和效率数字未作为通用结论采用；本版强调合法授权、业务状态、执行校验和维护成本。

### N6｜字节产品个人面试复盘

- [字节跳动产品经理一面面经｜牛客原帖](https://www.nowcoder.com/feed/main/detail/4934d9fd5afb4c29a708d995fb05facf)

作者：甜圈乱码。页面显示 08-25 12:21，文中面试时间为 8.22，年份未显示。性质：个人复盘，14 道问题正文可读。采用角度：AI 业务增长缓慢时如何判断垂类机会，对应 Q101。LoRA、风险和模型评测在旧题已覆盖，不为了增加题数重复录入。

### 技术概念核对与阅读限制

- [T1｜Anthropic：Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)：参考任务编排、简单方案优先与控制边界；文章发布于 2024-12-19，页面提示部分工具信息已变化，本次不采用其具体工具推荐。
- [T2｜Anthropic：How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)：用于理解并行研究的适用性与协调成本，不将特定研究系统收益推广为所有 Agent 产品的效果。

小红书：本轮已尝试公开搜索与网页搜索入口；在搜索结果入口遇到登录限制，未读取可核实的近期原帖，故本版没有小红书来源编号。这里的小红书指社交平台，不把牛客上“小红书公司面试”的帖子混充为小红书平台素材。

上述问题均做了主题归纳和面试场景改写，未大量转载原文。来源只支持题目角度与日期记录；口语答案是结合你的情况给出的独立建议。行业数字、用户成绩和成功率未从其他候选人移植到你的项目中。

'''

def red(block):
    return '\n<!-- RED START -->\n\n' + block.strip() + '\n\n<!-- RED END -->\n\n'

sections = re.split(r'(?=^## )', addition, flags=re.M)
sections = [s for s in sections if s.strip()]
assert len(sections)==3
assert re.findall(r'^### (Q\d+)｜', addition, re.M)==[f'Q{i}' for i in range(100,112)]
assert addition.count('主回答：')==12
assert len(re.findall(r'^追问\d+：', addition, re.M))==24

text = original
anchors = [
    ('## 补课导航｜', navigation),
    ('## 五｜', sections[0]),
    ('## 四｜', sections[1]),
    ('## 六｜', sections[2]),
    ('## 附录｜', sources),
]
for anchor, block in anchors:
    assert text.count(anchor)==1
    text=text.replace(anchor,red(block)+anchor,1)
for m in re.finditer(r'^### (Q\d+)｜[^\n]+\n(?:(?!^### |^## ).|\n)*', original,re.M):
    assert m.group(0).strip() in text, m.group(1)

OUT.with_suffix('.md').write_text(text,encoding='utf-8')
summary=build_pdf(text,output=OUT.with_suffix('.pdf'),question_count=111,
    expected_follow_count=225,expanded=True,edition='近期面经 · 红字增补版',
    date_stamp='2026.09.12',cover_focus='本轮新增 12 道主问题、24 道追问，全文标红。\n核实牛客公开面经；小红书待登录后补充。')
summary.update(original_99_answers_preserved=True,red_question_ids=list(range(100,112)),
    new_source_posts=6,xiaohongshu_status='login_required_no_verified_posts',
    source_sha256=hashlib.sha256(BASE.read_bytes()).hexdigest(),output=str(OUT.with_suffix('.pdf')))
(HERE/'verification_social.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(summary,ensure_ascii=False,indent=2))
