// scripts/db/split-sql.mjs — SQL 파일을 문 단위로 분리(Prisma $executeRawUnsafe 는 한 번에 한 문).
// 경계(;)로 보지 않는 곳: $tag$ … $tag$ 달러 인용(태그에 숫자 허용), '…' 문자열('' 이스케이프), "…" 식별자,
// -- 줄 주석, /* … */ 블록 주석(중첩 허용 — PostgreSQL 규칙).
export function splitSqlStatements(sql) {
  const out = []; let cur = ''; let i = 0;
  const push = () => { if (cur.trim()) out.push(cur.trim()); cur = ''; };
  while (i < sql.length) {
    const ch = sql[i], next = sql[i + 1];
    if (ch === '-' && next === '-') { const end = sql.indexOf('\n', i); i = end < 0 ? sql.length : end + 1; cur += '\n'; continue; }
    if (ch === '/' && next === '*') {
      let depth = 0;
      while (i < sql.length) {
        if (sql[i] === '/' && sql[i + 1] === '*') { depth++; i += 2; continue; }
        if (sql[i] === '*' && sql[i + 1] === '/') { depth--; i += 2; if (!depth) break; continue; }
        i++;
      }
      cur += ' '; continue;
    }
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < sql.length) { if (sql[j] === ch) { if (sql[j + 1] === ch) { j += 2; continue; } break; } j++; }
      cur += sql.slice(i, j + 1); i = j + 1; continue;
    }
    const tag = ch === '$' ? sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0] : undefined;
    if (tag) {
      const end = sql.indexOf(tag, i + tag.length);
      const stop = end < 0 ? sql.length : end + tag.length;
      cur += sql.slice(i, stop); i = stop; continue;
    }
    if (ch === ';') { push(); i++; continue; }
    cur += ch; i++;
  }
  push();
  return out;
}
