// scripts/db/split-sql.mjs — SQL 파일을 문 단위로 분리(Prisma $executeRawUnsafe 는 한 번에 한 문).
// $$ … $$ 달러 인용 블록, '…' 문자열, -- 주석 안의 ; 는 경계로 보지 않는다.
export function splitSqlStatements(sql) {
  const out = []; let cur = ''; let i = 0; let dollar = null; let quote = false;
  while (i < sql.length) {
    const ch = sql[i];
    if (!dollar && !quote && ch === '-' && sql[i + 1] === '-') { const end = sql.indexOf('\n', i); i = end < 0 ? sql.length : end + 1; cur += '\n'; continue; }
    if (!quote) {
      const tag = sql.slice(i).match(/^\$[A-Za-z_]*\$/)?.[0];
      if (tag && (dollar === null || dollar === tag)) { dollar = dollar === null ? tag : null; cur += tag; i += tag.length; continue; }
    }
    if (!dollar && ch === "'") quote = !quote;
    if (!dollar && !quote && ch === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; i++; continue; }
    cur += ch; i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
