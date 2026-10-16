import test from 'node:test';
import assert from 'node:assert/strict';
import {makeProfile,mergeConfig} from '../server/profiles.mjs';
import {buildWorkflow,validateParams} from '../server/workflow.mjs';
import {rectPoints,splitPolygon,templatePanels} from '../src/editor/geometry.js';
test('profiles use separate first-party model files and no implicit LoRAs',()=>{
 const a=makeProfile('original'),b=makeProfile('expanded');assert.notEqual(a.model,b.model);assert.equal(a.loras.length,0);assert.equal(b.loras.length,0);assert.equal(b.scheduler,'sgm_uniform');a.face.steps=99;assert.equal(b.face.steps,20);
});
test('publisher inpainting values are independent from text-to-image settings',()=>{
 const p=makeProfile('original');p.seed='42';p.steps=77;p.cfg=9;
 const {graph}=buildWorkflow(p,{}, {image:'source.png',mask:'mask.png'});const nodes=Object.values(graph),sample=nodes.find(n=>n.class_type==='KSampler');
 assert.deepEqual([sample.inputs.steps,sample.inputs.cfg,sample.inputs.sampler_name,sample.inputs.scheduler,sample.inputs.denoise],[30,4,'er_sde','simple',.8]);
 assert(nodes.some(n=>n.class_type==='SetLatentNoiseMask'));assert(nodes.some(n=>n.class_type==='VAEEncode'));assert(nodes.some(n=>n.class_type==='AnimaLLLiteApply_sdscripts'));assert(nodes.some(n=>n.class_type==='MogeCompositeInpaint'));
});
test('LoRA chaining passes both model and encoder through each selected loader',()=>{
 const p=makeProfile('original');p.seed='0';p.loras=[{name:'a.safetensors',strength_model:.7,strength_clip:1},{name:'b.safetensors',strength_model:.8,strength_clip:.6}];
 const {graph}=buildWorkflow(p);const entries=Object.entries(graph).filter(([,n])=>n.class_type==='LoraLoader');assert.equal(entries.length,2);assert.deepEqual(entries[1][1].inputs.model,[entries[0][0],0]);assert.deepEqual(entries[1][1].inputs.clip,[entries[0][0],1]);
});
test('28-layer inpaint weights are not silently used for the 40-layer model',()=>{
 const p=makeProfile('expanded');p.seed='1';p.inpaint.controlnet='anima-lllite-inpainting-v2.safetensors';assert.throws(()=>buildWorkflow(p,{}, {image:'a',mask:'b'}),/40/);
});
test('upscale uses conditioning inputs without an unsupported clip argument',()=>{
 const p=makeProfile('original');p.seed='1';p.upscale.enabled=true;
 const {graph}=buildWorkflow(p);const node=Object.values(graph).find(n=>n.class_type==='UltimateSDUpscale');
 assert(node.inputs.positive);assert(node.inputs.negative);assert.equal('clip' in node.inputs,false);
});
test('invalid dimensions, seeds and prototype pollution are rejected',()=>{
 assert.throws(()=>validateParams({...makeProfile('original'),width:513}),/16/);assert.throws(()=>validateParams({...makeProfile('original'),seed:'9007199254740992'}),/种子/);mergeConfig({},JSON.parse('{"__proto__":{"polluted":true}}'));assert.equal({}.polluted,undefined);
});
test('a diagonal cut produces two polygons with no area lost',()=>{
 const area=points=>Math.abs(points.reduce((sum,p,i)=>sum+p.x*points[(i+1)%points.length].y-p.y*points[(i+1)%points.length].x,0)/2);
 const original=rectPoints(0,0,300,500),parts=splitPolygon(original,{x:-10,y:130},{x:310,y:380});assert.equal(parts.length,2);assert(Math.abs(area(parts[0])+area(parts[1])-area(original))<.001);
 assert.equal(splitPolygon(original,{x:-20,y:0},{x:-20,y:500}),null);assert.equal(templatePanels('six',1200,1800).length,6);
});
