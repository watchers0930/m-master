require('./register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const rows = Array.from({length:11},(_,i)=>({ id:String(i),ownerId:i<10?'blocked':'healthy',attemptFailures:0,lastCheckedAt:null,nextAttemptAt:null }));
let selectedOrder;
const reached=[];
const db = {
 visibilitySnapshot: { updateMany: async()=>({count:0}) },
 visibilityQuery: {
  findMany: async ({where,take,orderBy}) => {
   selectedOrder=orderBy;
   assert.equal(where.active,true);
   return rows.filter(r=>!r.nextAttemptAt || r.nextAttemptAt<=new Date()).sort((a,b)=>(a.lastCheckedAt??0)-(b.lastCheckedAt??0)).slice(0,take).map(r=>({...r}));
  },
  updateMany: async ({where,data}) => { Object.assign(rows.find(r=>r.id===where.id),data); return {count:1}; },
 },
 user: {findMany: async()=>['blocked','healthy'].map(id=>({id,plan:'pro',settings:[],_count:{visibilityQueries:11}}))},
};
require.cache[require.resolve('../../prisma.ts')]={exports:{prisma:db}};
require.cache[require.resolve('../track.ts')]={exports:{capture: async(owner,id)=>{ reached.push(id); if(owner==='blocked') throw new Error('budget'); return [{status:'ok'}]; }}};
const {captureBatch}=require('../cron.ts');
test('ten budget failures cannot starve the eleventh healthy question and retries back off exponentially',async()=>{
 assert.equal((await captureBatch({limit:10})).failed,10);
 assert.ok(rows.slice(0,10).every(r=>r.nextAttemptAt>new Date() && r.attemptFailures===1));
 assert.equal((await captureBatch({limit:10})).processed,1);
 assert.ok(reached.includes('10'));
 assert.equal(selectedOrder[0].lastCheckedAt.nulls,'first');
 rows[0].nextAttemptAt=new Date(0);
 await captureBatch({limit:10});
 assert.equal(rows[0].attemptFailures,2);
 assert.equal(rows[0].nextAttemptAt-rows[0].lastCheckedAt,120000);
});
