from pathlib import Path
import sys, re, json

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
BASE = HERE.parent / '2026-09-12/汪非凡_AI产品经理面试_111题近期面经红字增补版.md'
OUT = HERE / '汪非凡_AI产品经理面试_111题_AI基础专业修订版'
sys.path.insert(0, str(ROOT / 'tmp/pdfs'))
from build_interview_outline_20260909 import Guide, ST, style, inline, W, H, GRAY
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, Spacer, PageBreak, KeepTogether, CondPageBreak
from reportlab.platypus.tableofcontents import TableOfContents
from pypdf import PdfReader
import pdfplumber
import pypdfium2 as pdfium


def merge():
    original = BASE.read_text(encoding='utf-8')
    replacement = (HERE / '第四部分_AI基础_专业重写.md').read_text(encoding='utf-8').strip()
    start = original.index('## 四｜')
    end = original.index('<!-- RED START -->', start)
    old_section = original[start:end]
    question_titles = r'^### Q\d+｜.+$'
    follow_titles = r'^追问\d+：.+$'
    for pattern in (question_titles, follow_titles):
        assert re.findall(pattern, old_section, re.M) == re.findall(pattern, replacement, re.M)
    merged = original[:start] + replacement + '\n\n' + original[end:]
    assert merged[:start] == original[:start]
    assert merged.endswith(original[end:])
    merged = merged.replace('批注融合与口语润色版 · 99 题基础补全版 · 2026-09-12',
        '111 题完整保留 · 第四部分 AI 基础专业修订版 · 2026-09-14', 1)
    intro = ('本轮修订（2026-09-14）：全册保留 111 道主问题及 225 道追问。仅重写第四部分 Q34—Q43 的答案与提纲，'
             '新增技术补充及来源，其他 101 道主问题及答案原文保留。此前近期面经增补的红字仍保留；第四部分本次修订使用正常深色文字。'
             'Q43 按 9 月 13 日项目 D025 更新北极星指标，其他章节历史表述如有不同，以 Q43 的最新口径为准。'
             '以下旧版说明属于历史修订记录，不代表本轮重新确认上线或业绩数据。')
    merged = merged.replace('## 阅读前｜你的批注怎样融入答案\n',
        '## 阅读前｜你的批注怎样融入答案\n\n' + intro + '\n', 1)
    OUT.with_suffix('.md').write_text(merged, encoding='utf-8')
    assert len(re.findall(question_titles, merged, re.M)) == 111
    assert len(re.findall(follow_titles, merged, re.M)) == 225
    for label, count in [('主回答：', 111), ('记忆提纲：', 111), ('追问提纲：', 225), ('答：', 225)]:
        assert len(re.findall('^' + label, merged, re.M)) == count
    return merged


def build(text):
    red = colors.HexColor('#AF241D')
    reds = {k: ParagraphStyle('red_revision_' + k, parent=v, textColor=red) for k, v in ST.items()}
    reds['outline'].backColor = colors.HexColor('#FFF2EF')
    ST['technical'] = style('technical', fontSize=9.1, leading=15, textColor=GRAY,
                            spaceBefore=3, spaceAfter=9)
    question_pages = {}

    class RevisionGuide(Guide):
        def afterFlowable(self, flowable):
            if isinstance(flowable, Paragraph) and hasattr(flowable, 'navkey'):
                if flowable.navlevel == 1:
                    question_pages[flowable.navkey] = self.page
                if flowable.navlevel == 0 and flowable.style.textColor == red:
                    key, title = flowable.navkey, flowable.getPlainText()
                    self.canv.bookmarkPage(key)
                    self.canv.addOutlineEntry(title, key, level=0, closed=True)
                    self.notify('TOCEntry', (0, '<font color="#AF241D">' + title + '</font>', self.page, key))
                    return
            super().afterFlowable(flowable)

    def chrome(canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(colors.HexColor('#D6E0E5'))
        canvas.line(20*mm, H-16*mm, W-20*mm, H-16*mm)
        canvas.setFont('CN', 8)
        canvas.setFillColor(GRAY)
        canvas.drawString(20*mm, H-12*mm, '汪非凡 / AI 产品经理面试准备')
        canvas.drawRightString(W-20*mm, H-12*mm, 'AI 基础专业修订 · 2026.09.14')
        canvas.drawString(20*mm, 12*mm, '先记提纲，再解释原理、判断依据与验证方法。')
        canvas.drawRightString(W-20*mm, 12*mm, str(doc.page))
        canvas.restoreState()

    doc = RevisionGuide(str(OUT.with_suffix('.pdf')), pagesize=(W, H),
        leftMargin=20*mm, rightMargin=20*mm, topMargin=23*mm, bottomMargin=22*mm,
        title='汪非凡 AI产品经理面试｜111题 AI基础专业修订版', author='汪非凡 · 个人备考')
    story = [Spacer(1, 25*mm), Paragraph('AI 应用产品经理<br/>面试准备', ST['cover']),
        Spacer(1, 8*mm), Paragraph('汪非凡｜AI 基础专业修订版', ST['subtitle']),
        Spacer(1, 16*mm), Paragraph('111 道主问题 · 225 道追问', ST['sub']),
        Paragraph('本次重写第四部分：10 道主问题 + 20 道追问。', ST['body']),
        Spacer(1, 12*mm), Paragraph('说清概念，讲透判断，落到验证。', ST['subtitle']),
        Paragraph('RAG / 模型选型 / Prompt / 微调 / Eval / Agent / 上下文与记忆 / 指标', ST['body']),
        Spacer(1, 10*mm), Paragraph('每题结构：记忆提纲 → 专业回答 → 技术补充 → 追问解答。', ST['body']),
        Paragraph('其他章节原文保留；此前近期面经增补仍用红字标注。', reds['body']),
        Paragraph('更新日期：2026 年 9 月 14 日｜旧版文件保留', ST['body']),
        PageBreak(), Paragraph('阅读导航', ST['section'])]
    toc = TableOfContents()
    toc.levelStyles = [style('toc_professional', fontSize=10, leading=16, spaceBefore=1, spaceAfter=2, rightIndent=20)]
    story.append(toc)
    group = []
    red_mode = False
    professional = False
    current_q = None
    section_no = 0
    started = False

    def flush():
        if group:
            # In-depth answers may continue onto another page; never shrink the type.
            story.extend(group.copy()) if professional else story.append(KeepTogether(group.copy()))
            group.clear()

    def fmt(s):
        rendered = inline(s)
        return re.sub(r'color=[\"\'][^\"\']+[\"\']', 'color="#AF241D"', rendered) if red_mode else rendered

    def selected(k):
        return reds[k] if red_mode else ST[k]

    for raw in text.splitlines():
        s = raw.strip()
        if s.startswith('## 阅读前'):
            started = True
        if not started or not s:
            continue
        if s in ('<!-- RED START -->', '<!-- RED END -->'):
            flush()
            red_mode = s == '<!-- RED START -->'
            continue
        if s.startswith('## '):
            flush()
            professional = s.startswith('## 四｜')
            current_q = None
            section_no += 1
            story.append(CondPageBreak(doc.height-12))
            p = Paragraph(fmt(s[3:]), selected('section'))
            p.navkey, p.navlevel = f'section-{section_no}', 0
            story.append(p)
        elif s.startswith('### Q'):
            flush()
            q = re.match(r'### (Q\d+)', s).group(1)
            if professional and current_q:
                story.append(PageBreak())
            current_q = q
            p = Paragraph(fmt(s[4:]), selected('question'))
            p.navkey, p.navlevel = q, 1
            group.append(p)
        elif s.startswith('### '):
            flush()
            if professional:
                story.append(PageBreak())
            story.append(Paragraph(fmt(s[4:]), selected('sub')))
        else:
            target = group if group else story
            if s.startswith('考察点：'): key = 'intent'
            elif s.startswith('记忆提纲：'): key = 'outline'
            elif s.startswith('追问提纲：'): key = 'follow_outline'
            elif s.startswith('备考备注：'): key = 'note'
            elif s.startswith('技术补充：'): key = 'technical'
            elif re.match(r'追问\d+：', s): key = 'follow'
            elif s.startswith('答：'): key = 'answer'; s = s[2:]
            elif s.startswith('主回答：'):
                key = 'body'; s = ('专业回答：' if professional else '口语回答：') + s[4:]
            elif s.startswith('- '): key = 'source'; s = s[2:]
            else: key = 'body'
            target.append(Paragraph(fmt(s), selected(key)))
    flush()
    doc.multiBuild(story, onFirstPage=chrome, onLaterPages=chrome)
    return question_pages


def verify(text, question_pages):
    reader = PdfReader(OUT.with_suffix('.pdf'))
    pages = [p.extract_text() or '' for p in reader.pages]
    combined = '\n'.join(pages)
    normalized = re.sub(r'\s+', '', combined)
    questions = re.findall(r'^### (Q\d+)｜(.+)$', text, re.M)
    assert len(question_pages) == 111
    for q, title in questions:
        assert re.sub(r'\s+', '', q + '｜' + title) in normalized, q
    for label, count in [('记忆提纲：', 111), ('口语回答：', 101), ('专业回答：', 10), ('追问提纲：', 225)]:
        assert combined.count(label) == count, (label, combined.count(label))
    assert len(re.findall(r'追问\d+：', combined)) == 225
    fonts = {}
    for p in reader.pages:
        for ref in p['/Resources']['/Font'].values():
            f = ref.get_object()
            if f.get('/FontDescriptor'):
                desc = f['/FontDescriptor'].get_object()
                fonts[str(f.get('/BaseFont'))] = any(k in desc for k in ('/FontFile', '/FontFile2', '/FontFile3'))
    assert fonts and all(fonts.values())
    pdf = pdfplumber.open(OUT.with_suffix('.pdf'))
    bounds = []
    for i, p in enumerate(pdf.pages):
        for c in p.chars:
            if c['x0'] < 44 or c['x1'] > W-44 or c['top'] < 18 or c['bottom'] > H-20:
                bounds.append((i+1, c['text']))
    assert not bounds, bounds[:20]
    for n in range(100, 112):
        q = f'Q{n}'
        chars = pdf.pages[question_pages[q]-1].chars
        red_text = ''.join(c['text'] for c in chars if isinstance(c['non_stroking_color'], (list,tuple))
                           and len(c['non_stroking_color']) == 3
                           and all(abs(a-b/255) < .001 for a,b in zip(c['non_stroking_color'], (175,36,29))))
        assert q + '｜' in red_text, q
    summary = {'pdf': str(OUT.with_suffix('.pdf')), 'pages': len(pages), 'questions': 111,
               'followups': 225, 'rewritten_questions': 10, 'rewritten_followups': 20,
               'other_question_text_preserved': True, 'red_question_titles_verified': 12,
               'fonts': fonts, 'out_of_bounds': 0, 'question_pages': question_pages,
               'page_text_lengths': [len(x) for x in pages]}
    (HERE / 'verification.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    preview_pages = sorted(set([1, 2, 3, question_pages['Q34'], question_pages['Q34']+1,
        question_pages['Q35'], question_pages['Q38'], question_pages['Q39'], question_pages['Q40'],
        question_pages['Q41'], question_pages['Q42'], question_pages['Q43'], question_pages['Q43']+1,
        question_pages['Q100']-1, question_pages['Q100']]))
    pdf.close()
    rendered = pdfium.PdfDocument(str(OUT.with_suffix('.pdf')))
    for n in preview_pages:
        rendered[n-1].render(scale=1.3).to_pil().save(str(HERE / f'preview-{n:03}.png'))
    rendered.close()
    print(json.dumps({k:v for k,v in summary.items() if k not in ('question_pages','page_text_lengths')}, ensure_ascii=False, indent=2))
    print('REVISED PAGES:', {f'Q{n}':question_pages[f'Q{n}'] for n in range(34,44)})


if __name__ == '__main__':
    content = merge()
    locations = build(content)
    verify(content, locations)
