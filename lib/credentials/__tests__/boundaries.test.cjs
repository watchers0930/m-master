/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, __dirname */
// 봉인 경계: encryptSecret(앵커 판정 없는 원시 암호화)은 lib/credentials/seal.ts만 가져다 쓴다.
// 다른 모든 쓰기(store·backfill·이후 광고 API 키 저장 등)는 sealForStorage(앵커 판정 + 암호화)를 거쳐야 한다.
// 판정은 TypeScript AST: 이 모듈을 import·re-export·import()·require 하는 파일에서 encryptSecret 식별자/문자열 또는 export * 가 나오면 위반.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const root = path.resolve(__dirname, '../../..');
const CRYPTO_MODULE = /(^|\/)crypto\/credentials(\.ts)?$/;
const SEAL = 'lib/credentials/seal.ts';
const DEFINER = 'lib/crypto/credentials.ts';

function files(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory()
    ? (e.name === '__tests__' || e.name === 'node_modules' ? [] : files(path.join(dir, e.name)))
    : /\.[cm]?[jt]sx?$/.test(e.name) && !e.name.endsWith('.d.ts') && !/\.test\.[cm]?js$/.test(e.name) ? [path.join(dir, e.name)] : []);
}

/** 이 소스가 원시 encryptSecret에 닿는지 */
function reachesEncrypt(source) {
  let importsCrypto = false, star = false, named = false;
  const isCrypto = node => node && ts.isStringLiteralLike(node) && CRYPTO_MODULE.test(node.text);
  (function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && isCrypto(node.moduleSpecifier)) {
      importsCrypto = true;
      if (ts.isExportDeclaration(node) && !node.exportClause) star = true;
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require')) && isCrypto(node.arguments[0])) importsCrypto = true;
    if ((ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && node.text === 'encryptSecret') named = true;
    ts.forEachChild(node, visit);
  })(source);
  return importsCrypto && (named || star);
}

test('only the sealing module touches raw encryptSecret (TypeScript AST)', () => {
  const paths = ['lib', 'app', 'actions', 'scripts', 'components', 'hooks'].flatMap(d => files(path.join(root, d)));
  const offenders = [];
  let sealHit = false;
  for (const file of paths) {
    const rel = path.relative(root, file);
    if (rel === DEFINER) continue;
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    if (!reachesEncrypt(source)) continue;
    if (rel === SEAL) sealHit = true; else offenders.push(rel);
  }
  assert.deepEqual(offenders, [], 'encryptSecret 직접 사용 금지 — sealForStorage(lib/credentials/seal.ts)를 쓰세요');
  assert.equal(sealHit, true, 'positive control: seal.ts가 감지돼야 한다');
});

test('boundary detector catches aliases, namespaces, re-exports, dynamic import and require', () => {
  const bad = [
    "import { encryptSecret } from '@/lib/crypto/credentials'",
    "import { encryptSecret as e } from '../crypto/credentials'",
    "import * as c from '@/lib/crypto/credentials'; c.encryptSecret('a','b')",
    "import * as c from '@/lib/crypto/credentials'; c['encryptSecret']('a','b')",
    "export { encryptSecret } from '@/lib/crypto/credentials'",
    "export * from '@/lib/crypto/credentials'",
    "const { encryptSecret } = await import('@/lib/crypto/credentials')",
    "const m = require('../../crypto/credentials.ts'); m.encryptSecret('a','b')",
  ];
  for (const code of bad) assert.ok(reachesEncrypt(ts.createSourceFile('f.ts', code, ts.ScriptTarget.Latest, true)), code);
  const fine = [
    "import { decryptSecret, CredentialCryptoError } from '@/lib/crypto/credentials'",
    "import { sealForStorage } from '@/lib/credentials/seal'",
  ];
  for (const code of fine) assert.equal(reachesEncrypt(ts.createSourceFile('f.ts', code, ts.ScriptTarget.Latest, true)), false, code);
});

test('store does not export a raw sealing helper', () => {
  const source = ts.createSourceFile('store.ts', fs.readFileSync(path.join(root, 'lib/credentials/store.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
  const exported = [];
  for (const s of source.statements) {
    const exp = ts.canHaveModifiers(s) && ts.getModifiers(s)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
    if (exp && ts.isFunctionDeclaration(s) && s.name) exported.push(s.name.text);
  }
  assert.ok(!exported.includes('sealValue'), 'sealValue는 비공개(또는 제거)');
});
