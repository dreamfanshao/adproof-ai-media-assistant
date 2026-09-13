const fs = require('fs');
const path = require('path');
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  PageNumber,
  Footer,
  BorderStyle,
  LevelFormat,
  WidthType,
} = require('docx');

const input = process.argv[2];
const output = process.argv[3];
if (!input || !output) {
  console.error('Usage: node convert_interview_md_to_docx.js <input.md> <output.docx>');
  process.exit(2);
}

const markdown = fs.readFileSync(input, 'utf8').replace(/^\uFEFF/, '');
const lines = markdown.split(/\r?\n/);

function inlineRuns(text, base = {}) {
  const runs = [];
  // Keep links readable while avoiding a dependency on a full Markdown parser.
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]*\))/g;
  let last = 0;
  for (const match of text.matchAll(re)) {
    const i = match.index;
    if (i > last) runs.push(new TextRun({ text: text.slice(last, i), ...base }));
    const token = match[0];
    if (token.startsWith('**')) {
      runs.push(new TextRun({ text: token.slice(2, -2), bold: true, ...base }));
    } else if (token.startsWith('`')) {
      runs.push(new TextRun({ text: token.slice(1, -1), font: 'Consolas', shading: { fill: 'F2F2F2' }, ...base }));
    } else {
      runs.push(new TextRun({ text: token, ...base }));
    }
    last = i + token.length;
  }
  if (last < text.length) runs.push(new TextRun({ text: text.slice(last), ...base }));
  return runs.length ? runs : [new TextRun({ text: '', ...base })];
}

function paragraph(text, options = {}) {
  return new Paragraph({
    spacing: { after: 120, line: 276 },
    ...options,
    children: inlineRuns(text, options.run || {}),
  });
}

const children = [];
let inCode = false;
for (const raw of lines) {
  const line = raw.trimEnd();
  if (line.trim() === '```') {
    inCode = !inCode;
    continue;
  }
  if (inCode) {
    children.push(new Paragraph({
      style: 'Code',
      spacing: { after: 60 },
      children: [new TextRun({ text: line, font: 'Consolas', size: 18 })],
    }));
    continue;
  }
  if (!line.trim()) {
    children.push(new Paragraph({ spacing: { after: 70 }, children: [] }));
    continue;
  }

  const h = line.match(/^(#{1,3})\s+(.*)$/);
  if (h) {
    const level = h[1].length;
    const text = h[2].replace(/\*\*/g, '');
    const headingLevel = level === 1 ? HeadingLevel.TITLE : level === 2 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2;
    children.push(new Paragraph({
      heading: headingLevel,
      keepNext: true,
      spacing: { before: level === 1 ? 0 : level === 2 ? 260 : 180, after: level === 1 ? 260 : 120 },
      children: [new TextRun({ text, bold: true })],
    }));
    continue;
  }

  const bullet = line.match(/^\s*[-*]\s+(.*)$/);
  if (bullet) {
    children.push(new Paragraph({
      numbering: { reference: 'bullets', level: 0 },
      spacing: { after: 70, line: 260 },
      children: inlineRuns(bullet[1]),
    }));
    continue;
  }

  const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
  if (numbered) {
    children.push(new Paragraph({
      numbering: { reference: 'numbers', level: 0 },
      spacing: { after: 70, line: 260 },
      children: inlineRuns(numbered[1]),
    }));
    continue;
  }

  // Labels such as “主回答：”“追问提纲：” are visually easier to scan in bold.
  const label = line.match(/^(考察点|记忆提纲|主回答|追问提纲|答|备考备注|岗位职责|岗位要求|来源\d+|薪资参考)：(.*)$/);
  if (label) {
    children.push(new Paragraph({
      spacing: { after: 100, line: 276 },
      children: [
        new TextRun({ text: `${label[1]}：`, bold: true, color: '1F4E79' }),
        ...inlineRuns(label[2]),
      ],
    }));
  } else {
    children.push(paragraph(line));
  }
}

const doc = new Document({
  creator: '汪非凡',
  title: '汪非凡｜AI 产品经理面试｜提纲与口语回答版',
  description: 'AI 产品经理面试准备材料，可在 Word 中使用批注补充个人理解。',
  styles: {
    default: {
      document: {
        run: { font: 'Microsoft YaHei', size: 21, color: '222222' },
        paragraph: { spacing: { line: 276, after: 100 } },
      },
    },
    paragraphStyles: [
      { id: 'Code', name: 'Code', basedOn: 'Normal', run: { font: 'Consolas', size: 18 }, paragraph: { shading: { fill: 'F6F8FA' }, spacing: { after: 60 } } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 420, hanging: 220 } } } }] },
      { reference: 'numbers', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 420, hanging: 220 } } } }] },
    ],
  },
  sections: [{
    properties: {
      page: { size: { width: 11906, height: 16838 }, margin: { top: 1080, right: 1100, bottom: 1080, left: 1100 } },
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '汪非凡｜AI 产品经理面试准备  ·  ', size: 16, color: '777777' }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '777777' })] })],
      }),
    },
    children,
  }],
});

Packer.toBuffer(doc).then(buffer => {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, buffer);
  console.log(output);
});
