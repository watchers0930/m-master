/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require */
// GA4 속성·스트림 소유 배타성(공용 서비스 계정 → 한 속성 = 한 소유자) 회귀 테스트. DB·GA4 실호출 없음.
require('../../visibility/__tests__/register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
let rows=[];const events=[];
const tx={
 $executeRaw:async(strings,...values)=>{events.push(["lock",values[0]]);return 1;},
 ga4Binding:{
  findFirst:async({where})=>{events.push(['check']);
   const other=rows.find(r=>r.ownerId!==where.ownerId.not&&where.OR.some(c=>('propertyId' in c&&c.propertyId===r.propertyId)||('streamId' in c&&c.streamId===r.streamId)));
   return other?{id:other.id}:null;},
  upsert:async({create})=>{events.push(['upsert']);rows.push({id:'b'+rows.length,...create});return {id:'b'+(rows.length-1),propertyId:create.propertyId,streamId:create.streamId};},
 },
};
require.cache[require.resolve('../../prisma.ts')]={exports:{prisma:{
 domain:{findFirst:async()=>({url:'https://a.example.com'})},
 $transaction:async fn=>fn(tx),auditLog:{create:async()=>{}},ga4Binding:{updateMany:async()=>({count:1})},
}}};
require.cache[require.resolve('../run.ts')]={exports:{runGa4:async()=>{throw new Error('unused');}}};
require.cache[require.resolve('../auth.ts')]={exports:{invalidateGa4Credentials:()=>{}}};
const {bindGa4}=require('../binding.ts');
const input=(owner,property,stream)=>({owner,domain:'d-'+owner,property,...(stream?{stream}:{})});
test('다른 소유자가 이미 연결한 GA4 속성·스트림은 409로 거절되고 아무것도 쓰지 않는다',async()=>{
 rows=[{id:'b-legacy',ownerId:'ownerB',propertyId:'properties/111',streamId:'999'}];events.length=0;
 await assert.rejects(bindGa4(input('ownerA','111')),e=>e.code==='ga4_property_bound'&&e.status===409);
 assert.deepEqual(events.map(e=>e[0]),['lock','check'],'잠금 후 확인, upsert 없음');
 assert.equal(events[0][1],'ga4_property:properties/111');
 events.length=0;
 await assert.rejects(bindGa4(input('ownerA','222','999')),e=>e.code==='ga4_property_bound','같은 스트림을 다른 속성 번호로 묶는 것도 거절');
 assert.equal(events.some(e=>e[0]==='upsert'),false);
});
test('같은 소유자의 재연결·다른 속성 연결은 허용된다',async()=>{
 rows=[{id:'b-own',ownerId:'ownerA',propertyId:'properties/111',streamId:'999'}];events.length=0;
 assert.ok((await bindGa4(input('ownerA','111','999'))).bindingId);
 assert.ok((await bindGa4(input('ownerC','333'))).bindingId);
 assert.equal(events.filter(e=>e[0]==='upsert').length,2);
});
