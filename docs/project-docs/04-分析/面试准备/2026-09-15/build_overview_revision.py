from pathlib import Path
import importlib.util, inspect, re, json

HERE = Path(__file__).resolve().parent
PRIOR = HERE.parent / '2026-09-14'
SOURCE = PRIOR / '汪非凡_AI产品经理面试_111题_AI基础专业修订版.md'
OUT = HERE / '汪非凡_AI产品经理面试_111题_AI基础要点速览版'
spec = importlib.util.spec_from_file_location('prior_builder', PRIOR / 'build_professional_revision.py')
prior = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prior)


def merge():
    text = SOURCE.read_text(encoding='utf-8')
    outlines = json.loads((HERE / '要点速览.json').read_text(encoding='utf-8'))
    original = text
    for q, points in outlines.items():
        match = re.search(r'^### ' + q + r'｜[^\n]+\n(?:(?!^### |^## ).|\n)*', text, re.M)
        assert match, q
        block = match.group(0)
        new_outline = '记忆提纲：要点速览\n\n' + '\n\n'.join(f'{i}. {p}' for i,p in enumerate(points,1))
        changed, count = re.subn(r'^记忆提纲：[^\n]+', lambda m:new_outline, block, flags=re.M)
        assert count == 1 and len(points) == 5
        assert changed[changed.index('主回答：'):] == block[block.index('主回答：'):]
        text = text[:match.start()] + changed + text[match.end():]
    a = text.index('## 四｜')
    b = text.index('<!-- RED START -->', a)
    oa, ob = original.index('## 四｜'), original.index('<!-- RED START -->', original.index('## 四｜'))
    assert text[:a] == original[:oa] and text[b:] == original[ob:]
    text = text.replace('111 题完整保留 · 第四部分 AI 基础专业修订版 · 2026-09-14',
        '111 题完整保留 · 第四部分 AI 基础要点速览版 · 2026-09-15',1)
    note = ('本轮调整（2026-09-15）：在 9 月 14 日专业修订稿基础上，仅将第四部分 Q34—Q43 的主问题记忆提纲'
            '改为“要点速览”：每题 5 条编号，先给加粗提示，再说明回答内容和判断。专业回答、技术补充与追问答案均保留；'
            '其他章节和原有红字不变。复习时先沿五条提示展开，再对照完整答案补足细节。')
    text = text.replace('## 阅读前｜你的批注怎样融入答案\n', '## 阅读前｜你的批注怎样融入答案\n\n'+note+'\n',1)
    text = text.replace('先记提纲，再练主回答；“技术补充”供深入追问时展开。',
        '2026-09-15 将记忆提纲改成编号式“要点速览”，每点补充回答提示；专业回答和追问保持不变。“技术补充”供深入追问时展开。',1)
    OUT.with_suffix('.md').write_text(text,encoding='utf-8')
    return text


def prepare_renderer():
    scope = prior.__dict__.copy()
    scope.update(HERE=HERE, OUT=OUT)
    source = inspect.getsource(prior.build)
    def swap(old,new):
        nonlocal source
        assert old in source, old
        source = source.replace(old,new)
    swap("    question_pages = {}", """    ST['overview_heading'] = style('overview_heading', fontName='CN-Bold', fontSize=12,
        leading=20, textColor=colors.black, spaceBefore=5, spaceAfter=9, keepWithNext=True)
    ST['overview_item'] = style('overview_item', fontSize=9.6, leading=16,
        textColor=colors.black, leftIndent=15, firstLineIndent=-15, spaceAfter=6)
    question_pages = {}""")
    swap("        rendered = inline(s)", r"""        if professional:
            parts = re.split(r'(\*\*.*?\*\*)', s)
            rendered = ''.join('<b>'+inline(p[2:-2])+'</b>' if p.startswith('**') and p.endswith('**')
                               else inline(p) for p in parts)
        else:
            rendered = inline(s)""")
    swap("            elif s.startswith('记忆提纲：'): key = 'outline'", """            elif s.startswith('记忆提纲：'):
                if professional: key = 'overview_heading'; s = '要点速览'
                else: key = 'outline'
            elif professional and re.match(r'^\\d+\\. ',s): key = 'overview_item'""")
    swap("            target.append(Paragraph(fmt(s), selected(key)))", """            if professional and key == 'technical' and current_q in ('Q34', 'Q40', 'Q43'):
                target.append(PageBreak())
                target.append(Paragraph(current_q + '｜技术补充与追问（续）', ST['sub']))
            target.append(Paragraph(fmt(s), selected(key)))""")
    swap('AI 基础专业修订 · 2026.09.14', 'AI 基础要点速览 · 2026.09.15')
    swap('111题 AI基础专业修订版', '111题 AI基础要点速览版')
    swap('汪非凡｜AI 基础专业修订版', '汪非凡｜AI 基础要点速览版')
    swap('本次重写第四部分：10 道主问题 + 20 道追问。', '本次优化第四部分：10 题 × 5 点，说明每点怎么答。')
    swap('每题结构：记忆提纲 → 专业回答 → 技术补充 → 追问解答。', '第四部分：要点速览 → 专业回答 → 技术补充 → 追问解答。')
    swap('更新日期：2026 年 9 月 14 日｜旧版文件保留', '更新日期：2026 年 9 月 15 日｜旧版文件保留')
    exec(compile(source, str(HERE/'build_overview_revision.py')+'::renderer','exec'),scope)
    verification = inspect.getsource(prior.verify)
    verification = verification.replace("('记忆提纲：', 111)","('记忆提纲：', 101), ('要点速览', 10)")
    # The cover/footer also mention the edition name; check the section headings separately.
    verification = verification.replace("('要点速览', 10)","('要点速览\\n', 10)")
    verification = verification.replace("'rewritten_questions': 10, 'rewritten_followups': 20", "'updated_main_outlines': 10, 'overview_points': 50, 'answers_unchanged': True")
    verification = verification.replace('    for n in preview_pages:',
        "    preview_pages = sorted(set(preview_pages + list(range(question_pages['Q34'],question_pages['Q100']+1))))\n    for n in preview_pages:")
    exec(compile(verification,str(HERE/'build_overview_revision.py')+'::verify','exec'),scope)
    return scope


if __name__ == '__main__':
    content = merge()
    scope = prepare_renderer()
    locations = scope['build'](content)
    scope['verify'](content,locations)
