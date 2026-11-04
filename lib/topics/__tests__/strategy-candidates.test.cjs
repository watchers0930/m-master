/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require */
require('../../visibility/__tests__/register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
let report;
require.cache[require.resolve('../../prisma.ts')]={exports:{prisma:{domain:{findFirst:async()=>({market:'ko-KR'})},consultingReport:{findFirst:async()=>report}}}};
const {strategyCandidates}=require('../strategy-candidates.ts');
test('L19: an unparsable stored report degrades to no strategy instead of failing the topics run',async()=>{
 const action={id:'a',priority:'P0',channel:'organic',title:'t',description:'d',evidenceIds:['e'],metric:'m',destination:'content_create'};
 const {consultingStrategySchema}=require('../../../schemas/consulting.ts');
 assert.equal(consultingStrategySchema.shape.priorityActions.safeParse([action]).success,true,'fixture reaches the snapshot parse');
 for(const bad of [{id:'r',priorityActions:'corrupt',inputSnapshot:{},schemaVersion:'v3'},{id:'r',priorityActions:[action],inputSnapshot:{broken:true},schemaVersion:'v3'},{id:'r',priorityActions:[action],inputSnapshot:{},schemaVersion:'v9'}]){
  report=bad;assert.deepEqual(await strategyCandidates('o','d'),{candidates:[],strategy:{reportId:'r',reason:'invalid_report'}});
 }
});
