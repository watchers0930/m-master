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
test('reinstated strategy topics never evict an already-selected higher-priority one (codex repro)',()=>{
 const candidates=[...Array.from({length:7},(_,i)=>({topic:'P2-'+i,weight:8,signal:'strategy',strategy:{priority:'P2'}})),
  ...Array.from({length:3},(_,i)=>({topic:'P0-'+i,weight:10,signal:'strategy',strategy:{priority:'P0'}}))];
 const out=ensureStrategyCandidates([8,9,10].map(n=>pick(n,90)),candidates);
 assert.equal(out.length,7);
 assert.deepEqual(out.slice(0,3).map(i=>i.candidateIndex).sort((a,b)=>a-b),[8,9,10]);
});
test('GA4 popular pages become topics from page titles, never from paths; home and untitled pages are skipped',()=>{
 assert.equal(pageTopic('전세 안전 분석 | VESTRA - AI 자산관리 플랫폼','VESTRA'),'전세 안전 분석');
 assert.equal(pageTopic('VESTRA - AI 부동산 자산관리 플랫폼','VESTRA'),null);
 assert.equal(pageTopic(null,'VESTRA'),null);
 const topics=buildCandidates({monthYmd:'2026-11-01',publishedTopics:[],businessContext:{companyName:'VESTRA'},
  ga4PopularPaths:[{path:'/',sessions:300,title:'VESTRA'},{path:'/renewal/jeonse',sessions:120,title:'전세 안전 분석 | VESTRA'},{path:'/x',sessions:50,title:null},{path:'/profile',sessions:18,title:'마이페이지 - VESTRA'},{path:'/refund',sessions:14,title:'취소 및 환불 정책 | VESTRA'}]})
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
test('rates show one decimal and tokens glued to words are parenthesised (운영 리포트 문장 재현)',()=>{
 const ev=new Map([['r',{source:'ga4',value:59.184,unit:'%'}],['a',{source:'status',value:'missing'}],['b',{source:'status',value:'partial'}]]);
 assert.equal(renderEvidenceTokens('매우 높은 참여율을 기록했습니다{{ev:r}}.',ev),'매우 높은 참여율을 기록했습니다(59.2%).');
 assert.equal(renderEvidenceTokens('참여율 {{ev:r}}',ev),'참여율 59.2%');
});
test('a value the model cited after the predicate reads as a citation, not a dangling number (운영 v3.5 리포트 문장)',()=>{
 const ev=new Map([['u',{source:'ga4',value:6,unit:'명'}],['r',{source:'ga4',value:59.184,unit:'%'}],['s',{source:'ga4',value:191,unit:'회'}]]);
 assert.equal(renderEvidenceTokens('유기적 검색의 활성 사용자 수가 낮습니다 {{ev:u}}.',ev),'유기적 검색의 활성 사용자 수가 낮습니다(6명).');
 assert.equal(renderEvidenceTokens('참여율이 긍정적으로 나타났습니다 {{ev:r}}. 하지만 세션 수는 부족하며 {{ev:s}}, 개선이 필요합니다.',ev),
  '참여율이 긍정적으로 나타났습니다(59.2%). 하지만 세션 수는 부족하며(191회), 개선이 필요합니다.');
 assert.equal(renderEvidenceTokens('사용자가 가장 많습니다 {{ev:u}}',ev),'사용자가 가장 많습니다(6명)');
 // A value placed after its metric noun is the intended placement and stays inline.
 assert.equal(renderEvidenceTokens('활성 사용자 {{ev:u}}, 세션 {{ev:s}}',ev),'활성 사용자 6명, 세션 191회');
 assert.equal(renderEvidenceTokens('세션 수가 {{ev:s}}입니다',ev),'세션 수가 191회입니다');
 // codex 반례: a noun ending in 다/요/며 followed by an attached counter is an inline quantity.
 assert.equal(renderEvidenceTokens('담요 {{ev:n}}장 지원',new Map([['n',{source:'ga4',value:6}]])),'담요 6장 지원');
});
