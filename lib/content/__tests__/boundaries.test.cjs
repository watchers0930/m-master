require('../../visibility/__tests__/register.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {isPublishable}=require('../../publish/eligibility.ts');
const {contentEditSchema,contentReviewSchema,contentListSchema}=require('../../../schemas/content.ts');
const {workerCompleteSchema}=require('../../../schemas/blog-worker.ts');
const {violations}=require('./boundary-guard.cjs');
const root=path.resolve(__dirname,'../../..');
function files(dir){return fs.existsSync(dir)?fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory() ? e.name==='__tests__'?[]:files(path.join(dir,e.name)) : /\.[cm]?[jt]sx?$/.test(e.name)&&!e.name.endsWith('.d.ts')?[path.join(dir,e.name)]:[]):[];}
test('only writer inserts Content; only channels imports outbound adapters (TypeScript AST)',()=>{
 const paths=['lib','app','actions','scripts'].flatMap(dir=>files(path.join(root,dir)));
 const config=ts.readConfigFile(path.join(root,'tsconfig.json'),ts.sys.readFile).config;
 const parsed=ts.parseJsonConfigFileContent(config,ts.sys,root);
 const program=ts.createProgram(paths,{...parsed.options,allowJs:true}),checker=program.getTypeChecker();
 const delegate=node=>checker.typeToString(checker.getTypeAtLocation(node)).includes('ContentDelegate<');
 let writerCount=0,typedCount=0;
 for(const file of paths){
  const source=program.getSourceFile(file);
  assert.ok(source,`Missing source: ${file}`);
  const hits=violations(source,delegate);
  if(file.endsWith('/content/writer.ts')) {
   writerCount=hits.filter(h=>h==='content_write').length;
   function visit(node){if(ts.isPropertyAccessExpression(node)&&node.name.text==='create'&&delegate(node.expression))typedCount++;ts.forEachChild(node,visit);}visit(source);
   continue;
  }
  const illegal=file.endsWith('/publish/channels.ts')?hits.filter(h=>h!=='adapter_import'):hits;
  assert.deepEqual(illegal,[],`Content/channel boundary bypass: ${file}`);
 }
 assert.equal(writerCount,1,'writer positive control must find exactly one Content create');
 assert.equal(typedCount,1,'Prisma Content types must resolve; run prisma generate');
});
test('boundary guard detects erased types, relations, SQL, dynamic imports and re-exports',()=>{
 for(const code of [
  '(prisma as any).content.create({data:{}})',
  'prisma.user.update({data:{contents:{create:{}}}})',
  'prisma.abTest.create({data:{variantA:{create:{}}}})',
  'prisma.scheduleSlot.create({data:{content:{create:{}}}})',
  'prisma.$executeRaw`INSERT INTO contents (id) VALUES (${id})`',
  'const writer = prisma.content; writer.create({})',
  'const { create } = prisma.content',
  'import("@/lib/publish/facebook")',
  'require("@/lib/publish/instagram")',
  'export * from "@/lib/publish/naver-cafe"',
 ]) assert.ok(violations(ts.createSourceFile('fixture.tsx',code,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)).length,code);
});
test('all origins, review states and parent states are gated before external work',()=>{
 const now=new Date(),ctx={actorOwnerId:'u',channel:'blog',trigger:'manual',now,alreadySent:false,activeClaimHeldByOther:false};
 for(const origin of ['manual','auto'])for(const reviewStatus of ['pending_review','approved','rejected']){
  const content={id:'c',ownerId:'u',channel:'blog',status:'draft',origin,reviewStatus,updatedAt:now,parentContentId:null};
  assert.equal(isPublishable({type:'content',content,parent:null},ctx).allowed,reviewStatus==='approved');
  if(reviewStatus==='approved')for(const parentStatus of ['pending_review','rejected']){
   assert.equal(isPublishable({type:'content',content:{...content,parentContentId:'p'},parent:{ownerId:'u',reviewStatus:parentStatus}},ctx).reason,'parent_not_approved');
  }
 }
 const content={id:'c',ownerId:'u',channel:'blog',status:'draft',reviewStatus:'approved',updatedAt:now,parentContentId:null};
 for(const [change,reason]of [[{actorOwnerId:'v'},'owner_mismatch'],[{channel:'facebook'},'channel_mismatch'],[{alreadySent:true},'already_published'],[{activeClaimHeldByOther:true},'claim_held'],[{expectedVersion:new Date(0)},'version_mismatch']]){
  assert.equal(isPublishable({type:'content',content,parent:null},{...ctx,...change}).reason,reason);
 }
});
test('strict boundaries reject privilege fields, unbounded lists and malicious worker URLs',()=>{
 assert.equal(contentEditSchema.safeParse({expected_updated_at:new Date().toISOString()}).success,false);
 for(const field of ['origin','owner_id','review_status','status','image_url'])assert.equal(contentEditSchema.safeParse({expected_updated_at:new Date().toISOString(),topic:'x',[field]:'forged'}).success,false);
 assert.equal(contentListSchema.safeParse({per_page:'101'}).success,false);
 assert.equal(contentReviewSchema.safeParse({decision:'approve',expected_updated_at:'yesterday'}).success,false);
 const base={contentId:'c',claimToken:'x'.repeat(43)};
 for(const externalUrl of ['not a url','https://blog.naver.com.evil.test/a','https://blog.naver.com@evil.test/a','http://blog.naver.com/a','https://blog.naver.com:4430/a'])assert.equal(workerCompleteSchema.safeParse({...base,externalUrl}).success,false);
 assert.equal(workerCompleteSchema.safeParse({...base,externalUrl:'https://blog.naver.com/user/123'}).success,true);
});
