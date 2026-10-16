import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {StudioService,atomicJson,readJson} from '../server/service.mjs';
import {makeProfile} from '../server/profiles.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
test('generated panels persist even while the editor is showing a different project',async t=>{const service=await fixture(t);const project=await service.saveProject({name:'test',pages:[{id:'page',width:1200,height:1800,objects:[{id:'panel',kind:'panel',points:[]}]}]});await service.placeGenerated({id:'image',url:'/api/files/image',target:{projectId:project.id,pageId:'page',panelId:'panel'}});const restored=await service.readProject(project.id);assert.equal(restored.pages[0].objects[0].imageId,'image');});
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'moge-test-'));const service=await new StudioService(dir).init();t.after(async()=>{service.closed=true;await service.writeChain;await fs.rm(dir,{recursive:true,force:true});});return service;}
test('queue increments fixed seeds and persists interrupted work',async t=>{
 const service=await fixture(t),p=makeProfile('original');p.seed='42';for(const [category,name] of [['diffusion_models',p.model],['text_encoders',p.textEncoder],['vae',p.vae]])await fs.writeFile(path.join(service.folder(category),name),'test');
 const group=await service.enqueue({params:p,count:2});assert.deepEqual(service.jobs.map(j=>j.params.seed),['42','43']);assert(service.jobs.every(j=>j.groupId===group.groupId));
 const restored=await new StudioService(service.root).init();assert(restored.jobs.every(j=>j.status==='interrupted'));restored.closed=true;
 await service.cancel(group.groupId);assert(service.jobs.every(j=>j.status==='cancelled'));
});
test('queue errors do not prevent later independent jobs from running',async t=>{
 const service=await fixture(t);service.engine.state='ready';service.jobs=[{id:'1',status:'queued'},{id:'2',status:'queued'}];service.runJob=async job=>{if(job.id==='1')throw Error('workflow failed');};await service.pump();assert.deepEqual(service.jobs.map(j=>j.status),['error','complete']);
});

test('blank seeds enqueue valid independent random seeds without a range error',async t=>{
 const service=await fixture(t),p=makeProfile('original');p.seed='';for(const [category,name] of [['diffusion_models',p.model],['text_encoders',p.textEncoder],['vae',p.vae]])await fs.writeFile(path.join(service.folder(category),name),'test');
 await service.enqueue({params:p,count:3});assert.equal(service.jobs.length,3);assert(service.jobs.every(j=>Number.isSafeInteger(Number(j.params.seed))&&Number(j.params.seed)>=0&&Number(j.params.seed)<2**48));
});
test('image imports and project data survive a fresh service instance',async t=>{
 const service=await fixture(t);const item=await service.importImage({name:'测试.png',base64:png.toString('base64')});assert.equal((await fs.readFile(service.filePath(item.file))).length,png.length);
 const project=await service.saveProject({name:'保存测试',pages:[{width:1200,height:1800,objects:[{id:'p1',kind:'panel',image:item.url,points:[{x:0,y:0},{x:1,y:0},{x:1,y:1}]}]}]});const copy=await service.readProject(project.id);assert.equal(copy.pages[0].objects[0].image,item.url);
 await assert.rejects(service.saveProject({name:'x',pages:[{width:1200,height:1800,objects:[{kind:'panel',image:'https://example.com/tracker.png'}]}]}),/引用/);
 const exported=await service.exportFile({name:'example.png',base64:png.toString('base64')});assert(exported.path.startsWith(path.join(service.root,'works','exports')));assert.deepEqual(await fs.readFile(exported.path),png);
 assert.throws(()=>service.filePath('../outside'),/工作区/);await assert.rejects(service.importImage({name:'not.png',base64:Buffer.from('bad').toString('base64')}),/图片内容/);
});
test('concurrent autosaves keep the latest value and recover a damaged primary file',async t=>{
 const service=await fixture(t),file=path.join(service.data,'autosave.json');await Promise.all(Array.from({length:12},(_,i)=>atomicJson(file,{value:i})));
 assert.equal((await readJson(file,{})).value,11);await fs.writeFile(file,'{broken');assert.equal((await readJson(file,{})).value,10);assert.equal(JSON.parse(await fs.readFile(file,'utf8')).value,10);
});
test('live tag explanations keep English prompts and cache Chinese results under works',async t=>{
 const service=await fixture(t);assert.equal(service.config.liveTagTranslation,true);
 const folder=path.join(service.folder('models'),'tag_translation');await fs.mkdir(folder,{recursive:true});await fs.writeFile(path.join(folder,'pytorch_model.bin'),'fixture');
 let calls=0;service.tagTranslator={translate:async tags=>{calls++;assert.deepEqual(tags,['blue wool coat']);return ['蓝色羊毛外套'];}};
 const tags=['masterpiece','(blue wool coat:1.2)','worst quality'];const result=await service.translateTags(tags);
 assert.deepEqual(tags,['masterpiece','(blue wool coat:1.2)','worst quality']);assert.equal(result.translations.masterpiece,'杰作');assert.equal(result.translations['(blue wool coat:1.2)'],'蓝色羊毛外套');assert.equal(result.translations['worst quality'],'最差质量');
 await service.translateTags(tags);assert.equal(calls,1);assert.equal((await readJson(path.join(service.data,'autosave/tag-translations.json'),{}))['blue wool coat'],'蓝色羊毛外套');
});

test('automatic resource release runs after each image and stops only a finished queue',async t=>{
 const service=await fixture(t);service.engine.state='ready';service.externalTest=true;const calls=[];service.json=async(route,data)=>{calls.push({route,data});return {};};service.releaseIdleEngine=async()=>{calls.push({route:'stop-owned-engine'});service.engine.state='stopped';};
 await service.pump();assert.equal(service.engine.state,'ready');assert.equal(calls.length,0);
 service.jobs=[{id:'a',status:'queued'},{id:'b',status:'queued'}];service.runJob=async()=>{};await service.pump();assert.deepEqual(calls.map(c=>c.route),['/free','/free','stop-owned-engine']);assert(service.jobs.every(j=>j.resourcesReleased&&j.status==='complete'));
});
