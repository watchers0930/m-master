/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, __dirname */
// 봉인 경계: 원시 encryptSecret(앵커 판정 없음)은 lib/credentials/seal.ts만 쓴다. 다른 모든 저장 경로는 sealForStorage를 거친다.
// 검사기(seal-boundary-guard.cjs)는 모듈 지정자를 실제 파일로 해석하고 배럴 re-export를 따라간다.
// 대상: 저장소 전체의 비테스트 .ts/.tsx/.mts/.cts/.js/.mjs/.cjs (node_modules·.next·.git·__tests__·tests·*.test.* 제외).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const { sealBoundaryViolations, valueExportNames } = require('./seal-boundary-guard.cjs');
const root = path.resolve(__dirname, '../../..');
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', '__tests__', 'tests', '.superpowers', '.worktrees', '.vercel', 'coverage', 'public']);
const EXT = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = path.join(dir, e.name);
    if (e.isSymbolicLink()) return [];
    if (e.isDirectory()) return SKIP_DIRS.has(e.name) ? [] : walk(full);
    return EXT.test(e.name) && !e.name.endsWith('.d.ts') && !/\.test\.[cm]?[jt]sx?$/.test(e.name) ? [full] : [];
  });
}
const parsed = ts.parseJsonConfigFileContent(ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile).config, ts.sys, root);

test('only the sealing module reaches raw encryptSecret (resolved modules, whole repository)', () => {
  const files = walk(root);
  assert.ok(files.includes(path.join(root, 'middleware.ts')), '루트 파일도 검사 대상');
  assert.ok(files.some(f => f.startsWith(path.join(root, 'scripts') + path.sep)), 'scripts도 검사 대상');
  const target = path.join(root, 'lib/crypto/credentials.ts'), seal = path.join(root, 'lib/credentials/seal.ts');
  const args = { files, host: ts.sys, options: parsed.options, target };
  assert.deepEqual(sealBoundaryViolations({ ...args, allowed: new Set([seal]) }).map(v => path.relative(root, v.file)), [],
    'encryptSecret 직접 사용 금지 — sealForStorage(lib/credentials/seal.ts)를 쓰세요');
  // positive control: 허용 목록을 비우면 seal.ts가 정확히 잡힌다(해석이 실제로 동작함)
  assert.deepEqual(sealBoundaryViolations({ ...args, allowed: new Set() }).map(v => [path.relative(root, v.file), v.why]), [['lib/credentials/seal.ts', 'named_import']]);
});

// ── 가상 프로젝트 fixture: 같은 검사기를 메모리 파일 시스템으로 돌린다 ──────────────────
const V = '/virtual';
function virtual(extra) {
  const files = {
    [`${V}/lib/crypto/credentials.ts`]: 'export function encryptSecret(p: string, c: string) { return p + c; }\nexport function decryptSecret(b: string) { return b; }\nexport class CredentialCryptoError extends Error {}',
    [`${V}/lib/credentials/seal.ts`]: "import { encryptSecret } from '@/lib/crypto/credentials';\nexport const s = encryptSecret;",
    [`${V}/lib/ok.ts`]: "import { decryptSecret, CredentialCryptoError } from '@/lib/crypto/credentials';\nimport type * as T from '@/lib/crypto/credentials';\nexport { decryptSecret } from './crypto/credentials';\nexport const d = decryptSecret; export type X = typeof T;",
    [`${V}/scripts/ok.ts`]: "(async () => { const { decryptSecret } = await import('@/lib/crypto/credentials'); decryptSecret('x'); })();",
    ...extra,
  };
  const host = { fileExists: f => f in files, readFile: f => files[f], directoryExists: d => Object.keys(files).some(f => f.startsWith(d + '/')) };
  return sealBoundaryViolations({
    files: Object.keys(files), host, target: `${V}/lib/crypto/credentials.ts`, allowed: new Set([`${V}/lib/credentials/seal.ts`]),
    options: { ...parsed.options, baseUrl: V, paths: { '@/*': ['./*'] }, pathsBasePath: V },
  }).map(v => [v.file.slice(V.length + 1), v.why]);
}

test('fixture positive: seal.ts and other-symbol / type-only / destructured imports pass', () => {
  assert.deepEqual(virtual({}), []);
});

test('fixture negatives: same-folder relative, .js specifier, barrels, namespace re-exports, root files, dynamic whole module', () => {
  const cases = {
    '(1) same-folder relative': [{ [`${V}/lib/crypto/ads.ts`]: "import { encryptSecret } from './credentials';" }, [['lib/crypto/ads.ts', 'named_import']]],
    '(1b) alias': [{ [`${V}/lib/crypto/ads.ts`]: "import { encryptSecret as e } from './credentials'; e('a','b');" }, [['lib/crypto/ads.ts', 'named_import']]],
    '(2) .js extension': [{ [`${V}/lib/x.ts`]: "import { encryptSecret } from './crypto/credentials.js';" }, [['lib/x.ts', 'named_import']]],
    '(3) star barrel + consumer': [{
      [`${V}/lib/crypto/index.ts`]: "export * from './credentials';",
      [`${V}/lib/y.ts`]: "import { encryptSecret } from '@/lib/crypto';",
    }, [['lib/crypto/index.ts', 'reexport_whole'], ['lib/y.ts', 'named_import']]],
    '(3b) named barrel + consumer': [{
      [`${V}/lib/crypto/index.ts`]: "export { encryptSecret as enc } from './credentials';",
      [`${V}/lib/y.ts`]: "import { enc } from '@/lib/crypto'; enc('a','b');",
    }, [['lib/crypto/index.ts', 'reexport_named'], ['lib/y.ts', 'named_import']]],
    '(4) export * as': [{ [`${V}/lib/crypto/raw.ts`]: "export * as raw from './credentials';" }, [['lib/crypto/raw.ts', 'reexport_whole']]],
    '(4c) export * as consumer': [{
      [`${V}/lib/crypto/raw.ts`]: "export * as raw from './credentials';",
      [`${V}/lib/z.ts`]: "import { raw } from './crypto/raw'; raw.decryptSecret('x');",
    }, [['lib/crypto/raw.ts', 'reexport_whole'], ['lib/z.ts', 'named_import']]],
    '(3c) two-hop barrel': [{
      [`${V}/lib/crypto/index.ts`]: "export * from './credentials';",
      [`${V}/lib/index.ts`]: "export * from './crypto';",
      [`${V}/app/page.tsx`]: "import { encryptSecret } from '@/lib';",
    }, [['lib/crypto/index.ts', 'reexport_whole'], ['lib/index.ts', 'reexport_whole'], ['app/page.tsx', 'named_import']]],
    '(4b) namespace import re-exported': [{ [`${V}/lib/crypto/raw.ts`]: "import * as c from './credentials';\nexport { c };" }, [['lib/crypto/raw.ts', 'namespace_import']]],
    '(6) root file': [{ [`${V}/middleware.ts`]: "import { encryptSecret } from '@/lib/crypto/credentials';" }, [['middleware.ts', 'named_import']]],
    '(6b) prisma/ seed': [{ [`${V}/prisma/seed.ts`]: "import { encryptSecret } from '../lib/crypto/credentials';" }, [['prisma/seed.ts', 'named_import']]],
    'dynamic import whole module': [{ [`${V}/scripts/x.ts`]: "(async () => { const m = await import('@/lib/crypto/credentials'); m.decryptSecret('x'); })();" }, [['scripts/x.ts', 'dynamic_whole']]],
    'dynamic destructure encryptSecret': [{ [`${V}/scripts/x.ts`]: "(async () => { const { encryptSecret } = await import('../lib/crypto/credentials'); })();" }, [['scripts/x.ts', 'dynamic_named']]],
    'require whole module': [{ [`${V}/scripts/x.cjs`]: "const m = require('../lib/crypto/credentials.ts');" }, [['scripts/x.cjs', 'dynamic_whole']]],
    '(7) TS import-equals of encryptSecret': [{ [`${V}/lib/crypto/ads.ts`]: "import c = require('./credentials');\nc.encryptSecret('a', 'b');" }, [['lib/crypto/ads.ts', 'import_equals']]],
    '(7b) exported import-equals + consumer': [{
      [`${V}/lib/crypto/raw.ts`]: "export import c = require('./credentials');",
      [`${V}/lib/z.ts`]: "import { c } from './crypto/raw'; c.encryptSecret('a', 'b');",
    }, [['lib/crypto/raw.ts', 'import_equals'], ['lib/z.ts', 'named_import']]],
  };
  for (const [name, [extra, expected]] of Object.entries(cases)) assert.deepEqual(virtual(extra), expected, name);
});

// ── 값 export 스냅샷: 원시 암호화 함수가 새 이름으로 노출되는 경로(봉인 모듈 재노출·credentials.ts 신규 export)를 막는다 ──
const CRYPTO_EXPORTS = ['CredentialCryptoError', 'credentialKeyId', 'decryptSecret', 'encryptSecret', 'maskSecret'];
const SEAL_EXPORTS = ['sealForStorage'];
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

test('value export snapshot: credentials.ts and seal.ts expose exactly the reviewed names (static + runtime)', () => {
  assert.deepEqual(valueExportNames(read('lib/crypto/credentials.ts')), CRYPTO_EXPORTS);
  assert.deepEqual(valueExportNames(read('lib/credentials/seal.ts')), SEAL_EXPORTS);
  require('../../visibility/__tests__/register.cjs');
  require.cache[require.resolve('../../prisma.ts')] ??= { exports: { prisma: {} } };
  assert.deepEqual(Object.keys(require('../../crypto/credentials.ts')).sort(), CRYPTO_EXPORTS);
  assert.deepEqual(Object.keys(require('../seal.ts')).sort(), SEAL_EXPORTS);
});

test('value export snapshot negatives: re-exposed raw encrypt and new raw-encrypt exports are flagged', () => {
  const seal = read('lib/credentials/seal.ts'), cred = read('lib/crypto/credentials.ts');
  const cases = {
    'seal.ts re-exports encryptSecret under another name': seal + "\nexport { encryptSecret as rawSeal };",
    'seal.ts re-exports from credentials directly': seal + "\nexport { encryptSecret } from '@/lib/crypto/credentials';",
    'seal.ts exports an alias constant': seal + "\nexport const sealRaw = encryptSecret;",
    'seal.ts star re-export': seal + "\nexport * from '@/lib/crypto/credentials';",
    'credentials.ts gains a raw encrypt export': cred + "\nexport function encryptAdsKey(p: string, c: string) { return encryptSecret(p, c); }",
    'credentials.ts gains an exported import-equals': cred + "\nexport import raw = require('node:crypto');",
  };
  for (const [name, text] of Object.entries(cases)) {
    const names = valueExportNames(text);
    const expected = name.startsWith('seal') ? SEAL_EXPORTS : CRYPTO_EXPORTS;
    assert.notDeepEqual(names, expected, name);
  }
  // type-only 추가는 값 표면을 바꾸지 않는다(오탐 없음)
  assert.deepEqual(valueExportNames(seal + "\nexport type SealInput = string;\nexport interface X { a: 1 }"), SEAL_EXPORTS);
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
