// lib/ads/lint.ts — 소재(TEXT_45 제목·설명)·키워드 등록기준 린터. 순수 함수(I/O 없음). 규칙·한도·사전은 lint-rules.ts 데이터만 읽는다.
// - lintCreative({headline, description}): 소재 1건. 입력 검사 → 필수 → 글자 수(NFC 코드포인트) → 문자 종류 → 최상급·보장 표현.
// - lintCreativeGroup(creatives[]): 같은 광고그룹의 소재 목록. 각 소재의 lintCreative 결과에 중복(3822)을 더해 같은 순서로 돌려준다.
//   중복은 NFC·trim·연속 공백 1칸·소문자로 접은 (제목, 설명) 쌍이 앞 소재와 같을 때, 뒤에 나온 소재에 붙인다.
// - lintKeyword(keyword): Task 6과 같은 정규화·허용 문자(keyword-text.ts 단일 출처)로 3906 대상을 거른다.
// 메시지는 사용자에게 보이는 한국어다. 제어·보이지 않는 문자는 원문 대신 U+XXXX로만 표기한다.
import { collapseKeyword, isValidKeywordPhrase } from "./keyword-text";
import {
  ALLOWED_COPY_CHAR, EMOJI_CHAR, FORBIDDEN_KEYWORDS, isControlChar, MATCH_SEPARATOR_KEEP_BETWEEN_DIGITS, MATCH_SEPARATORS, isZeroWidthChar, LINT_RULES, SUPERLATIVE_EXCEPTIONS, SUPERLATIVE_TERMS, type LintRule,
} from "./lint-rules";

export type LintField = "headline" | "description" | "keyword";
export type LintIssue = { rule: string; field: LintField; message: string };
export type CreativeInput = { headline: unknown; description: unknown };
type CopyField = "headline" | "description";

const SUBJECT: Record<LintField, string> = { headline: "제목이", description: "설명이", keyword: "키워드가" };
const TOPIC: Record<LintField, string> = { headline: "제목은", description: "설명은", keyword: "키워드는" };
const AT: Record<LintField, string> = { headline: "제목에", description: "설명에", keyword: "키워드에" };
const LENGTH_RULE: Record<CopyField, LintRule & { limit: number }> = {
  headline: LINT_RULES.headlineLength, description: LINT_RULES.descriptionLength,
};
const MAX_LISTED = 5;
const VARIATION_SELECTOR = /^[\uFE0E\uFE0F]$/;
const PRINTABLE = /^[\p{L}\p{N}\p{P}\p{S}]$/u;
const FULLWIDTH_START = 0xff01, FULLWIDTH_END = 0xff5e, FULLWIDTH_OFFSET = 0xfee0;

const issue = (rule: LintRule, field: LintField, message: string): LintIssue => ({ rule: rule.id, field, message });
const codeLabel = (ch: string) => `U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`;
const isInvisible = (ch: string) => isControlChar(ch) || isZeroWidthChar(ch);

/** 문자열이 아니거나 비정상적으로 길면 위반 1건, 아니면 NFC 문자열. */
function readText(value: unknown, field: LintField): { text: string } | { issue: LintIssue } {
  if (typeof value !== "string") return { issue: issue(LINT_RULES.inputType, field, `${SUBJECT[field]} 문자열이 아닙니다.`) };
  const max = LINT_RULES.inputTooLong.limit;
  if (value.length > max) return { issue: issue(LINT_RULES.inputTooLong, field, `${SUBJECT[field]} 너무 깁니다(최대 ${max}자).`) };
  return { text: value.normalize("NFC") };
}

/** 제어문자·보이지 않는 문자·이모지·허용 목록 밖 문자. 규칙마다 1건, 문자 목록은 최대 5개. */
function charIssues(text: string, field: CopyField): LintIssue[] {
  const control = new Set<string>(), zeroWidth = new Set<string>(), forbidden = new Set<string>();
  let emoji = false, prevEmoji = false;
  for (const ch of text) {
    const isEmoji = EMOJI_CHAR.test(ch);
    if (isControlChar(ch)) control.add(codeLabel(ch));
    else if (prevEmoji && VARIATION_SELECTOR.test(ch)) { /* 이모지 표시 선택자는 이모지의 일부 */ }
    else if (isZeroWidthChar(ch)) zeroWidth.add(codeLabel(ch));
    else if (isEmoji) emoji = true;
    else if (!ALLOWED_COPY_CHAR.test(ch)) forbidden.add(PRINTABLE.test(ch) ? ch : codeLabel(ch));
    prevEmoji = isEmoji;
  }
  const list = (set: Set<string>) => [...set].slice(0, MAX_LISTED).join(", ");
  const out: LintIssue[] = [];
  if (control.size) out.push(issue(LINT_RULES.controlChar, field, `${AT[field]} 제어문자(줄바꿈·탭 등)가 있습니다: ${list(control)}`));
  if (zeroWidth.size) out.push(issue(LINT_RULES.zeroWidthChar, field, `${AT[field]} 보이지 않는 문자가 있습니다: ${list(zeroWidth)}`));
  if (emoji) out.push(issue(LINT_RULES.emoji, field, `${AT[field]} 이모지·그림문자는 쓸 수 없습니다.`));
  if (forbidden.size) out.push(issue(LINT_RULES.forbiddenChar, field, `${AT[field]} 쓸 수 없는 특수문자가 있습니다: ${list(forbidden)}`));
  return out;
}

/** 전각 ASCII(U+FF01–FF5E) 한 글자 → 반각. 그 밖은 그대로. */
function toHalfWidth(ch: string): string {
  const cp = ch.codePointAt(0) ?? 0;
  return cp >= FULLWIDTH_START && cp <= FULLWIDTH_END ? String.fromCodePoint(cp - FULLWIDTH_OFFSET) : ch;
}

const SYLLABLE_OR_DIGIT = /^[가-힣0-9]$/;
const DIGIT = /^[0-9]$/;
type Cell = { ch: string; start: number; end: number };

/** 음절·숫자 사이의 구분 부호 묶음을 지운다(규칙은 lint-rules.ts MATCH_SEPARATORS 주석). */
function dropSeparators(cells: Cell[]): Cell[] {
  const out: Cell[] = [];
  for (let i = 0; i < cells.length; ) {
    if (!MATCH_SEPARATORS.has(cells[i].ch)) { out.push(cells[i++]); continue; }
    let j = i;
    while (j < cells.length && MATCH_SEPARATORS.has(cells[j].ch)) j++;
    const before = cells[i - 1]?.ch ?? "", after = cells[j]?.ch ?? "";
    const run = cells.slice(i, j);
    const numberFormat = DIGIT.test(before) && DIGIT.test(after) && run.length === 1 && MATCH_SEPARATOR_KEEP_BETWEEN_DIGITS.has(run[0].ch);
    if (!(SYLLABLE_OR_DIGIT.test(before) && SYLLABLE_OR_DIGIT.test(after)) || numberFormat) out.push(...run);
    i = j;
  }
  return out;
}

/** 매칭용 정규화: 전각 ASCII→반각, 공백·제어·보이지 않는 문자 제거, 소문자, 음절·숫자 사이 구분 부호 제거.
 *  정규화된 각 코드단위의 원문 [시작, 끝)을 함께 남긴다. */
function matchForm(text: string): { norm: string; spans: [number, number][] } {
  const cells: Cell[] = [];
  let index = 0;
  for (const ch of text) {
    const start = index;
    index += ch.length;
    if (/^\s$/u.test(ch) || isInvisible(ch)) continue;
    for (const unit of toHalfWidth(ch).toLowerCase()) cells.push({ ch: unit, start, end: index });
  }
  let norm = "";
  const spans: [number, number][] = [];
  for (const cell of dropSeparators(cells)) {
    norm += cell.ch;
    for (let k = 0; k < cell.ch.length; k++) spans.push([cell.start, cell.end]);
  }
  return { norm, spans };
}

/** 원문 인용: 정규화 매치 범위를 원문으로 되돌리고 보이지 않는 문자를 뺀다. */
function quote(text: string, spans: [number, number][], from: number, to: number): string {
  return Array.from(text.slice(spans[from][0], spans[to - 1][1])).filter((ch) => !isInvisible(ch)).join("");
}

function superlativeIssues(text: string, field: CopyField): LintIssue[] {
  const { norm, spans } = matchForm(text);
  const exempt: [number, number][] = [];
  // 예외는 원문에서도 붙어 있을 때만(정규화로 지운 공백·부호·보이지 않는 문자가 사이에 끼면 우회로 보고 예외 아님)
  const contiguous = (from: number, to: number) => spans.slice(from, to - 1).every(([s, e], k) => spans[from + k + 1][0] === e || spans[from + k + 1][0] === s);
  for (const { pattern } of SUPERLATIVE_EXCEPTIONS) for (const m of norm.matchAll(pattern)) {
    if (contiguous(m.index, m.index + m[0].length)) exempt.push([m.index, m.index + m[0].length]);
  }
  const out: LintIssue[] = [];
  for (const { pattern } of SUPERLATIVE_TERMS) {
    for (const m of norm.matchAll(pattern)) {
      const from = m.index, to = m.index + m[0].length;
      if (exempt.some(([s, e]) => from < e && s < to)) continue;
      out.push(issue(LINT_RULES.superlative, field,
        `${AT[field]} 최상급·보장 표현 '${quote(text, spans, from, to)}'이(가) 있습니다. 객관적 근거 없이 쓸 수 없습니다.`));
      break; // 같은 용어는 1건만
    }
  }
  return out;
}

function lintCopyField(value: unknown, field: CopyField): LintIssue[] {
  const read = readText(value, field);
  if ("issue" in read) return [read.issue];
  const { text } = read;
  if (!text.trim()) return [issue(LINT_RULES.required, field, `${SUBJECT[field]} 비어 있습니다.`)];
  const out: LintIssue[] = [];
  const rule = LENGTH_RULE[field];
  const length = Array.from(text).length;
  if (length > rule.limit) out.push(issue(rule, field, `${TOPIC[field]} ${rule.limit}자 이하여야 합니다(현재 ${length}자).`));
  return [...out, ...charIssues(text, field), ...superlativeIssues(text, field)];
}

export function lintCreative(creative: CreativeInput): LintIssue[] {
  const c: Partial<CreativeInput> = typeof creative === "object" && creative !== null ? creative : {};
  return [...lintCopyField(c.headline, "headline"), ...lintCopyField(c.description, "description")];
}

const fold = (text: string) => text.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
const maxInput = LINT_RULES.inputTooLong.limit;
function duplicateKey(creative: unknown): string | null {
  if (typeof creative !== "object" || creative === null) return null;
  const { headline, description } = creative as Partial<CreativeInput>;
  if (typeof headline !== "string" || typeof description !== "string") return null;
  if (headline.length > maxInput || description.length > maxInput) return null;
  return `${fold(headline)}\u0000${fold(description)}`;
}

/** 같은 광고그룹 소재 목록 린트. 결과는 입력과 같은 순서·길이의 위반 목록 배열. 중복은 뒤에 나온 소재에 붙는다(앞 소재 번호는 1부터). */
export function lintCreativeGroup(creatives: readonly CreativeInput[]): LintIssue[][] {
  if (!Array.isArray(creatives)) return [[issue(LINT_RULES.inputType, "headline", "소재 목록이 배열이 아닙니다.")]];
  const firstSeen = new Map<string, number>();
  return creatives.map((creative, i) => {
    const issues = lintCreative(creative);
    const key = duplicateKey(creative);
    if (key === null) return issues;
    const first = firstSeen.get(key);
    if (first === undefined) firstSeen.set(key, i);
    else issues.push(issue(LINT_RULES.duplicateCreative, "headline", `같은 광고그룹의 ${first + 1}번째 소재와 제목·설명이 같습니다(네이버 3822).`));
    return issues;
  });
}

const FORBIDDEN_SET = new Set(FORBIDDEN_KEYWORDS);
const FORBIDDEN_MAX_LENGTH = Math.max(0, ...FORBIDDEN_KEYWORDS.map((t) => t.length));

/** 토큰 경계에 맞는 연속 토큰을 공백 없이 이어 붙인 값 중 사전어와 같은 첫 항목(없으면 null). */
function forbiddenTerm(collapsed: string): string | null {
  const tokens = Array.from(collapsed, toHalfWidth).join("").toLowerCase().split(" ");
  for (let i = 0; i < tokens.length; i++) {
    let joined = "";
    for (let j = i; j < tokens.length && joined.length < FORBIDDEN_MAX_LENGTH; j++) {
      joined += tokens[j];
      if (FORBIDDEN_SET.has(joined)) return joined;
    }
  }
  return null;
}

export function lintKeyword(keyword: unknown): LintIssue[] {
  const read = readText(keyword, "keyword");
  if ("issue" in read) return [read.issue];
  const text = collapseKeyword(read.text);
  if (!text) return [issue(LINT_RULES.keywordEmpty, "keyword", "키워드가 비어 있습니다.")];
  const out: LintIssue[] = [];
  if (!isValidKeywordPhrase(text)) {
    out.push(issue(LINT_RULES.keywordSpecialChar, "keyword",
      "키워드에는 한글·영문·숫자와 단어 사이 공백만 쓸 수 있습니다. 특수문자·이모지·보이지 않는 문자를 빼 주세요(네이버 3906)."));
  }
  const term = forbiddenTerm(text);
  if (term) out.push(issue(LINT_RULES.forbiddenKeyword, "keyword", `노출이 제한될 수 있는 키워드 '${term}'이(가) 들어 있습니다(네이버 3909).`));
  const limit = LINT_RULES.keywordLength.limit;
  const length = text.replace(/ /g, "").length; // Task 6 씨앗 상한과 같은 기준(공백 제외)
  if (length > limit) out.push(issue(LINT_RULES.keywordLength, "keyword", `키워드는 공백 제외 ${limit}자 이하여야 합니다(현재 ${length}자).`));
  return out;
}
