from pathlib import Path
import re,json
from build_annotated_guide import build_pdf

HERE=Path(__file__).resolve().parent
BASE=HERE/'汪非凡_AI产品经理面试_批注融合与口语润色版.md'
NEW=HERE/'新增面试题_数据与业务协作.md'
OUTPUT=HERE/'汪非凡_AI产品经理面试_批注融合与口语润色版_75题增补版'

text=BASE.read_text(encoding='utf-8')
add=NEW.read_text(encoding='utf-8')
blocks={m.group(1):m.group(0).strip() for m in re.finditer(r'^### (Q\d{2})｜[^\n]+\n(?:(?!^### Q).|\n)*',add,re.M)}
assert len(blocks)==11

def before(marker,ids,heading=''):
    global text
    insertion=(heading+'\n\n' if heading else '')+'\n\n'.join(blocks[i] for i in ids)+'\n\n'
    assert text.count(marker)==1,marker
    text=text.replace(marker,insertion+marker,1)

before('## 二｜',['Q75'])
before('## 三｜',['Q65'])
before('## 六｜',['Q67'])
before('## 七｜',['Q66','Q68','Q69','Q70','Q73'],'## 新增专题｜数据治理、指标分析与故障排查')
before('## 附录｜',['Q71','Q72','Q74'])
text=text.replace('（Q01—Q08）','（含 Q75 职业规划）',1)
text=text.replace('（Q09—Q25）','（含 Q65 从 0 到 1 推进）',1)
text=text.replace('（Q44—Q50）','（含 Q67 业务分歧）',1)
text=text.replace('（Q57—Q64）','（含 Q71、Q72、Q74）',1)
text=text.replace('批注融合与口语润色版 · 2026-09-11','批注融合与口语润色版 · 75 题增补版 · 2026-09-11',1)
text=text.replace('全册共 131 道追问。','原版共 131 道追问。',1)
nav='''本次新增：原题 3—13 分别对应 Q65—Q75，共增加 11 道主问题、22 道追问；全册 75 道主问题、153 道追问。原题号保持不变，新增题按主题插入，因此阅读顺序不完全按数字排列，可通过书签定位。

分类索引：产品推进 Q65；业务分歧 Q67；数据专题 Q66、Q68、Q69、Q70、Q73；陌生业务接手 Q71、公司准备 Q72、工具 Q74；职业规划 Q75 与 Q08 放在一起。新增题均先给提纲，再给口语回答和两道追问。

新增题的经历边界：数据治理、算法配合与偶发模型故障题主要呈现处理思路，不代表已经独立负责过模型训练或线上算法事故。Q72 尚缺具体面试公司，保留真实产品事实的填写位置。技术补充查阅了 scikit-learn、Google Cloud 和 OpenTelemetry 官方资料，链接见附录。

'''
text=text.replace('使用顺序：',nav+'使用顺序：',1)
text=text.replace('本次未重新开展技术或市场调研。','原批注融合阶段未重新开展技术或市场调研；本次新增数据与排障题已补查下列官方资料。',1)
sources='''### 新增数据与排障题的参考资料

- [scikit-learn｜Common pitfalls](https://scikit-learn.org/stable/common_pitfalls.html)：Q66 关于数据泄漏、训练与测试划分、预处理一致性的依据；不能把测试集用于学习预处理参数。
- [Google Cloud｜Model Monitoring](https://cloud.google.com/vertex-ai/docs/model-monitoring/overview)：Q66、Q68、Q70 的数据分布与训练服务偏差排查参考；分布变化是信号，不等于已证明模型质量退化。
- [OpenTelemetry｜Observability primer](https://opentelemetry.io/docs/concepts/observability-primer/)：Q68、Q70 联合指标、日志和链路信息定位问题的参考。这里是方法借鉴，不表示个人项目已经接入该平台。

'''
text=text.replace('## 批注回看｜',sources+'## 批注回看｜',1)
for m in re.finditer(r'^### (Q\d{2})｜[^\n]+\n(?:(?!^### |^## ).|\n)*',BASE.read_text(encoding='utf-8'),re.M):
    assert m.group(0).strip() in text,m.group(1)
OUTPUT.with_suffix('.md').write_text(text,encoding='utf-8')
result=build_pdf(text,output=OUTPUT.with_suffix('.pdf'),question_count=75,expected_follow_count=153,expanded=True)
result['new_question_mapping']={str(i+3):f'Q{i+65}' for i in range(11)}
result['original_question_bodies_preserved']=True
(HERE/'verification_expanded.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(result,ensure_ascii=False,indent=2))
