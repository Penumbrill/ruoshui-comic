import test from 'node:test';import assert from 'node:assert/strict';
import {inpaintSource,inpaintResult,matchesGenerationWorkspace} from '../shared/inpaint-preview.mjs';
import {ensurePanelGeneration,setPanelImage} from '../shared/panel-generation.mjs';
import {applyInpaintPreset} from '../src/editor/inpaint-presets.js';
import {makeProfile} from '../server/profiles.mjs';
test('successive inpainting results preserve the original painting surface',()=>{
 const original={id:'original',url:'original.png'},a={id:'a',sourceImageId:'original'},b={id:'b',sourceImageId:'original'},gallery=[b,a,original];
 assert.equal(inpaintSource(a,gallery),original);
 assert.equal(inpaintSource(b,gallery,original),original);
 assert.equal(inpaintResult(b,original),b);
 assert.equal(inpaintResult(original,original),null);
 const unrelated={id:'other'};assert.equal(inpaintSource(unrelated,gallery,original),unrelated);
 assert.equal(inpaintResult(a,unrelated),null);
 assert.equal(inpaintSource(null,gallery,original),null);
 // A portable project may contain only its result; it remains editable.
 assert.equal(inpaintSource(a,[]),a);
 assert.equal(inpaintSource(a,gallery,null,'a'),a);
 assert.equal(inpaintResult(a,inpaintSource(a,gallery,null,'a')),null);
 assert.equal(inpaintSource({...a,cutout:true},gallery).id,'a');
 assert.equal(inpaintSource({...a,imported:true},gallery,null,'original'),original);
});
test('embedded live previews and history isolate mode, panel, page and project',()=>{
 const target={projectId:'p',pageId:'page',panelId:'panel'},job={imageId:'source',target};
 assert.equal(matchesGenerationWorkspace(job,'inpaint',target),true);
 assert.equal(matchesGenerationWorkspace(job,'generate',target),false);
 for(const key of Object.keys(target))assert.equal(matchesGenerationWorkspace(job,'inpaint',{...target,[key]:'other'}),false);
 assert.equal(matchesGenerationWorkspace(job,'inpaint'),false);
 assert.equal(matchesGenerationWorkspace({imageId:'source'},'inpaint'),true);
 assert.equal(matchesGenerationWorkspace({},'generate'),true);
});
test('panel settings, presets and mask drafts are independent from standalone settings',()=>{
 const standalone=makeProfile('original'),image={id:'result',sourceImageId:'source',generationMode:'inpaint',url:'result.png',params:{...makeProfile('original'),positive:'panel prompt',steps:41}},panel={};
 standalone.positive='standalone prompt';standalone.steps=29;
 setPanelImage(panel,image);const draft=ensurePanelGeneration(panel,[image]).params;
 assert.equal(draft.inpaint.sourceImageId,'source');assert.equal(draft.inpaint.positive,'panel prompt');
 const before=JSON.stringify(standalone);draft.inpaint=applyInpaintPreset(draft,'detail');
 draft.inpaint.maskDraft={imageId:'source',mask:'mask',strokes:2};
 setPanelImage(panel,{...image,id:'next'},{replaceDraft:false});
 assert.equal(panel.generation.params,draft);assert.equal(draft.inpaint.maskDraft.strokes,2);
 assert.equal(JSON.stringify(standalone),before);assert.equal(image.params.steps,41);
 const other=ensurePanelGeneration({},[]).params;assert.notEqual(other,draft);assert.equal(other.inpaint.maskDraft??null,null);
});
