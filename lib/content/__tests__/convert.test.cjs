/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, Buffer */
// 변환(convert) 검토 우회 차단 + 카드 이미지 고유 파일명 + 유료 응답 직후 비용 기록 회귀 테스트(DB·LLM 실호출 없음)
require('../../visibility/__tests__/register.cjs');
require.extensions['.tsx'] = require.extensions['.ts'];
const {test}=require('node:test'),assert=require('node:assert/strict');
let source=null;const persisted=[],uploads=[],events=[];
function mock(id,exports){require.cache[require.resolve(id)]={exports};}
mock('../../auth.ts',{requireSession:async()=>{throw Error('unused');}});
mock('../../prisma.ts',{prisma:{content:{findFirst:async()=>source}}});
mock('../../cost/budget.ts',{isBudgetExceeded:async()=>false});
mock('../../billing/limits.ts',{getUserPlan:async()=>'pro',checkContentLimit:async()=>{},checkCostLimit:async()=>{}});
mock('../../claude/convert.ts',{convertBlogToChannel:async()=>{events.push('llm');return {
 text:'[{"title":"t","body":"b"},{"title":"t2","body":"b2"}]\n#태그',krw:12,usage:{prompt_tokens:3,completion_tokens:4}};}});
mock('../../imagen/instagram-card.tsx',{generateInstagramCard:async()=>{events.push('card');return Buffer.from('png');}});
mock('../../storage.ts',{upload:async(bucket,file)=>{uploads.push(file);return {path:file};},getPublicUrl:(b,f)=>`/uploads/${b}/${f}`});
mock('../persist-generated.ts',{
 recordGenerationCosts:async(ownerId,costs)=>{events.push('ledger');return costs.map((_,i)=>({ledgerId:'L'+i}));},
 persistGeneratedContent:async(input,costs)=>{events.push('persist');persisted.push({input,costs});return {id:'child'+persisted.length};},
});
const {convertContent}=require('../convert.ts');
const {derivedOrigin}=require('../writer.ts');
const blog=over=>({id:'p1',ownerId:'u',channel:'blog',topic:'주제',tone:null,keywords:[],textBody:'본문',imageUrl:null,bodyImageUrls:[],scores:null,
 origin:'manual',reviewStatus:'approved',...over});

test('파생 origin: 사람이 쓰고 승인된 원본만 manual, auto 원본·미승인 원본의 파생물은 auto(pending_review)',()=>{
 assert.equal(derivedOrigin({origin:'manual',reviewStatus:'approved'}),'manual');
 for(const p of [{origin:'auto',reviewStatus:'approved'},{origin:'auto',reviewStatus:'pending_review'},{origin:'auto',reviewStatus:'rejected'},
  {origin:'manual',reviewStatus:'pending_review'},{origin:'manual',reviewStatus:'rejected'}])assert.equal(derivedOrigin(p),'auto',JSON.stringify(p));
});

test('승인된 auto 블로그를 변환해도 자식은 auto로 저장된다(검토 우회 차단), manual 원본은 manual 유지',async()=>{
 for(const [over,expected] of [[{origin:'auto',reviewStatus:'approved'},'auto'],[{origin:'auto',reviewStatus:'pending_review'},'auto'],[{},'manual']]){
  source=blog(over);persisted.length=0;
  await convertContent('u','p1',{channel:'facebook'});
  assert.equal(persisted[0].input.origin,expected,JSON.stringify(over));
  assert.equal(persisted[0].input.parentContentId,'p1');
 }
});

test('재변환은 이전 자식의 카드 이미지를 덮어쓰지 않는다(변환마다 고유 파일명), 비용은 유료 응답 직후 기록 후 연결',async()=>{
 source=blog({});uploads.length=0;persisted.length=0;events.length=0;
 await convertContent('u','p1',{channel:'instagram'});
 const first=[...uploads];
 await convertContent('u','p1',{channel:'instagram'});
 const second=uploads.slice(first.length);
 assert.equal(first.length,2);assert.equal(second.length,2);
 for(const f of first)assert.equal(second.includes(f),false,'같은 파일명 재사용 금지: '+f);
 assert.ok(first.every(f=>f.startsWith('p1/')));
 assert.deepEqual(persisted[1].input.bodyImageUrls,second.map(f=>'/uploads/card-images/'+f),'자식은 자기 세대 파일만 참조');
 assert.deepEqual(events.slice(0,3),['llm','ledger','card'],'카드 생성(실패 가능) 전에 비용 기록');
 assert.deepEqual(persisted[0].costs,[{ledgerId:'L0'}]);
});
