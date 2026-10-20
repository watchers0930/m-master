require('./register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
let plan='free', domains=[], audit=[], cancelled=[], updates=[], query;
const owner='clx12345678901234567890123';
const db={
 seoTask:{updateMany:async()=>({count:0})},
 seoAudit:{count:async()=>0,findFirst:async()=>null},
 $queryRaw:async()=>[{plan}],
 domain:{
  count:async({where})=>domains.filter(d=>d.ownerId===where.ownerId).length,
  create:async({data})=>{const d={id:'domain-'+domains.length,createdAt:new Date(),businessType:null,...data}; domains.push(d); return d;},
  findFirst:async({where})=>domains.find(d=>d.id===where.id&&d.ownerId===where.ownerId)??null,
  delete:async({where})=>{domains=domains.filter(d=>d.id!==where.id);},
 },
 setting:{findUnique:async()=>null},
 auditLog:{count:async({where})=>audit.filter(a=>a.actor===where.actor&&a.action===where.action).length,create:async({data})=>{audit.push(data);return data;}},
 visibilityQuery:{findFirst:async()=>query,count:async()=>1,update:async({data})=>{Object.assign(query,data);return query;},updateMany:async args=>{updates.push(args);return {count:1};}},
 visibilitySnapshot:{updateMany:async args=>{cancelled.push(args);return {count:1};}},
};
let chain=Promise.resolve();
db.$transaction=fn=>{const result=chain.then(()=>fn(db));chain=result.catch(()=>{});return result;};
require.cache[require.resolve('../../prisma.ts')]={exports:{prisma:db}};
require.cache[require.resolve('../../auth.ts')]={exports:{requireSession:async()=>({user:{id:owner}})}};
const {createDomain,deleteDomain}=require('../domains.ts');
const {patchQuery}=require('../queries.ts');
const {queryListSchema}=require('../../../schemas/visibility.ts');
const {encodeCursor}=require('../cursor.ts');
const route=require('../../../app/api/visibility/queries/route.ts');
const deleteRoute=require('../../../app/api/domains/[id]/route.ts');
function reset(){plan='free';domains=[];audit=[];cancelled=[];updates=[];query={id:'q',domainId:null,query:'old',market:'ko-KR',engines:['chatgpt','gemini'],brandAliases:['old'],competitorAliases:[],active:true,frequency:'daily',createdAt:new Date(),snapshots:[]};}
test('free domain creation serializes concurrent requests at one record',async()=>{
 reset(); const results=await Promise.allSettled([createDomain(owner,{url:'a.example'}),createDomain(owner,{url:'b.example'})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.find(r=>r.status==='rejected').reason.status,429);
});
test('pro create/delete cycles cannot reset the five-per-minute rate limit',async()=>{
 reset();plan='pro';
 for(let i=0;i<5;i++){const d=await createDomain(owner,{url:`a${i}.example`});await deleteDomain(owner,d.id);}
 await assert.rejects(createDomain(owner,{url:'six.example'}),e=>e.status===429);
 assert.equal(domains.length,0);
});
test('domain DELETE hides foreign IDs and retains/deactivates linked questions while releasing pending',async()=>{
 reset();domains.push({id:'clx12345678901234567890000',ownerId:'foreign'});
 const denied=await deleteRoute.DELETE(new Request('https://app.example/api/domains/x',{method:'DELETE'}),{params:Promise.resolve({id:domains[0].id})});
 assert.equal(denied.status,404);assert.equal(cancelled.length,0);
 domains[0].ownerId=owner;await deleteDomain(owner,domains[0].id);
 assert.equal(updates[0].data.active,false);assert.equal(updates[0].data.domainId,null);
 assert.equal(cancelled[0].where.query.ownerId,owner);assert.equal(cancelled[0].data.status,'failed');
});
test('PATCH configuration invalidates pending; engine removal and deactivation release their reserves',async()=>{
 reset();plan='starter';await patchQuery(owner,'q',{brandAliases:['new']});
 assert.equal(cancelled.at(-1).data.failReason,'query_configuration_changed');
 await patchQuery(owner,'q',{engines:['chatgpt']});
 assert.deepEqual(cancelled.at(-1).where.engine,{notIn:['chatgpt']});
 await patchQuery(owner,'q',{active:false});
 assert.equal(cancelled.at(-1).where.engine,undefined);
 assert.equal(cancelled.at(-1).data.status,'failed');
});
test('query cursor handles equal creation times without duplicates and survives cursor row deletion',async()=>{
 reset(); const at=new Date('2026-10-19T00:00:00Z');
 const rows=Array.from({length:105},(_,i)=>({...query,id:`clx${String(i).padStart(22,'0')}`,createdAt:at}));
 db.visibilityQuery.findMany=async({where,take,orderBy})=>{
  assert.equal(where.ownerId,owner);assert.deepEqual(orderBy,[{createdAt:'desc'},{id:'asc'}]);
  return rows.filter(r=>!where.OR||r.createdAt<where.OR[0].createdAt.lt||(r.createdAt.getTime()===where.OR[1].createdAt.getTime()&&r.id>where.OR[1].id.gt)).slice(0,take);
 };
 const first=await (await route.GET(new Request('https://app.example/api/visibility/queries?limit=100'))).json();
 assert.equal(first.data.length,100);assert.ok(first.nextCursor);
 rows.splice(99,1);
 const next=await (await route.GET(new Request('https://app.example/api/visibility/queries?limit=100&cursor='+first.nextCursor))).json();
 assert.equal(next.data.length,5);assert.equal(next.nextCursor,null);
 assert.equal(new Set([...first.data,...next.data].map(q=>q.id)).size,105);
 assert.throws(()=>queryListSchema.parse({cursor:'invalid'}));
 assert.equal(queryListSchema.parse({cursor:encodeCursor(at,'x')}).cursor.id,'x');
});
