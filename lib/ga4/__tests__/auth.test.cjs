require('../../visibility/__tests__/register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
let reads=0;
require.cache[require.resolve('../../prisma.ts')]={exports:{prisma:{channelCredential:{findUnique:async()=>{reads++;return {refreshToken:'fixture',meta:{client_id:'fixture',client_secret:'fixture'},updatedAt:new Date(0)};}}}}};
const {credentialCandidates,withGa4Request,invalidateGa4Credentials}=require('../auth.ts');
const scope={ownerId:'owner',bindingId:'binding',allowedSources:['owner_oauth']};
test('credential resolution is once per request, separated across owners and invalidated versions',async()=>{
 await withGa4Request(async()=>{
  await Promise.all(Array.from({length:8},()=>credentialCandidates(scope)));assert.equal(reads,1);
  const [before]=await credentialCandidates(scope);invalidateGa4Credentials('owner');
  const [after]=await credentialCandidates(scope);assert.notEqual(before.version,after.version);assert.equal(reads,2);
  await credentialCandidates({...scope,ownerId:'foreign'});assert.equal(reads,3);
 });
 await withGa4Request(()=>credentialCandidates(scope));assert.equal(reads,4);
});
