/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require */
// 자동 생성(cron) 유료 비용은 응답 직후 원장에 남고, persist가 실패해도(시간초과·lease 상실) 사라지지 않는다.
require('../../visibility/__tests__/register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const ledger=[],events=[];let failPersist=false;
function mock(id,exports){require.cache[require.resolve(id)]={exports};}
const tx={
 $queryRaw:async()=>[],
 pipelineRun:{findFirst:async()=>failPersist?null:{id:'run'},updateMany:async()=>({count:1})},
 contentPlanItem:{findFirst:async()=>({contentJobId:null}),updateMany:async()=>({count:1})},
 content:{create:async()=>({id:'content1'})},
 costLedger:{
  updateMany:async({where,data})=>{events.push('link');ledger.filter(r=>where.id.in.includes(r.id)&&r.ownerId===where.ownerId&&r.contentId===null).forEach(r=>Object.assign(r,data));return {count:1};},
  createMany:async({data})=>{data.forEach(d=>ledger.push({id:'F'+ledger.length,...d}));return {count:data.length};},
 },
 auditLog:{create:async()=>{}},
};
mock('../../prisma.ts',{prisma:{
 setting:{findUnique:async()=>null},
 costLedger:{createManyAndReturn:async({data})=>{events.push('ledger:'+data.map(d=>d.kind).join('+'));
  return data.map(d=>{const row={id:'L'+ledger.length,contentId:null,...d};ledger.push(row);return {id:row.id};});}},
 $transaction:async fn=>{events.push('persist');return fn(tx);},
}});
mock('../../cost/budget.ts',{isBudgetExceeded:async()=>false});
mock('../../rag/retriever.ts',{hasIndexedDocs:async()=>false,retrieveTopK:async()=>({chunks:[],queryTokens:0}),buildRagContext:()=>''});
mock('../../external/context-builder.ts',{buildExternalContext:async()=>''});
mock('../../claude/chat.ts',{buildSystemPrompt:()=>'sys',calcChatKrw:()=>30,CLAUDE_MODEL:'m',toChatUsage:u=>u,
 reviewContent:async()=>({seo:1,readability:1,brand:1,legal:1,avg:1}),
 getClient:()=>({chat:{completions:{create:async()=>{events.push('llm');return {choices:[{message:{content:'본문'}}],usage:{prompt_tokens:5,completion_tokens:6}};}}}})});
mock('../../claude/translate.ts',{translateImagePrompts:async()=>({queries:['q'],usage:{}}),calcHaikuKrw:()=>2});
mock('../../unsplash/search.ts',{ensureMinimumMarkers:t=>t,extractImagePrompts:()=>['설명'],searchMany:async()=>['https://img']});
mock('../../openai/embedding.ts',{calcEmbeddingKrw:()=>0});
mock('../../openai/image.ts',{generateThumbnail:async()=>({url:'https://thumb'}),calcImageKrw:()=>50});
const {generateContentHeadless}=require('../generate-headless.ts');
const opts={ownerId:'u',mode:'auto',topic:'주제',channel:'blog',pipelineClaim:{id:'run',attempts:1,planItemId:'item'}};

test('유료 응답 직후 비용 기록 → persist 성공 시 생성 콘텐츠에 연결, 총액 보존',async()=>{
 ledger.length=0;events.length=0;failPersist=false;
 const result=await generateContentHeadless(opts);
 assert.deepEqual(events.slice(0,2),['llm','ledger:chat'],'LLM 응답 바로 다음이 원장 기록');
 assert.ok(events.indexOf('ledger:chat+image')<events.indexOf('persist'),'이미지·번역 비용도 persist 전 기록');
 assert.ok(ledger.every(r=>r.contentId==='content1'),'모두 콘텐츠에 연결');
 assert.equal(ledger.reduce((s,r)=>s+r.krw,0),result.costKrw);
});

test('persist 실패(lease 상실·시간초과 재시도 경합)에도 지불한 비용은 원장에 남는다',async()=>{
 ledger.length=0;events.length=0;failPersist=true;
 await assert.rejects(generateContentHeadless(opts),/generation_lease_lost/);
 assert.equal(ledger.reduce((s,r)=>s+r.krw,0),30+2+50);
 assert.ok(ledger.every(r=>r.contentId===null&&r.ownerId==='u'));
});
