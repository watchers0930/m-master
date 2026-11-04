require('../../visibility/__tests__/register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
let calls=0,requestOptions;
const chat=require('../../claude/chat.ts');
require.cache[require.resolve('../../claude/chat.ts')].exports={...chat,getClient:()=>({chat:{completions:{create:async(_input,options)=>{
 requestOptions=options;
 calls++;
 const item=(index,score,rank=1)=>({candidateIndex:index,score,rank,topic:'LLM must never replace the trusted candidate title',tags:[],reason:'기존 근거'});
 return {choices:[{message:{tool_calls:[{type:'function',function:{arguments:JSON.stringify({items:[item(2,99),item(2,100),item(1,60,2),item(99,100)]})}}]}}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}};
}}}})};
const {recommendTopFive}=require('../recommend.ts');
test('candidate indices are validated, duplicates dropped, titles rebound and strategy priority preserved',async()=>{
 const candidates=[{topic:'Trusted strategy',weight:10,signal:'strategy',strategy:{priority:'P0'}},{topic:'Trusted core',weight:8,signal:'core'},{topic:'Trusted third',weight:7,signal:'core'}];
 let settled=0;
 const result=await recommendTopFive({monthYmd:'2026-11-01',channel:'blog',candidates,onUsage:async usage=>{settled++;assert.equal(usage.prompt_tokens,10);}});
 assert.equal(settled,1);assert.deepEqual(requestOptions,{maxRetries:0,timeout:60000});
 assert.equal(calls,1);assert.equal(result.items.length,3);
 assert.deepEqual(result.items.map(i=>i.topic),['Trusted strategy','Trusted core','Trusted third']);
 assert.deepEqual(result.items.map(i=>i.candidateIndex),[1,2,3]);
 assert.equal(result.items[0].recommendRank,2);
 assert.equal(result.items[2].recommendRank,null);
 assert.deepEqual(result.items.map(i=>i.rank),[1,2,3]);
});
