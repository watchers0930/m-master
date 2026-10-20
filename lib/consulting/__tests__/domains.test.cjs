require('../../visibility/__tests__/register.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const owner='clx12345678901234567890123';
let session=owner;
const date=new Date('2026-10-20T00:00:00Z');
const rows=Array.from({length:105},(_,i)=>({id:`clx${String(i).padStart(22,'0')}`,ownerId:owner,url:`site-${i}.example`,market:'ko-KR',businessType:null,createdAt:date}));
require.cache[require.resolve('../../auth.ts')]={exports:{requireSession:async()=>{if(!session)throw new Error('Unauthorized');return {user:{id:session}};}}};
require.cache[require.resolve('../../prisma.ts')]={exports:{prisma:{domain:{findMany:async({where,take,select})=>{
  assert.equal(select.ownerId,undefined);
  return rows.filter(r=>r.ownerId===where.ownerId&&(!where.id||r.id===where.id)&&(!where.url||r.url.includes(where.url.contains.toLowerCase()))&&
    (!where.OR||r.createdAt<where.OR[0].createdAt.lt||(r.createdAt.getTime()===where.OR[1].createdAt.getTime()&&r.id>where.OR[1].id.gt))).slice(0,take);
}}}}};
const {consultingDomains,consultingDomainQuerySchema:schema}=require('../domains.ts');
const route=require('../../../app/api/consulting/domains/route.ts');
test('server domain cursor traverses 105 equal timestamps and remains valid when boundary row is deleted',async()=>{
 const first=await consultingDomains(owner,schema.parse({limit:100}));
 assert.equal(first.items.length,100);assert.ok(first.nextCursor);
 rows.splice(99,1);
 const next=await consultingDomains(owner,schema.parse({limit:100,cursor:first.nextCursor}));
 assert.equal(next.items.length,5);assert.equal(next.nextCursor,null);
 assert.equal(new Set([...first.items,...next.items].map(d=>d.id)).size,105);
 await assert.rejects(consultingDomains('foreign',schema.parse({cursor:first.nextCursor})),e=>e.status===400);
 await assert.rejects(consultingDomains(owner,schema.parse({q:'site',cursor:first.nextCursor})),e=>e.status===400);
});
test('server search and direct lookup enforce owner and API validates authentication and query',async()=>{
 const target=rows.at(-1);
 assert.equal((await consultingDomains(owner,schema.parse({q:'SITE-104'}))).items[0].id,target.id);
 assert.equal((await consultingDomains(owner,schema.parse({domainId:target.id}))).items[0].id,target.id);
 await assert.rejects(consultingDomains('foreign',schema.parse({domainId:target.id})),e=>e.status===404);
 session=null;assert.equal((await route.GET(new Request('https://app.test/api/consulting/domains'))).status,401);session=owner;
 for(const query of ['limit=101','q=a&q=b','ownerId=foreign','domainId=invalid',`domainId=${target.id}&q=x`])
  assert.equal((await route.GET(new Request('https://app.test/api/consulting/domains?'+query))).status,400);
 const response=await route.GET(new Request('https://app.test/api/consulting/domains?domainId='+target.id));
 assert.equal(response.status,200);assert.equal((await response.json()).data.items[0].id,target.id);
});
