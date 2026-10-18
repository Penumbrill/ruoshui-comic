import test from 'node:test';import assert from 'node:assert/strict';
import {applyInpaintPreset} from '../src/editor/inpaint-presets.js';import {makeProfile} from '../server/profiles.mjs';import {buildWorkflow} from '../server/workflow.mjs';
test('large pose edits use standard sampling, full context, and background protection',()=>{
 for(const type of ['original','expanded']){
  const p=makeProfile(type);p.inpaint=applyInpaintPreset(p,'large');
  const graph=Object.values(buildWorkflow(p,{}, {image:'source.png',mask:'mask.png'}).graph);
  const sample=graph.find(n=>n.class_type==='KSampler').inputs;
  assert.equal(sample.steps,40);assert.equal(sample.cfg,4);assert.equal(sample.denoise,1);
  assert.equal(p.inpaint.onlyMasked,false);assert.equal(p.inpaint.preserveBackground,true);
  assert.equal(p.inpaint.strength,.8);assert.equal(p.inpaint.end_percent,.8);
  assert(!graph.some(n=>n.class_type.includes('FLS')));assert.equal(p.loras.length,0);
  p.inpaint=applyInpaintPreset(p,'detail');assert.equal(p.inpaint.preserveBackground,false);assert.equal(p.inpaint.onlyMasked,true);assert.equal(p.inpaint.steps,36);assert.equal(p.inpaint.denoise,.6);
 }
});
test('switching presets does not leak background, crop, or auxiliary model settings',()=>{
 for(const first of ['large','detail','expression','pose','object'])for(const next of ['large','detail','expression','pose','object']){
  const fresh=makeProfile('original'),changed=makeProfile('original');
  changed.inpaint=applyInpaintPreset(changed,first);
  const a=applyInpaintPreset(changed,next),b=applyInpaintPreset(fresh,next);
  for(const key of ['denoise','steps','cfg','sampler','scheduler','controlnet','strength','end_percent','growMask','maskBlur','padding','onlyMasked','preserveBackground'])assert.equal(a[key],b[key],`${first} → ${next}: ${key}`);
 }
});
test('anatomy presets visibly add concise defect exclusions without duplicating or replacing user text',()=>{
 const p=makeProfile('original');p.inpaint.negative='watermark, extra fingers';
 p.inpaint=applyInpaintPreset(p,'detail');const text=p.inpaint.negative;
 assert(text.startsWith('watermark, extra fingers'));assert(text.includes('extra toes'));assert(text.includes('fused fingers'));
 p.inpaint=applyInpaintPreset(p,'pose');assert.equal(p.inpaint.negative,text);
});
