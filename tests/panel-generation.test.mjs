import test from 'node:test';import assert from 'node:assert/strict';
import {ensurePanelGeneration,panelImage,setPanelImage,panelCandidates,imageEditingMode,panelEditingMode} from '../shared/panel-generation.mjs';
test('a panel restores its exact associated image settings and keeps independent drafts',()=>{
 const item={id:'a',url:'/api/files/a',params:{type:'expanded',positive:'river',negative:'blur',seed:'123',steps:37,cfg:4.2,model:'own.safetensors',width:832,height:1152,loras:[{name:'style.safetensors',strength_model:.95}]}},panel={imageId:'a',image:item.url};
 const draft=ensurePanelGeneration(panel,[item]);assert.equal(panelImage(panel,[item]),item);assert.equal(draft.params.positive,'river');assert.equal(draft.params.seed,'123');assert.equal(draft.params.steps,37);assert.equal(draft.params.model,'own.safetensors');draft.params.positive='new river';draft.params.loras[0].strength_model=.5;assert.equal(item.params.positive,'river');assert.equal(item.params.loras[0].strength_model,.95);assert.equal(ensurePanelGeneration(panel,[item]),draft);
 const other=ensurePanelGeneration({positive:'forest',points:[{x:0,y:0},{x:100,y:200}]},[item]);assert.equal(other.params.positive,'forest');assert.equal(other.params.seed,'');assert.notEqual(other.params,draft.params);
});
test('a completed panel image retains current edits while importing another picture loads that picture settings',()=>{
 const panel={positive:'story',generation:{params:{positive:'edited while queued',steps:22}}},image={id:'b',url:'/api/files/b',params:{type:'original',positive:'generated',negative:'bad',steps:40}};
 setPanelImage(panel,image,{replaceDraft:false});assert.equal(panel.imageId,'b');assert.equal(panel.generation.params.positive,'edited while queued');assert.equal(panel.lastGeneratedParams.positive,'generated');setPanelImage(panel,image);assert.equal(panel.generation.params.positive,'generated');assert.equal(panel.positive,'generated');
});
test('candidate history includes every batch result for this panel and excludes other pages and projects',()=>{
 const target={projectId:'p',pageId:'page',panelId:'one'},panel={imageId:'imported',image:'/api/files/imported'},gallery=[{id:'batch2',target},{id:'other',target:{...target,panelId:'two'}},{id:'batch1',target},{id:'same-id-other-project',target:{...target,projectId:'q'}},{id:'same-id-other-page',target:{...target,pageId:'other'}},{id:'imported',url:panel.image}];
 const candidates=panelCandidates(panel,target,gallery);assert.deepEqual(candidates.map(i=>i.id),['batch2','batch1','imported']);
});
test('double-click routing distinguishes generated, redrawn, external and cutout images even after portable export',()=>{
 const original={id:'a',url:'/api/files/a',jobId:'job1'},redrawn={id:'b',url:'/api/files/b',jobId:'job2',sourceImageId:'a',params:{type:'expanded',positive:'angry',negative:'blur',inpaint:{positive:'stale'}}};
 assert.equal(imageEditingMode(original),'generate');assert.equal(imageEditingMode(redrawn),'inpaint');assert.equal(imageEditingMode({...redrawn,imported:true}),null);assert.equal(imageEditingMode({...redrawn,cutout:true}),null);assert.equal(imageEditingMode({imported:true,params:{positive:'embedded prompt'}}),null);
 const panel={};setPanelImage(panel,redrawn);assert.equal(panelEditingMode(panel,[redrawn]),'inpaint');assert.equal(panel.generation.params.inpaint.positive,'angry');assert.equal(panel.generation.params.inpaint.sourceImageId,'a');assert.equal(panelEditingMode(JSON.parse(JSON.stringify(panel)),[]),'inpaint');
 assert.equal(panelEditingMode(panel,[{...redrawn,imported:true}]),'inpaint');
 setPanelImage(panel,{...original,imported:true});assert.equal(panelEditingMode(panel,[]),null);
});
