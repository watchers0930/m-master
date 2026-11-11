/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, __dirname */
// A3: echo·here-string(<<<) 은 값 끝에 개행을 붙여 Vercel env 값을 오염시킨다(알려진 사고 유형).
// 워크플로의 모든 `vercel env add` 는 printf '%s' 로만 값을 넘긴다.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const dir=path.resolve(__dirname,'../../../.github/workflows');
function envAddViolations(file,text){
 const lines=text.replace(/\\\n\s*/g,' ').split('\n');
 const v=[];
 lines.forEach((line,i)=>{
  if(!/\bvercel\s+env\s+add\b/.test(line))return;
  if(/<<</.test(line))v.push(`${file}:${i+1} here-string`);
  else if(!/\bprintf\s+'%s'\s+"[^"]*"\s*\|\s*(?:npx\s+)?vercel\s+env\s+add\b/.test(line))v.push(`${file}:${i+1} printf '%s' 파이프 아님`);
 });
 return v;
}
test("워크플로의 vercel env add 는 printf '%s' 로만 값을 넘긴다(echo·<<< 개행 오염 금지)",()=>{
 const files=fs.readdirSync(dir).filter(f=>/\.ya?ml$/.test(f));
 assert.ok(files.length>0);
 const found=files.flatMap(f=>envAddViolations(f,fs.readFileSync(path.join(dir,f),'utf8')));
 assert.deepEqual(found,[]);
 assert.ok(files.some(f=>/vercel\s+env\s+add/.test(fs.readFileSync(path.join(dir,f),'utf8'))),'검사 대상(vercel env add)이 실제로 존재');
});
test('스캐너 자체 검증',()=>{
 assert.equal(envAddViolations('x','  echo "${{ secrets.K }}" | npx vercel env add K production').length,1);
 assert.equal(envAddViolations('x','  echo -n "$K" | vercel env add K production').length,1,'echo -n 도 셸마다 달라 금지');
 assert.equal(envAddViolations('x','  npx vercel env add K production <<< "$K"').length,1);
 assert.equal(envAddViolations('x','  printf \'%s\\n\' "$K" | vercel env add K production').length,1);
 assert.deepEqual(envAddViolations('x','  printf \'%s\' "${{ secrets.K }}" | npx vercel env add K production --token="$T"'),[]);
 assert.deepEqual(envAddViolations('x','  printf \'%s\' "$K" \\\n    | npx vercel env add K production'),[]);
});
