import test from 'node:test';import assert from 'node:assert/strict';import {TranslationRouter,validTranslation} from '../server/translation-router.mjs';
test('translation automatically falls back after errors, timeouts and invalid language',async()=>{
 const router=new TranslationRouter();let abort=false;
 const result=await router.run(['红外套'],'en',[
  {id:'timeout',name:'超时服务',timeout:10,run:(_,signal)=>new Promise(()=>signal.addEventListener('abort',()=>abort=true))},
  {id:'bad',name:'无效服务',run:async()=>['红外套']},
  {id:'backup',name:'备用服务',run:async()=>['red coat']}
 ]);assert(abort);assert.equal(result.values.get('红外套'),'red coat');assert.equal(result.sources.get('红外套'),'备用服务');assert.equal(result.failures.length,2);
});
test('translation keeps valid results and retries only unresolved entries with the next provider',async()=>{
 const router=new TranslationRouter();let pending;
 const result=await router.run(['red coat','river'],'zh',[
  {id:'one',name:'首选',run:async()=>['红色外套','river']},
  {id:'two',name:'备用',run:async texts=>{pending=texts;return['河流'];}}
 ]);assert.deepEqual(pending,['river']);assert.equal(result.values.get('red coat'),'红色外套');assert.equal(result.values.get('river'),'河流');
});
test('translation failures cool down and poor output is never treated as success',async()=>{
 const router=new TranslationRouter();let calls=0;const provider={id:'bad',name:'失败',run:async()=>{calls++;throw Error('offline');}};
 await router.run(['河流'],'en',[provider]);await router.run(['外套'],'en',[provider]);assert.equal(calls,1);
 assert(!validTranslation('river','河流河流河流河流','zh'));assert(!validTranslation('river','','zh'));assert(validTranslation('river','河流','zh'));
});
