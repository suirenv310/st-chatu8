import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { validatePayload, validateKey, validateId, apiRequest } from '../plugins/chatu8-pixai/core.mjs';
import { init, publicAddress } from '../plugins/chatu8-pixai/index.mjs';
const source=await readFile(new URL('../pixai.js',import.meta.url),'utf8');
const {generatePixaiImage}=await import(new URL('../pixai.js',import.meta.url));
const presetModule=await import(new URL('../pixai-presets.js',import.meta.url));
const {blankPreset,ensurePixaiState,generationConfig,buildPixaiPayload,exportPresets,parsePresetImport,injectKeywordRule}=presetModule;
const payload={modelVersionId:'2024383379556065549',prompt:'idol chibi',aspectRatio:'1:1',size:'1k',loras:[]};
const settings={apiKey:'test-only',modelVersionId:payload.modelVersionId};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
test('validates exact PixAI payload without sending unknown fields or unsupported mode',()=>{
 const p=validatePayload({...payload,apiKey:'secret',batchSize:4,url:'https://evil.invalid'});
 assert.equal(p.batchSize,1);assert.equal(p.mode,undefined);assert.equal(p.apiKey,undefined);assert.equal(p.url,undefined);
});
test('preserves optional mode and LoRA triggers',()=>{
 const p=validatePayload({...payload,mode:'standard',loras:[{modelId:'123',weight:0.7,triggerWords:''}]});
 assert.deepEqual(p.loras,[{modelId:'123',weight:0.7,triggerWords:''}]);assert.equal(p.mode,'standard');
});
test('rejects invalid prompt, model IDs, sizes and LoRAs before spending credits',()=>{
 for(const bad of [{prompt:''},{prompt:'x'.repeat(10001)},{modelVersionId:123},{aspectRatio:'auto'},{size:'4k'},{mode:'bad'},{loras:[{modelId:'123',weight:2}]},{loras:{}},{negativePrompt:'x'.repeat(4097)}])assert.throws(()=>validatePayload({...payload,...bad}));
 assert.throws(()=>validateKey('abc\nBearer'));assert.throws(()=>validateId('../secrets'));
});
test('upstream errors expose only status/code, never echoed credentials',async()=>{
 await assert.rejects(apiRequest('/v2/image/create','test-secret',{payload,fetchFn:async()=>json({code:'INSUFFICIENT_BALANCE',message:'test-secret'},403)}),e=>e.status===403 && !e.message.includes('test-secret'));
});
test('only public addresses accepted for media redirects',()=>{
 for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','172.20.1.1','192.168.1.1','::1','fc00::1','::ffff:127.0.0.1'])assert.equal(publicAddress(ip),false,ip);
 assert.equal(publicAddress('8.8.8.8'),true);assert.equal(publicAddress('2606:4700::1111'),true);
});
test('client completes submit → poll → media, returning data URL compatible with upstream cache',async()=>{
 const original=globalThis.fetch;const calls=[];
 globalThis.fetch=async(url,opts)=>{
  calls.push({url,body:opts.body ? JSON.parse(opts.body) : {},headers:opts.headers});
  if(url.endsWith('/health'))return json({provider:'PixAI',version:'0.2.0'});
  if(url.endsWith('/submit'))return json({id:'task-1',status:'waiting'});
  if(url.endsWith('/task'))return json({id:'task-1',status:'completed',outputs:{mediaIds:['media-1']}});
  return json({image:'data:image/png;base64,dGVzdA==',format:'image/png'});
 };
 try {
  const result=await generatePixaiImage({settings,prompt:'scene keywords',signal:new AbortController().signal,headers:()=>({'Content-Type':'application/json','X-CSRF-Token':'csrf'})});
  assert.equal(result.image,'data:image/png;base64,dGVzdA==');assert.equal(calls.length,4);assert.equal(calls[1].body.payload.prompt,'scene keywords');assert.equal(calls[1].headers['X-CSRF-Token'],'csrf');
 }finally{globalThis.fetch=original;}
});
test('client never automatically repeats submission on a lost response',async()=>{
 const original=globalThis.fetch;let count=0;
 globalThis.fetch=async()=>{count++;throw new Error('network lost');};
 try{await assert.rejects(generatePixaiImage({settings,prompt:'scene',headers:()=>({})}));assert.equal(count,1);}finally{globalThis.fetch=original;}
});
test('failed generation does not request an image or start a second generation',async()=>{
 const original=globalThis.fetch;let count=0;
 globalThis.fetch=async(url)=>{if(url.endsWith('/health'))return json({provider:'PixAI',version:'0.2.0'});count++;return json({id:'t1',status:'failed'});};
 try{await assert.rejects(generatePixaiImage({settings,prompt:'scene',headers:()=>({})}),/failed/);assert.equal(count,1);}finally{globalThis.fetch=original;}
});
test('cancel interrupts polling without creating another task',async()=>{
 const original=globalThis.fetch;let count=0;const controller=new AbortController();
 globalThis.fetch=async(url)=>{if(url.endsWith('/health'))return json({provider:'PixAI',version:'0.2.0'});count++;return json({id:'t1',status:'waiting'});};
 const timer=setTimeout(()=>controller.abort(),30);
 try{await assert.rejects(generatePixaiImage({settings,prompt:'scene',signal:controller.signal,headers:()=>({})}));assert.equal(count,1);}finally{clearTimeout(timer);globalThis.fetch=original;}
});
test('server router accepts authenticated submit and task requests; key not returned',async()=>{
 const routes={};await init({get:(p,h)=>routes[p]=h,post:(p,h)=>routes[p]=h});
 const original=globalThis.fetch;
 globalThis.fetch=async(url,opts)=>{
  assert.equal(opts.headers.Authorization,'Bearer test-only');
  return json({id:'task1',status:'waiting',privateKey:'test-only'});
 };
 const run=async(path,body)=>{
  const res=new EventEmitter();res.set=()=>{};res.status=code=>{res.code=code;return res;};res.json=data=>{res.data=data;res.writableEnded=true;};
  await routes[path]({body},res);return res;
 };
 try {
  const ok=await run('/submit',{apiKey:'test-only',payload});assert.equal(ok.data.id,'task1');assert.equal(JSON.stringify(ok.data).includes('test-only'),false);
  const bad=await run('/task',{apiKey:'test-only',taskId:'../../evil'});assert.equal(bad.code,400);
 }finally{globalThis.fetch=original;}
});
test('actual st-chatu8 generation wrapper retains prompt processing, cache and response events',async()=>{
 const {runInNewContext}=await import('node:vm');
 const bundle=await readFile(new URL('../index.js',import.meta.url),'utf8');
 const begin=bundle.indexOf('async function generateBananaImage(');
 const end=bundle.indexOf('function handleCancelBananaTask(',begin);
 const events=[];let cached;let sent;
 const noop=()=>{};
 const context={
  console,AbortController,Date,clearLog:noop,addLog:noop,
  taskQueue:{addTask:()=>1,updateStatus:noop,completeTask:noop},TaskType:{BANANA:'banana'},TaskStatus:{RUNNING:'running'},
  extensionName:'st-chatu8',extension_settings50:{'st-chatu8':{
   pixai:{schemaVersion:2,enabled:true,apiKey:'test-only',activePresetId:'a',presets:{a:{...blankPreset('Chibi'),...settings,positivePrompt:'own prefix',postfixPrompt:'own suffix'}}},cache:'1',banana:{model:'',conversationPresetId:'default',conversationPresets:{default:{fixedPrompt:'prefix',postfixPrompt:'suffix'}}}
  }},isPluginToastDisabled:()=>true,processCharacterPrompt:x=>x,stripChineseAnnotations:async x=>x,
  prompt_replace_banana:async p=>({modifiedPrompt:p+', transformed',insertions:{'前置前':'first','最后置':'last'}}),
  generationConfig,generatePixaiImage:async args=>{sent=args;return{image:'data:image/png;base64,abc',format:'image/png',genParams:{provider:'PixAI'}};},
  window:{token:'csrf'},getRequestHeaders:()=>({'X-CSRF-Token':'csrf'}),document:{getElementById:()=>null},
  setItemImg:async(p,image)=>{cached={p,image};},recordImageGeneration:noop,
  eventSource22:{emit:(type,data)=>events.push({type,data})},EventType:{GENERATE_IMAGE_RESPONSE:'response'},
 };
 await runInNewContext(bundle.slice(begin,end)+'\nbananaGenerate({id:"request1",prompt:"scene",change:"scene"});',context);
 assert.equal(sent.prompt,'scene');assert.equal(sent.settings.positivePrompt,'own prefix');assert.equal(sent.settings.postfixPrompt,'own suffix');
 assert.equal(cached.image,'data:image/png;base64,abc');assert.equal(events.length,2);assert.equal(events[0].data.id,'request1');assert.equal(events[0].data.success,true);
});
test('NAI-like order: fixed positive → filtered scene → fixed postfix; negative sent separately',()=>{
 const p={...blankPreset(),positivePrompt:'best quality, pixel art',postfixPrompt:'white border',negativePrompt:'blurry'};
 const result=buildPixaiPayload(p,'1boy, black hair, best quality, (masterpiece:1.2), brown eyes');
 assert.equal(result.prompt,'best quality, pixel art, 1boy, black hair, brown eyes, white border');
 assert.equal(result.negativePrompt,'blurry');assert.equal(result.promptHelper,'disable');
});
test('SD sampling is sent only for SD family; Tsubaki mode/style only for Tsubaki',()=>{
 const p={...blankPreset(),family:'sd',steps:25,cfgScale:7,samplingMethod:'Euler a',mode:'pro',stylePreset:'chibi',seed:0};
 const sd=buildPixaiPayload(p,'1boy');assert.deepEqual(sd.sampling,{steps:25,cfgScale:7,method:'Euler a'});assert.equal(sd.mode,undefined);assert.equal(sd.style,undefined);assert.equal(sd.seed,0);
 const ts=buildPixaiPayload({...p,family:'tsubaki'},'1boy');assert.equal(ts.mode,'pro');assert.deepEqual(ts.style,{type:'preset',key:'chibi'});assert.equal(ts.sampling,undefined);
 const def=buildPixaiPayload({...p,family:'default'},'1boy');assert.equal(def.sampling,undefined);assert.equal(def.mode,undefined);
});
test('server preserves sampling/style/seed, and forcibly disables PixAI prompt helper',()=>{
 const sd=validatePayload({...payload,promptHelper:'enable',sampling:{method:'Euler a',steps:28,cfgScale:6.5},seed:42});
 assert.deepEqual(sd.sampling,{method:'Euler a',steps:28,cfgScale:6.5});assert.equal(sd.seed,42);assert.equal(sd.promptHelper,'disable');
 assert.equal(validatePayload({...payload,style:{type:'preset',key:'chibi'}}).style.key,'chibi');
 assert.throws(()=>validatePayload({...payload,sampling:{steps:101}}));
 assert.throws(()=>validatePayload({...payload,seed:-1}));
});
test('switching presets changes complete generation settings; in-flight snapshot stays intact',()=>{
 const parent={pixai:{schemaVersion:2,enabled:true,apiKey:'never-export',activePresetId:'a',presets:{a:{...blankPreset('A'),positivePrompt:'pixel art',modelVersionId:'123'},b:{...blankPreset('B'),positivePrompt:'watercolor',negativePrompt:'text',modelVersionId:'456',loras:[{modelId:'789',weight:0.6}]}}}};
 const snap=generationConfig(parent);parent.pixai.activePresetId='b';const next=generationConfig(parent);
 assert.equal(buildPixaiPayload(snap,'1boy').modelVersionId,'123');assert.equal(buildPixaiPayload(next,'1boy').modelVersionId,'456');
 next.loras[0].weight=0.1;assert.equal(parent.pixai.presets.b.loras[0].weight,0.6);
 assert.equal(snap.positivePrompt,'pixel art');
});
test('export/import uses a whitelist and never includes API/LLM credentials',()=>{
 const parent={pixai:{schemaVersion:2,enabled:true,apiKey:'NEVER-EXPORT',activePresetId:'a',presets:{a:{...blankPreset('A'),apiKey:'OTHER-SECRET',modelVersionId:'123'}}}};
 const text=JSON.stringify(exportPresets(parent.pixai,true));assert(!text.includes('SECRET'));assert(!text.includes('NEVER-EXPORT'));
 const imported=parsePresetImport(text);assert.equal(imported[0].modelVersionId,'123');assert.equal(imported[0].apiKey,undefined);
 assert.throws(()=>parsePresetImport(JSON.stringify({schema:'st-chatu8.pixai-presets',version:1,presets:[blankPreset(),{name:'bad',steps:101}]})));
});
test('v0.1 migration preserves old key, settings and Banana fixed prompts once',()=>{
 const parent={pixai:{enabled:true,apiKey:'existing',modelVersionId:'123',negativePrompt:'bad hands',loras:'[{"modelId":"456","weight":0.5}]'},banana:{conversationPresetId:'old',conversationPresets:{old:{fixedPrompt:'pixel art',postfixPrompt:'soft colors'}}}};
 const state=ensurePixaiState(parent);assert.equal(state.apiKey,'existing');assert.equal(state.presets.default.positivePrompt,'pixel art');assert.equal(state.presets.default.postfixPrompt,'soft colors');
 parent.banana.conversationPresets.old.fixedPrompt='CHANGED';assert.equal(ensurePixaiState(parent).presets.default.positivePrompt,'pixel art');
});
test('imports Quick Copy v4.1 settings with full-length model and LoRA version IDs',()=>{
 const data={schema:'st-chatu8.pixai-quick-copy',version:1,type:'preset',name:'PixAI Editor Preset',settings:{
  modelVersionId:'2024383379556065549',
  loras:[
   {modelId:'2044126778765934689',weight:0.8},
   {modelId:'2044126796667224555',weight:0.6},
   {modelId:'2068135185216883079',weight:0.7}
  ],
  prompt:'watercolor',negativePrompt:'text',steps:24,cfgScale:6.5,seed:'42',
  samplingMethod:'Euler a',aspectRatio:'3:4',width:768,height:1024,apiKey:'unused'
 }};
 const [preset]=parsePresetImport(JSON.stringify(data));
 assert.deepEqual(preset,{...blankPreset(data.name),modelVersionId:data.settings.modelVersionId,loras:data.settings.loras,
  positivePrompt:'watercolor',negativePrompt:'text',steps:24,cfgScale:6.5,seed:42,samplingMethod:'Euler a',aspectRatio:'3:4'});
 assert.throws(()=>parsePresetImport(JSON.stringify({...data,version:2})),/version 1/);
 assert.throws(()=>parsePresetImport(JSON.stringify({...data,settings:{}})),/No supported settings/);
 assert.throws(()=>parsePresetImport(JSON.stringify({...data,settings:{modelVersionId:2024383379556065549}})),/modelVersionId/);
});
test('keyword directive affects only PixAI image-generation requests and preserves original wrapper instructions',()=>{
 const messages=[{role:'system',content:'Keep JSON keys and image insertion markers.'},{role:'user',content:'Scene'}];
 const parent={mode:'banana',pixai:{enabled:true,keywordOnly:true}};
 const result=injectKeywordRule(messages,parent,'image_gen');assert.equal(messages.length,2);assert.equal(result.length,3);assert.deepEqual(result[0],messages[0]);
 assert.equal(injectKeywordRule(messages,parent,'translation'),messages);assert.equal(injectKeywordRule(messages,{...parent,mode:'novelai'},'image_gen'),messages);
 assert.equal(injectKeywordRule(result,parent,'image_gen').length,3);
});
test('custom keyword filter does not destroy weighted character groups or preset text',()=>{
 const p={...blankPreset(),blockedTags:'best quality, masterpiece'};
 const result=buildPixaiPayload(p,'1boy, (blue eyes, black hair:1.2), masterpiece, smiling');
 assert.equal(result.prompt,'1boy, (blue eyes, black hair:1.2), smiling');
});
test('client refuses outdated bridge before any task/credit is requested',async()=>{
 const original=globalThis.fetch;const calls=[];
 globalThis.fetch=async url=>{calls.push(url);return json({provider:'PixAI',version:'0.1.0'});};
 try{await assert.rejects(generatePixaiImage({settings,prompt:'1boy',headers:()=>({})}),/v0.2.0/);assert.equal(calls.length,1);assert(calls[0].endsWith('/health'));}finally{globalThis.fetch=original;}
});
