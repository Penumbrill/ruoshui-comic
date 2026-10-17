import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {StudioService} from '../server/service.mjs';
import {exportProjectArchive,importProjectArchive,projectZip,readProjectZip} from '../server/project-archive.mjs';
import {externalResource} from '../server/runtime-resources.mjs';
import {imageEditingMode,panelEditingMode} from '../shared/panel-generation.mjs';

async function fixture(t){const parent=path.resolve('works/tests');await fs.mkdir(parent,{recursive:true});const root=await fs.mkdtemp(path.join(parent,'archive-'));const service=await new StudioService(root).init();t.after(async()=>{service.closed=true;await service.writeChain;assert(root.startsWith(parent+path.sep));await fs.rm(root,{recursive:true,force:true});});return service;}
const pixel='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7R8AAAAASUVORK5CYII=';

test('project ZIP restores images, cutouts, fonts, parameters and the final canvas state into a separate installation',async t=>{
 const source=await fixture(t),target=await fixture(t),image=await source.importImage({name:'原图.png',base64:pixel}),id=crypto.randomUUID();
 delete image.imported;image.generationMode='generate';image.jobId=crypto.randomUUID();
 const font=JSON.parse(await fs.readFile('assets/fonts/catalog.json','utf8'))[0];
 const project={id,name:'完整工程',editorState:{pageIndex:1,zoom:53,zoomVersion:2,scrollLeft:32,scrollTop:147,selected:'cutout',tool:'select'},pages:[{id:crypto.randomUUID(),width:1200,height:1800,objects:[]},{id:crypto.randomUUID(),width:1200,height:1800,backgroundImage:image.url,objects:[{id:'panel',kind:'panel',image:image.url,imageId:image.id,generation:{params:{positive:'原始提示词'},candidates:[{id:image.id,url:image.url}]}},{id:'cutout',kind:'sticker',cutout:true,image:'data:image/png;base64,'+pixel,sourceImage:image.url,sourceImageId:image.id,outsideOnly:true,rotation:17},{id:'caption',kind:'text',text:'最后的状态',vertical:true,fontFamily:font.family}]}]};
 source.config.cutoutDrafts={[image.id]:{mask:'data:image/png;base64,'+pixel}};
 source.config.quickPromptDrafts={[id+':panel']:{positive:'项目专属草稿'}};source.config.llm={apiKey:'MUST-NOT-EXPORT'};
 await source.saveProject(project);const bytes=await exportProjectArchive(source,id),files=await readProjectZip(bytes);
 assert(files.has('project.json'));assert([...files.keys()].some(name=>name.startsWith('fonts/')));assert(!bytes.includes(Buffer.from('MUST-NOT-EXPORT')));
 source.gallery=[];await fs.rm(path.join(source.data,'imports'),{recursive:true,force:true});
 const result=await importProjectArchive(target,bytes);assert.notEqual(result.id,id);assert.deepEqual(result.editorState,project.editorState);assert.equal(result.pages[1].objects[2].text,'最后的状态');assert.equal(result.pages[1].objects[0].generation.params.positive,'原始提示词');
 const restored=result.pages[1].objects[0],item=target.findImage(restored.imageId);assert(item);assert.equal(restored.image,item.url);assert.deepEqual(await fs.readFile(target.filePath(item.file)),Buffer.from(pixel,'base64'));assert.equal(result.pages[1].objects[1].sourceImageId,item.id);assert(target.config.cutoutDrafts[item.id]);assert(target.config.quickPromptDrafts[result.id+':panel']);
 assert.equal((await fs.stat(path.join(target.data,'project-assets',result.id,'project.ruoshui.zip'))).size,bytes.length);
 assert.equal(imageEditingMode(item),'generate');assert.equal(panelEditingMode(restored,target.gallery),'generate');
 const reopened=await target.readProject(result.id);assert.deepEqual(reopened,result);
});

test('project ZIP rejects corruption and unsafe entries before importing assets',async t=>{
 const service=await fixture(t);assert.throws(()=>projectZip(new Map([['../outside.png',Buffer.from('bad')]])),/路径/);
 const manifest={format:'ruoshui-project',version:1,assets:[],documents:[],images:[],fonts:[]};
 const bad=projectZip(new Map([['manifest.json',Buffer.from(JSON.stringify(manifest))],['project.json',Buffer.from(JSON.stringify({name:'坏工程',pages:[{width:1200,height:1800,objects:[]}]}))],['session.json',Buffer.from('{}')]]));
 await assert.rejects(()=>importProjectArchive(service,bad),/未登记/);assert.equal(service.gallery.length,0);assert.equal(service.projects.length,0);
});

test('project ZIP keeps unselected redraw candidates and their source provenance without changing external imports',async t=>{
 const source=await fixture(t),target=await fixture(t),id=crypto.randomUUID();
 const original=await source.importImage({name:'生成原图.png',base64:pixel});delete original.imported;original.jobId='original-job';original.generationMode='generate';
 const redrawn=await source.importImage({name:'重绘候选.png',base64:Buffer.concat([Buffer.from(pixel,'base64'),Buffer.from('redraw')]).toString('base64')});delete redrawn.imported;Object.assign(redrawn,{jobId:'redraw-job',sourceImageId:original.id,generationMode:'inpaint',target:{projectId:id,pageId:'page',panelId:'panel'},params:{positive:'重绘提示词',inpaint:{maskDraft:{imageId:original.id,mask:'data:image/png;base64,'+pixel}}}});
 const external=await source.importImage({name:'外部图片.png',base64:Buffer.concat([Buffer.from(pixel,'base64'),Buffer.from('external')]).toString('base64')});
 await source.saveProject({id,name:'来源恢复',pages:[{id:'page',width:1200,height:1800,objects:[{id:'panel',kind:'panel',image:original.url,imageId:original.id,imageOrigin:{mode:'generate'}},{id:'external',kind:'panel',image:external.url,imageId:external.id,imageOrigin:{mode:null}}]}]});
 const restored=await importProjectArchive(target,await exportProjectArchive(source,id));const candidate=target.gallery.find(item=>item.jobId==='redraw-job');assert(candidate);assert.equal(imageEditingMode(candidate),'inpaint');assert.equal(candidate.target.projectId,restored.id);assert.notEqual(candidate.sourceImageId,original.id);assert.equal(candidate.params.inpaint.maskDraft.imageId,candidate.sourceImageId);assert.equal(panelEditingMode(restored.pages[0].objects[0],target.gallery),'generate');assert.equal(panelEditingMode(restored.pages[0].objects[1],target.gallery),null);
});

test('external Python script paths resolve to unpacked resources in packaged builds',()=>{
 assert.equal(externalResource('E:\\中文 软件\\resources\\app.asar\\assets\\danbooru_host.py'),'E:\\中文 软件\\resources\\app.asar.unpacked\\assets\\danbooru_host.py');
 assert.equal(externalResource('/apps/resources/app.asar/assets/translate_worker.py'),'/apps/resources/app.asar.unpacked/assets/translate_worker.py');
 assert.equal(externalResource('/source/app.asar-example/assets/test.py'),'/source/app.asar-example/assets/test.py');
});

test('identical image bytes keep separate identities, provenance and URLs after project import',async t=>{
 const source=await fixture(t),target=await fixture(t),a=await source.importImage({name:'生成图.png',base64:pixel}),b=await source.importImage({name:'外部图.png',base64:pixel});delete a.imported;a.jobId='generated';a.generationMode='generate';
 const project={id:crypto.randomUUID(),name:'相同像素不同来源',pages:[{width:1200,height:1800,objects:[{id:'a',kind:'panel',imageId:a.id,image:a.url},{id:'b',kind:'panel',imageId:b.id,image:b.url}]}]};await source.saveProject(project);
 const bytes=await exportProjectArchive(source,project.id),entries=await readProjectZip(bytes);assert.equal([...entries.keys()].filter(name=>name.startsWith('images/')).length,1);
 const restored=await importProjectArchive(target,bytes),objects=restored.pages[0].objects;assert.notEqual(objects[0].imageId,objects[1].imageId);for(const object of objects)assert.equal(object.image,target.findImage(object.imageId).url);assert.equal(panelEditingMode(objects[0],target.gallery),'generate');assert.equal(panelEditingMode(objects[1],target.gallery),null);
});

test('translation preparation downloads both directions once and skips a complete installation',async t=>{
 const service=await fixture(t),manifestPath=path.join(service.data,'test-models.json'),entries=[{target:'translation/ready',size:1},{target:'tag_translation/ready',size:1}];await fs.writeFile(manifestPath,JSON.stringify({downloads:{translation_setup:entries}}));service.defaultManifestPath=manifestPath;
 let downloads=0;const {EventEmitter}=await import('node:events');
 service.downloadModels=async profile=>{assert.equal(profile,'translation_setup');downloads++;const child=service.installChild=new EventEmitter();setTimeout(async()=>{for(const item of entries){const file=path.join(service.folder('models'),item.target);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'x');}child.emit('exit',0);},10);};
 await Promise.all([service.prepareTranslationModels(),service.prepareTranslationModels()]);await service.prepareTranslationModels();assert.equal(downloads,1);assert.equal(service.config.translationSetupCompleted,true);
});
