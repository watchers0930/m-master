// 화면 글자 최소 크기 가드 — 대장 지시(2026-11-10): 11px 미만 글자 금지(12px로 통일).
// app/·components/ 아래 인라인 fontSize·CSS font-size·Tailwind text-[Npx]·SVG fontSize={N}을 전부 검사한다.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..', '..');
const ROOTS = ['app', 'components'].map((d) => path.join(REPO, d));
const MIN = 11;
const PATTERNS = [
  /fontSize:\s*['"]?(\d+(?:\.\d+)?)(?:px)?['"]?(?=\s*[,}\s])/g,
  /font-size:\s*(\d+(?:\.\d+)?)px/g,
  /text-\[(\d+(?:\.\d+)?)px\]/g,
  /fontSize=\{(\d+(?:\.\d+)?)\}/g,
];
const SKIP_DIRS = new Set(['__tests__', 'node_modules']);

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p, out); }
    else if (/\.(tsx|ts|css)$/.test(e.name)) out.push(p);
  }
  return out;
}

function violations(text) {
  const found = [];
  for (const rx of PATTERNS) for (const m of text.matchAll(rx)) if (Number(m[1]) < MIN) found.push(m[0]);
  return found;
}

test('detector catches every small-font form', () => {
  assert.strictEqual(violations("fontSize: 10, a fontSize: '9px' } font-size: 10.5px text-[10px] fontSize={9}").length, 5);
  assert.deepStrictEqual(violations('fontSize: 11, font-size: 12px text-[12px] fontSize={12}'), []);
});

test('no font size under 11px in app/ and components/', () => {
  const bad = [];
  for (const f of ROOTS.flatMap((r) => walk(r, []))) {
    for (const v of violations(fs.readFileSync(f, 'utf8'))) bad.push(`${path.relative(REPO, f)}: ${v}`);
  }
  assert.deepStrictEqual(bad, []);
});
