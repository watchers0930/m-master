require("../../visibility/__tests__/register.cjs");
const {test}=require("node:test");
const assert=require("node:assert/strict");
const ts=require("typescript");
const fs=require("node:fs");
require.extensions[".tsx"]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,"utf8"),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},fileName:file,
}).outputText,file);
const React=require("react");
const {renderToStaticMarkup}=require("react-dom/server");
const {SectionShell}=require("../../../app/(dashboard)/consulting/components/sections/SectionShell.tsx");
const {FocusSection}=require("../../../app/(dashboard)/consulting/components/sections/FocusSection.tsx");
const meta={sourceStatus:"partial",reason:null,evidenceIds:[],observedAt:null,market:"ko-KR",location:null,period:null,unit:null,currency:null,selection:null,coverage:null};
test("section has a heading that supplies its accessible name",()=>{
 const html=renderToStaticMarkup(React.createElement(SectionShell,{title:"수요추이",icon:null,meta},"content"));
 const name=html.match(/<section[^>]*aria-labelledby="([^"]+)"/)[1];
 assert.ok(html.includes(`<h2 id="${name}"`));
 assert.match(html,/>수요추이<\/h2>/);
});
test("focus renders per-metric ads periods and omits unknown periods",()=>{
 const item={keywordId:"k",difficulty:null,volume:10,cpc:2,adCompetition:null,adValue:null,evidenceIds:[],metricPeriods:{volume:{from:"2026-08",to:"2026-09"},cpc:{from:"2026-10-01",to:"2026-10-01"}}};
 const render=()=>renderToStaticMarkup(React.createElement(FocusSection,{section:{meta,items:[item]},labelOf:()=>"keyword",evidenceById:new Map()}));
 const html=render();
 assert.match(html,/2026-08.*2026-09/);
 assert.match(html,/2026-10-01.*2026-10-01/);
 assert.ok(!html.includes("기간 "));
 item.metricPeriods={};
 assert.ok(!render().includes("2026-"));
});
