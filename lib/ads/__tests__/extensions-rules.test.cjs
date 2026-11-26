/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, Response, ReadableStream */
// 확장소재 린터·본문 변환·내용 대조(lib/ads/extensions/rules.ts)와 초안 읽기(prompt.ts readDraft) — 순수 함수.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const r = require('../extensions/rules.ts');
const { readDraft } = require('../extensions/prompt.ts');

const H = 'vestra.ai.kr';
const L = (name, path = `/${name}`) => ({ name, url: `https://${H}${path}` });

test('limits: headline 15, promo 14, link name 6 (NFC code points); middle dot and superlatives rejected; blanks mean "skip"', () => {
  assert.deepEqual(r.lintExtensions({ headline: '가'.repeat(15), promo: '나'.repeat(14) }, H), []);
  const over = r.lintExtensions({ headline: '가'.repeat(16), promo: '나'.repeat(15) }, H);
  assert.deepEqual(over.map((i) => [i.target, i.rule]), [['headline', 'ext-headline-length'], ['promo', 'promo-length']]);
  assert.ok(r.lintExtensions({ promo: '근저당·압류 점검' }, H).some((i) => i.rule === 'extension-char'));
  assert.ok(r.lintExtensions({ headline: '업계 최고 분석' }, H).some((i) => i.rule === 'superlative'));
  assert.deepEqual(r.lintExtensions({ headline: '  ', promo: '', subLinks: [] }, H), []);
  assert.ok(r.lintExtensions({ subLinks: [L('일곱글자이름임'), L('b'), L('c')] }, H).some((i) => i.rule === 'link-name-length' && i.index === 0));
});

test('sub links: 3~4, https on the landing host only, no duplicates', () => {
  assert.deepEqual(r.lintExtensions({ subLinks: [L('a'), L('b'), L('c')] }, H), []);
  assert.deepEqual(r.lintExtensions({ subLinks: [L('a'), L('b'), L('c'), L('d')] }, H), []);
  assert.ok(r.lintExtensions({ subLinks: [L('a'), L('b')] }, H).some((i) => i.rule === 'sub-links-count'));
  assert.ok(r.lintExtensions({ subLinks: [L('a'), L('b'), L('c'), L('d'), L('e')] }, H).some((i) => i.rule === 'sub-links-count'));
  const bad = (url) => r.lintExtensions({ subLinks: [L('a'), L('b'), { name: 'x', url }] }, H).filter((i) => i.rule === 'sub-link-url').length;
  assert.equal(bad(`http://${H}/x`), 1, 'http 거부');
  assert.equal(bad('https://evil.example/x'), 1, '다른 호스트');
  assert.equal(bad(`https://m.${H}/x`), 1, '하위 도메인도 다른 호스트');
  assert.equal(bad(`https://user:pw@${H}/x`), 1);
  assert.equal(bad(`https://${H}:8443/x`), 1);
  assert.equal(bad('not a url'), 1);
  assert.equal(bad(`https://${H.toUpperCase()}/x`), 0, '호스트 대소문자 무시');
  const dup = r.lintExtensions({ subLinks: [L('a'), L('a', '/z'), L('c', '/a/')] }, H);
  assert.equal(dup.filter((i) => i.rule === 'sub-link-duplicate').length, 2, '같은 이름·같은 주소(끝 / 무시)');
});

test('naver bodies (measured shapes) and content comparison', () => {
  const bodies = r.toNaverBodies({ headline: ' AI 분석 ', promo: '무료 점검', subLinks: [L('a'), L('b'), L('c')] });
  assert.deepEqual(bodies.map((b) => b.type), ['HEADLINE', 'DESCRIPTION', 'SUB_LINKS']);
  assert.deepEqual(bodies[0].adExtension, { headline: 'AI 분석' });
  assert.deepEqual(bodies[1].adExtension, { description: '무료 점검' });
  assert.deepEqual(bodies[2].adExtension[0], { name: 'a', final: `https://${H}/a` });
  assert.equal(r.sameContent('HEADLINE', { headline: 'AI 분석' }, bodies[0].adExtension), true);
  assert.equal(r.sameContent('HEADLINE', { headline: 'AI 분석2' }, bodies[0].adExtension), false);
  assert.equal(r.sameContent('SUB_LINKS', [...bodies[2].adExtension].reverse(), bodies[2].adExtension), false, '순서도 같아야 한다');
  assert.equal(r.sameContent('SUB_LINKS', { not: 'array' }, bodies[2].adExtension), false);
  assert.equal(r.sameContent('DESCRIPTION', null, null), false, '둘 다 읽을 수 없으면 같다고 보지 않는다');
});

test('readDraft keeps only listed page URLs; fewer than 3 left = no sub links; bad JSON = null', () => {
  const pages = ['a', 'b', 'c'].map((n) => ({ url: `https://${H}/${n}`, title: null }));
  const d = readDraft(JSON.stringify({ headline: 'h', promo: 'p', subLinks: [L('a'), L('b'), L('c'), L('x')] }), pages);
  assert.deepEqual(d.subLinks.map((l) => l.name), ['a', 'b', 'c']);
  assert.deepEqual(readDraft(JSON.stringify({ headline: 'h', subLinks: [L('a'), L('x'), L('y')] }), pages).subLinks, []);
  assert.equal(readDraft('not json', pages), null);
  assert.equal(readDraft(JSON.stringify({ headline: 5 }), pages), null);
});

// codex 반례(2026-11-26): 사이트맵 목록은 한 단계 따라간다, 리다이렉트는 기본 포트만, 본문이 끊긴 페이지 하나가 전체를 깨지 않는다.
const { sitePages, deadLinks } = require('../extensions/pages.ts');
const res = (status, body = '', headers = {}) => new Response(body, { status, headers });
const site = (routes) => async (url) => { const r = routes[url]; if (!r) return res(404); return typeof r === 'function' ? r() : r; };

test('sitemap index: follows child sitemaps one level, skips .xml locs, other hosts and non-default ports', async () => {
  const pages = await sitePages(H, site({
    [`https://${H}/sitemap.xml`]: res(200, `<sitemapindex><sitemap><loc>https://${H}/s1.xml</loc></sitemap><sitemap><loc>https://evil.example/s.xml</loc></sitemap></sitemapindex>`),
    [`https://${H}/s1.xml`]: res(200, `<urlset><url><loc>https://${H}/a</loc></url><url><loc>https://${H}:8443/admin</loc></url><url><loc>https://${H}/nested.xml</loc></url></urlset>`),
    [`https://${H}/a`]: res(200, '<title>A 페이지</title>'),
  }));
  assert.deepEqual(pages, [{ url: `https://${H}/a`, title: 'A 페이지' }]);
});

test('redirect to a non-default port or another host is a dead link; a body that breaks mid-stream does not fail the whole list', async () => {
  const dead = await deadLinks([`https://${H}/p`, `https://${H}/q`, `https://${H}/ok`], H, site({
    [`https://${H}/p`]: res(302, '', { location: `https://${H}:8443/admin` }),
    [`https://${H}/q`]: res(301, '', { location: 'https://evil.example/' }),
    [`https://${H}/ok`]: res(200, 'x'),
    [`https://${H}:8443/admin`]: res(200, 'internal'), // 열리는 곳이어도 포트가 다르면 따라가지 않는다
  }));
  // 리다이렉트 응답의 본문 스트림 오류(codex 2차): 그 후보만 제목 없음, 전체는 성공
  const brokenRedirect = () => new Response(new ReadableStream({ pull(c) { c.error(new Error('reset')); } }), { status: 302, headers: { location: `https://${H}/b` } });
  const viaRedirect = await sitePages(H, site({
    [`https://${H}/sitemap.xml`]: res(200, `<urlset><url><loc>https://${H}/r</loc></url></urlset>`),
    [`https://${H}/r`]: brokenRedirect,
    [`https://${H}/b`]: res(200, '<title>B</title>'),
  }));
  assert.deepEqual(viaRedirect.map((p) => p.title), ['B']);
  assert.deepEqual(dead, [`https://${H}/p`, `https://${H}/q`]);
  const broken = () => new Response(new ReadableStream({ pull(c) { c.error(new Error('timeout')); } }), { status: 200 });
  const pages = await sitePages(H, site({
    [`https://${H}/sitemap.xml`]: res(200, `<urlset><url><loc>https://${H}/a</loc></url><url><loc>https://${H}/b</loc></url></urlset>`),
    [`https://${H}/a`]: broken,
    [`https://${H}/b`]: res(200, '<title>B</title>'),
  }));
  assert.deepEqual(pages.map((p) => p.title), [null, 'B']);
});
