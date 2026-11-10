/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test helper. */
/* global require, module */
// 봉인 경계 검사기: 원시 encryptSecret(앵커 판정 없는 암호화)에 닿는 파일을 찾는다.
// - 모든 모듈 지정자는 실제 파일 경로로 해석한다(ts.resolveModuleName + tsconfig paths, 상대경로·.js 확장자·디렉터리 index 포함).
// - "노출 모듈" = lib/crypto/credentials.ts + (그것을 통째로·encryptSecret을 이름(별칭)으로 re-export 하는 모듈) — 고정점까지 따라가며
//   모듈별로 encryptSecret에 닿는 export 이름(별칭·`export * as` 이름 포함)을 추적한다(배럴 소비자도 잡는다).
// - 위반: 허용 파일(seal.ts) 밖에서
//   · 노출 모듈에서 encryptSecret을 import(별칭 포함)·re-export
//   · 노출 모듈을 통째로 re-export(`export *`, `export * as x`)
//   · 노출 모듈을 namespace/default import(`import * as c`) — 모듈 전체 객체를 쥐면 encryptSecret을 꺼낼 수 있다
//   · import()/require()로 모듈 전체를 받기(구조분해로 encryptSecret 외 이름만 꺼내는 것은 허용)
//   · TS import-equals(`import c = require(...)`, `export import c = require(...)`) — 모듈 전체를 쥔다
// - 이 검사기는 encryptSecret이라는 '이름'을 추적한다. 다른 이름으로의 재노출(seal.ts가 별칭 export, credentials.ts에 원시 암호화 함수 추가)은
//   valueExportNames 스냅샷 테스트(boundaries.test.cjs)가 막는다 — 두 파일의 값 export 목록이 검토된 집합과 정확히 같아야 한다.
// - 허용: 다른 이름(decryptSecret·credentialKeyId·CredentialCryptoError·maskSecret)의 named import, type-only import.
// - 위협 모델 밖(의도적 미탐): 계산된 문자열 속성 접근(`c[\`encrypt${'Secret'}\`]`)은 애초에 namespace import가 금지라 경로가 없고,
//   eval·런타임 문자열 require 같은 난독화도 다루지 않는다(코드 리뷰 영역).
const ts = require('typescript');
const NAME = 'encryptSecret';

const hasExport = n => ts.canHaveModifiers(n) && !!ts.getModifiers(n)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
// TS `import x = require('...')` (ImportEqualsDeclaration + ExternalModuleReference)
const isImportEqualsRequire = n => ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)
  && ts.isStringLiteralLike(n.moduleReference.expression);

/** 모듈의 '값' export 이름(정렬). type-only(interface·type·`export type`)는 제외. `export *`는 '*:<지정자>'로 남겨 스냅샷이 반드시 달라지게 한다. */
function valueExportNames(text) {
  const source = ts.createSourceFile('m.ts', text, ts.ScriptTarget.Latest, true);
  const out = new Set();
  const bindingNames = (name) => ts.isIdentifier(name) ? [name.text] : name.elements.flatMap(e => ts.isOmittedExpression(e) ? [] : bindingNames(e.name));
  for (const s of source.statements) {
    if (ts.isExportDeclaration(s)) {
      if (s.isTypeOnly) continue;
      if (!s.exportClause) out.add(`*:${s.moduleSpecifier?.getText() ?? ''}`);
      else if (ts.isNamespaceExport(s.exportClause)) out.add(s.exportClause.name.text);
      else for (const e of s.exportClause.elements) if (!e.isTypeOnly) out.add(e.name.text);
      continue;
    }
    if (ts.isExportAssignment(s)) { out.add('default'); continue; }
    if (!hasExport(s)) continue;
    const isDefault = ts.getModifiers(s)?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword);
    if (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)) continue;
    if (ts.isImportEqualsDeclaration(s)) { if (!s.isTypeOnly) out.add(s.name.text); continue; }
    if (ts.isVariableStatement(s)) { for (const d of s.declarationList.declarations) bindingNames(d.name).forEach(n => out.add(n)); continue; }
    if (isDefault) { out.add('default'); continue; }
    if (s.name && ts.isIdentifier(s.name)) out.add(s.name.text); else out.add('?unknown');
  }
  return [...out].sort();
}

/** files: 검사할 파일 경로 목록, host: { fileExists, readFile }, options: CompilerOptions, target: credentials.ts 절대경로, allowed: 허용 파일 절대경로 Set */
function sealBoundaryViolations({ files, host, options, target, allowed }) {
  const sources = new Map();
  for (const file of files) {
    const text = host.readFile(file);
    if (text == null) continue;
    sources.set(file, ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /x$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS));
  }
  const resolve = (spec, from) => ts.resolveModuleName(spec, from, options, host).resolvedModule?.resolvedFileName;
  // 파일별 모듈 참조 수집
  const refs = new Map();
  for (const [file, source] of sources) {
    const list = [];
    (function visit(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
        list.push({ node, to: resolve(node.moduleSpecifier.text, file) });
      } else if (isImportEqualsRequire(node)) {
        list.push({ node, to: resolve(node.moduleReference.expression.text, file) });
      } else if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])
        && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
        list.push({ node, to: resolve(node.arguments[0].text, file) });
      }
      ts.forEachChild(node, visit);
    })(source);
    refs.set(file, list);
  }
  const reexportsWhole = n => ts.isExportDeclaration(n) && !n.isTypeOnly && (!n.exportClause || ts.isNamespaceExport(n.exportClause));
  // 노출 모듈 → 그 모듈에서 encryptSecret(또는 모듈 전체)에 닿는 export 이름들. 배럴 체인을 고정점까지 따라간다(별칭 포함).
  const exposed = new Map([[target, new Set([NAME])]]);
  const dangerous = (n, names) => {
    if (isImportEqualsRequire(n)) return !n.isTypeOnly && hasExport(n) ? [n.name.text] : []; // export import x = require(...) → x가 모듈 전체
    if (!ts.isExportDeclaration(n) || n.isTypeOnly) return [];
    if (!n.exportClause) return [...names];                                  // export * from → 같은 이름 그대로
    if (ts.isNamespaceExport(n.exportClause)) return [n.exportClause.name.text]; // export * as raw → raw 자체가 모듈 전체
    return n.exportClause.elements.filter(e => !e.isTypeOnly && names.has((e.propertyName ?? e.name).text)).map(e => e.name.text);
  };
  for (let changed = true; changed;) {
    changed = false;
    for (const [file, list] of refs) {
      if (file === target) continue;
      for (const r of list) {
        const names = exposed.get(r.to);
        if (!names) continue;
        const add = dangerous(r.node, names);
        if (!add.length) continue;
        const mine = exposed.get(file) ?? new Set();
        for (const a of add) if (!mine.has(a)) { mine.add(a); changed = true; }
        exposed.set(file, mine);
      }
    }
  }
  const out = [];
  for (const [file, list] of refs) {
    if (file === target || allowed.has(file)) continue;
    for (const { node, to } of list) {
      const names = exposed.get(to);
      if (!names) continue;
      const hit = text => names.has(text);
      let why = null;
      if (isImportEqualsRequire(node)) {
        if (!node.isTypeOnly) why = 'import_equals'; // import x = require(...) — 모듈 전체 객체를 쥔다(namespace import와 같다)
      } else if (ts.isImportDeclaration(node)) {
        const clause = node.importClause;
        if (!clause || clause.isTypeOnly) continue;
        if (clause.name) why = 'default_import';
        const b = clause.namedBindings;
        if (b && ts.isNamespaceImport(b)) why = 'namespace_import';
        if (b && ts.isNamedImports(b) && b.elements.some(e => !e.isTypeOnly && hit((e.propertyName ?? e.name).text))) why = 'named_import';
      } else if (ts.isExportDeclaration(node)) {
        if (reexportsWhole(node)) why = 'reexport_whole';
        else if (dangerous(node, names).length) why = 'reexport_named';
      } else {
        // import()/require(): 구조분해로 encryptSecret 이외 이름만 받으면 허용, 그 외(모듈 전체 보관)는 위반
        let p = node.parent;
        while (p && (ts.isAwaitExpression(p) || ts.isParenthesizedExpression(p))) p = p.parent;
        const pattern = p && ts.isVariableDeclaration(p) && ts.isObjectBindingPattern(p.name) ? p.name : null;
        if (!pattern) why = 'dynamic_whole';
        else if (pattern.elements.some(e => e.dotDotDotToken || [...names].some(n => new RegExp(`\\b${n}\\b`).test((e.propertyName ?? e.name).getText())))) why = 'dynamic_named';
      }
      if (why) out.push({ file, why });
    }
  }
  return out;
}

module.exports = { sealBoundaryViolations, valueExportNames };
