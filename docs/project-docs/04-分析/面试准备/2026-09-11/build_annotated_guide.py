from pathlib import Path
import sys, re, json, zipfile, difflib
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[5]
HERE = Path(__file__).resolve().parent
DOCX = ROOT / 'output/word/汪非凡_AI产品经理面试_提纲与口语回答版.docx'
BASE = HERE.parent / '2026-09-09/汪非凡_AI产品经理面试_提纲与口语回答版.md'
OUT = HERE / '汪非凡_AI产品经理面试_批注融合与口语润色版'
NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
WNS = '{' + NS['w'] + '}'

def extract():
    with zipfile.ZipFile(DOCX) as z:
        root = ET.fromstring(z.read('word/document.xml'))
        comments = ET.fromstring(z.read('word/comments.xml'))
    paragraphs = root.findall('.//w:body/w:p', NS)
    body = [''.join(p.itertext()).strip() for p in paragraphs]
    original = BASE.read_text(encoding='utf-8')
    normalized = [re.sub(r'^#{1,3} |^- ', '', re.sub(r'\[([^\]]+)\]\([^)]*\)', r'\1', s)).replace('**', '').strip() for s in original.splitlines()]
    diff = list(difflib.unified_diff([x for x in normalized if x], [x for x in body if x]))
    assert not diff, 'Word body has edits requiring review: ' + '\n'.join(diff[:40])
    records = {}
    for c in comments:
        cid = c.get(WNS+'id')
        records[cid] = {'id': cid, 'comment': ''.join(c.itertext())}
    for p in paragraphs:
        for ref in p.findall('.//w:commentReference', NS):
            records[ref.get(WNS+'id')]['question'] = ''.join(p.itertext())
    assert len(records) == 5 and all('question' in x for x in records.values())
    return original, records

def revise(original, records):
    revisions = json.loads((HERE / 'revisions.json').read_text(encoding='utf-8'))
    for q, spec in revisions.items():
        match = re.search(r'^### '+q+r'｜[^\n]+\n(?:(?!^### |^## ).|\n)*', original, re.M)
        assert match, q
        block = match.group(0)
        title = block.splitlines()[0]
        intent = re.search(r'^考察点：.+$', block, re.M).group(0)
        parts = [title, intent, '记忆提纲：'+spec['outline'], '主回答：'+spec['answer']]
        follows = spec['follows']
        if q == 'Q04':
            # Preserve the previous evidence and product-design follow-ups too.
            prior = re.findall(r'^追问\d+：([^\n]+)\n\n追问提纲：([^\n]+)\n\n答：([^\n]+)', block, re.M)
            follows = follows + [list(x) for x in prior]
        for i, (question, outline, answer) in enumerate(follows, 1):
            parts += [f'追问{i}：'+question, '追问提纲：'+outline, '答：'+answer]
        parts += ['备考备注：'+spec['note']]
        original = original[:match.start()] + '\n\n'.join(parts) + '\n\n' + original[match.end():]
    start = original.index('## 阅读前')
    end = original.index('## 一｜')
    intro = '''## 阅读前｜你的批注怎样融入答案

本版基于你加批注的 Word 整合：共读取 5 条批注，分别对应 Q01、Q02、Q04、Q05、Q06；Word 正文与 9 月 9 日原稿一致。保留全部 64 道主问题，相关追问同步润色，Q04 另补研发沟通和协作举证两道追问，全册共 131 道追问。Q58 按后续谈薪对话更新为税前固定月薪 20K。

使用顺序：先记绿色框中的提纲，再用自己的话讲答案。主回答先给观点，接一个具体经历，讲完留出追问空间。自我介绍约 90 秒，可按岗位删减；其他题根据追问深度展开。灰色备考备注解释表达取舍，不属于面试口述。

本次重点：保留你偏自然的叙述、班长经历、客户现场沟通和前司领导对协作的认可；把“擅长沟通”落实到需求、规则和验收，把“AI 边界与成本”补成需求价值、人机分工、评测和成本体验四项判断。

待核实的新信息：你在批注中写了“已上线并投入真实业务，效率提高约 60%”，此前确认的是备案准备上线，以及一天个人名单计时自测。本次已询问最新上线范围、使用人数和测量口径，暂未获得补充。涉及项目阶段的旧题暂沿用上次确认状态，不视为本次核实了最新状态；不要直接背成当前事实。Q01 先使用不依赖上线状态的说法。已经确认的自测是 20 人名单约 180 分钟降至 40—60 分钟，不能推成图文审核提效或线上平均结果。

年限与职责：保融任职 2023.11.14—2026.03.31，含毕业前实习，表述为“两年多含实习的企业项目经历”；豪森承担的是特定跨模块需求的澄清、设计、开发联调，不是独立负责整个客户项目。方法题中的“我会”表示处理思路；真实用户量、付费、薪资和 Offer 未提供的继续留空。

技术实现说明沿用原稿的核对边界，本次未重新执行项目代码、模型调用或生产验收；既有参考链接作为延伸阅读保留。附录增加 5 条批注的处理说明，方便你检查个人想法被保留和修正的位置。

'''
    original = original[:start] + intro + original[end:]
    original = original.replace('提纲与口语回答版 · 2026-09-09', '批注融合与口语润色版 · 2026-09-11')
    original = original.replace('以下资料只用于概念核对和补充阅读，不代表个人项目按其完整实现。本轮重新查阅了所列技术资料；薪资沿用 2026-09-07 的少量公开岗位参考，不代表 2026-09-09 的全市场调查。题目按你的经历和目标选择，“高频”不代表量化被问概率。', '以下技术资料沿用 9 月 9 日原稿的来源记录，供补充阅读，不代表项目完整实现。本次未重新开展技术或市场调研。薪资旧链接保留作历史参考，Q58 的 20K 是后续对话形成的个人谈薪建议，不是对旧岗位报价求平均得到的结果。题目按经历与目标选取，不代表量化被问概率。')
    original = original.replace('核对边界：本轮基于原核准版、用户已确认经历、当前工作台与决策记录重写表达。未重跑付费外部接口、生产任务或用户计时；未修改项目代码、简历和旧版 PDF。开发与方案能力得到体现，不等于新增了尚未发生的业绩。', '核对边界：本次依据 5 条 Word 批注与后续对话整合表达；Word 原文件、简历和旧 PDF 保留。未重新验证生产状态或执行用户计时。批注中的上线与提效新口径待补充后，再同步 Q05、Q09、Q19、Q56 等题。')
    audit = [
        ('Q01', '自我介绍', '保留学校、班长、企业项目和独立实践的叙述顺序。', '“两年半”调整为“两年多，含实习”；“AI 等原因离职”移到离职题。暂不写尚未确认的线上业务提效，结尾明确应聘方向。'),
        ('Q02', '转岗原因', '保留对业务问题更感兴趣，以及豪森现场随产品对接客户的经历。', '沟通优势需要连接实际产出；AI 冲击作为职业思考的触发因素，转岗理由落到需求判断、方案取舍和结果验证。'),
        ('Q04', '为什么录用你', '保留开发背景、懂研发关注点及前司领导认可沟通协作的反馈。', '补齐规则、异常、依赖和验收，用豪森与媒介助手举证。加入两道沟通追问，并保留原有风险识别和产品基本功追问。'),
        ('Q05', '个人短板', '保留“熟悉开发交付，但缺持续产品运营经验”的判断。', '推广计划进一步落到真实任务观察、采用和复用指标；已有自测与后续用户验证分开说明。'),
        ('Q06', 'AI 产品经理理解', '保留能力边界、幻觉与高风险处理、成本把控三个观点。', '补上用户问题是否值得解决，以及评测如何验证质量；用图文初审解释人机分工，避免只罗列技术风险。')
    ]
    appendix = ['## 批注回看｜保留了什么，为什么调整', '本节供复盘使用，不属于面试口述答案。']
    for q, label, kept, changed in audit:
        appendix += [f'### {label}（{q}）', '保留：'+kept, '调整：'+changed]
    appendix += ['### 后续再补充时', '可直接按题号补写自己的说法。经历题重点补具体行动和结果；方法题重点补判断依据、取舍和例子。上线日期、外部用户人数、计时样本和前薪补齐后，再统一更新相关题目，避免不同答案中的事实口径冲突。']
    return original + '\n\n' + '\n\n'.join(appendix) + '\n', revisions

def build_pdf(text, output=None, question_count=64, expected_follow_count=131, expanded=False,
              edition=None, date_stamp='2026.09.11', cover_focus=None):
    destination = Path(output) if output else OUT.with_suffix('.pdf')
    sys.path.insert(0, str(ROOT / 'tmp/pdfs'))
    from build_interview_outline_20260909 import Guide, ST, style, inline, W, H, GRAY
    from reportlab.lib import colors
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, Spacer, PageBreak, KeepTogether, CondPageBreak
    from reportlab.platypus.tableofcontents import TableOfContents
    from pypdf import PdfReader
    import pdfplumber
    from reportlab.lib.styles import ParagraphStyle
    red = colors.HexColor('#AF241D')
    red_styles = {key: ParagraphStyle('red_'+key, parent=value, textColor=red)
                  for key,value in ST.items()}
    red_styles['outline'].backColor = colors.HexColor('#FFF2EF')
    red_mode = False
    def selected(key):
        return red_styles[key] if red_mode else ST[key]
    def formatted(s):
        result = inline(s)
        if red_mode:
            result = re.sub(r'color=[\"\'][^\"\']+[\"\']', 'color="#AF241D"', result)
        return result
    class ColoredGuide(Guide):
        def afterFlowable(self, flowable):
            if (isinstance(flowable, Paragraph) and hasattr(flowable, 'navkey')
                    and flowable.navlevel == 0 and flowable.style.textColor == red):
                key = flowable.navkey
                title = flowable.getPlainText()
                self.canv.bookmarkPage(key)
                self.canv.addOutlineEntry(title, key, level=0, closed=True)
                self.notify('TOCEntry', (0, '<font color="#AF241D">'+title+'</font>', self.page, key))
            else:
                super().afterFlowable(flowable)

    def chrome(canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(colors.HexColor('#D6E0E5'))
        canvas.line(20*mm, H-16*mm, W-20*mm, H-16*mm)
        canvas.setFont('CN', 8)
        canvas.setFillColor(GRAY)
        canvas.drawString(20*mm, H-12*mm, '汪非凡 / AI 产品经理面试准备')
        canvas.drawRightString(W-20*mm, H-12*mm, (edition or ('批注融合增补版' if expanded else '批注融合版')) + ' · ' + date_stamp)
        canvas.drawString(20*mm, 12*mm, '先记提纲，再用自己的经历回答。')
        canvas.drawRightString(W-20*mm, 12*mm, str(doc.page))
        canvas.restoreState()

    qs = re.findall(r'^### (Q\d+)｜(.+)$', text, re.M)
    assert sorted((q for q,_ in qs), key=lambda q:int(q[1:])) == [f'Q{i:02}' for i in range(1,question_count+1)]
    assert len(re.findall(r'^主回答：', text, re.M)) == question_count
    assert len(re.findall(r'^记忆提纲：', text, re.M)) == question_count
    follow_count = len(re.findall(r'^追问\d+：', text, re.M))
    assert follow_count == expected_follow_count
    assert len(re.findall(r'^追问提纲：', text, re.M)) == follow_count
    assert len(re.findall(r'^答：', text, re.M)) == follow_count

    doc = ColoredGuide(str(destination), pagesize=(W,H), leftMargin=20*mm, rightMargin=20*mm,
        topMargin=23*mm, bottomMargin=22*mm, title='汪非凡 AI产品经理面试｜批注融合与口语润色版', author='汪非凡 · 个人备考')
    story = [Spacer(1,25*mm), Paragraph('AI 应用产品经理<br/>面试准备', ST['cover']), Spacer(1,8*mm),
        Paragraph('汪非凡｜' + (edition or ('批注融合与口语润色' + ('增补版' if expanded else '版'))), ST['subtitle']), Spacer(1,16*mm),
        Paragraph(f'{question_count} 道主问题 · {follow_count} 道追问', ST['sub']),
        Paragraph('融合 5 条个人批注，保留记忆提纲与口语回答。', ST['body']), Spacer(1,12*mm),
        Paragraph('把自己的理解讲清楚。', ST['subtitle']),
        Paragraph('保留你对业务、沟通与 AI 能力边界的判断，用真实经历补足依据，让答案更自然，也更经得起追问。', ST['body']),
        Spacer(1,12*mm), Paragraph(cover_focus or ('本次增补：产品推进 / 数据治理 / 异常排查 / 业务协作' if expanded else '重点修订：自我介绍 / 转岗 / 优势 / 短板 / 岗位理解'), red_styles['body'] if '<!-- RED START -->' in text else ST['body']),
        Paragraph('同步更新：谈薪口径 · 税前固定月薪 20K', ST['body']),
        Paragraph(date_stamp, ST['body']), PageBreak(), Paragraph('阅读导航', ST['section'])]
    toc = TableOfContents()
    toc.levelStyles = [style('toc_annotated', fontSize=10 if question_count>75 else 10.5,
        leading=16 if question_count>99 else (19 if question_count>75 else 21), spaceBefore=1 if question_count>99 else (2 if question_count>75 else 4),
        spaceAfter=2 if question_count>99 else (4 if question_count>75 else 7), rightIndent=20)]
    story.append(toc)
    if question_count <= 99:
        story += [Spacer(1,8*mm), Paragraph('目录可点击；书签可定位每一道主问题。绿色框为记忆提纲，灰色备注用于备考核对。',ST['note'])]
    group = []
    section = 0
    def flush():
        if group:
            story.append(KeepTogether(group.copy()))
            if not expanded:
                story.append(Spacer(1,9))
            group.clear()
    started = False
    for raw in text.splitlines():
        s=raw.strip()
        if s.startswith('## 阅读前'): started=True
        if not started or not s: continue
        if s == '<!-- RED START -->':
            flush(); red_mode=True; continue
        if s == '<!-- RED END -->':
            flush(); red_mode=False; continue
        if s.startswith('## '):
            flush(); section+=1; story.append(CondPageBreak(doc.height-12) if expanded else PageBreak())
            p=Paragraph(formatted(s[3:]),selected('section'));p.navkey=f'section-{section}';p.navlevel=0;story.append(p)
        elif s.startswith('### Q'):
            flush();p=Paragraph(formatted(s[4:]),selected('question'));p.navkey=re.match(r'### (Q\d+)',s).group(1);p.navlevel=1;group.append(p)
        elif s.startswith('### '):
            flush();story.append(Paragraph(formatted(s[4:]),selected('sub')))
        else:
            target=group if group else story
            if s.startswith('考察点：'): key='intent'
            elif s.startswith('记忆提纲：'): key='outline'
            elif s.startswith('追问提纲：'): key='follow_outline'
            elif s.startswith('备考备注：'): key='note'
            elif re.match(r'追问\d+：',s): key='follow'
            elif s.startswith('答：'): key='answer';s=s[2:]
            elif s.startswith('主回答：'): key='body';s='口语回答：'+s[4:]
            elif s.startswith('- '): key='source';s=s[2:]
            else: key='body'
            target.append(Paragraph(formatted(s),selected(key)))
    flush()
    doc.multiBuild(story,onFirstPage=chrome,onLaterPages=chrome)
    reader=PdfReader(destination)
    pages=[p.extract_text() or '' for p in reader.pages]
    combined='\n'.join(pages)
    normalized=re.sub(r'\s+','',combined)
    assert all(re.sub(r'\s+','',f'{n}｜{title}') in normalized for n,title in qs)
    for label,count in [('记忆提纲：',question_count),('口语回答：',question_count),('追问提纲：',follow_count)]:
        assert combined.count(label)==count,(label,combined.count(label))
    assert len(re.findall(r'追问\d+：',combined))==follow_count
    assert all(len(s)>60 for s in pages)
    with pdfplumber.open(destination) as pdf:
        bounds=[(i+1,c['text']) for i,p in enumerate(pdf.pages) for c in p.chars
                if c['x0']<44 or c['x1']>p.width-44 or c['top']<18 or c['bottom']>p.height-20]
    assert not bounds, bounds[:20]
    summary={'pages':len(pages),'questions':question_count,'followups':follow_count,'comments_integrated':5,
        'text_bounds_ok':True,'question_pages':{n:next(i+1 for i,s in enumerate(pages) if f'{n}｜' in s) for n,_ in qs}}
    return summary

if __name__=='__main__':
    original, comments = extract()
    text, revisions = revise(original, comments)
    OUT.with_suffix('.md').write_text(text,encoding='utf-8')
    summary = build_pdf(text)
    summary['comments'] = comments
    summary['revised_questions'] = list(revisions)
    (HERE/'verification.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in summary.items() if k!='comments'},ensure_ascii=False,indent=2))
