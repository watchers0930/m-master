/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require */
// 2026-11-06 운영 E2E 에서 나온 결함 재현: 전략 후보 탈락 · 경로가 주제가 됨 · "5월 시즌" 예시 복사 · 근거 단위 중복("6명명").
require('../../visibility/__tests__/register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {ensureStrategyCandidates}=require('../recommend.ts');
const {buildCandidates,pageTopic}=require('../candidates.ts');
const {renderEvidenceTokens}=require('../../consulting/evidence-format.ts');
const pick=(candidateIndex,score)=>({candidateIndex,recommendRank:1,rank:1,topic:'t'+candidateIndex,score,tags:[],reason:''});
test('a strategy candidate the selector dropped is reinstated, replacing the lowest non-strategy pick (≤7 kept)',()=>{
 const candidates=[{topic:'전략 주제',weight:9,signal:'strategy',strategy:{priority:'P1'}},...Array.from({length:8},(_,i)=>({topic:'시즌'+i,weight:8,signal:'season'}))];
 const items=[2,3,4,5,6,7,8].map((n,i)=>pick(n,95-i));
 const out=ensureStrategyCandidates(items,candidates);
 assert.equal(out.length,7);
 assert.ok(out.some(i=>i.candidateIndex===1&&i.topic==='전략 주제'));
 assert.ok(!out.some(i=>i.candidateIndex===8),'lowest-scored season pick is the one replaced');
 assert.equal(ensureStrategyCandidates(out,candidates),out,'nothing to add once included');
});
test('GA4 popular pages become topics from page titles, never from paths; home and untitled pages are skipped',()=>{
 assert.equal(pageTopic('전세 안전 분석 | VESTRA - AI 자산관리 플랫폼','VESTRA'),'전세 안전 분석');
 assert.equal(pageTopic('VESTRA - AI 부동산 자산관리 플랫폼','VESTRA'),null);
 assert.equal(pageTopic(null,'VESTRA'),null);
 const topics=buildCandidates({monthYmd:'2026-11-01',publishedTopics:[],businessContext:{companyName:'VESTRA'},
  ga4PopularPaths:[{path:'/',sessions:300,title:'VESTRA'},{path:'/renewal/jeonse',sessions:120,title:'전세 안전 분석 | VESTRA'},{path:'/x',sessions:50,title:null}]})
  .filter(c=>c.signal==='ga4_popular').map(c=>c.topic);
 assert.deepEqual(topics,['전세 안전 분석 완벽 가이드']);
 assert.ok(!topics.some(t=>t.includes('/')||/renewal/i.test(t)));
});
test('season tag example follows the current month, not a hard-coded "5월"',()=>{
 const src=require('node:fs').readFileSync(require.resolve('../recommend.ts'),'utf8');
 assert.ok(!src.includes('"5월 시즌"'));assert.ok(src.includes('${month}월 시즌'));
});
test('a unit written after an evidence token is not doubled; other text is untouched',()=>{
 const ev=new Map([['u',{source:'ga4',value:6,unit:'명'}],['r',{source:'ga4',value:100,unit:'%'}]]);
 assert.equal(renderEvidenceTokens('활성 사용자가 {{ev:u}}명으로 참여율 {{ev:r}}%',ev),'활성 사용자가 6명으로 참여율 100%');
 assert.equal(renderEvidenceTokens('{{ev:u}} 방문',ev),'6명 방문');
 assert.equal(renderEvidenceTokens('{{ev:r}}회',ev),'100%회');
});
