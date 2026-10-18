import test from 'node:test';import assert from 'node:assert/strict';import {buildWorkflow} from '../server/workflow.mjs';import {makeProfile} from '../server/profiles.mjs';
test('workflow loaders use the engine spelling of nested Windows model paths',()=>{
 const p={...makeProfile('expanded'),model:'anima/model.safetensors',textEncoder:'anima/text.safetensors',vae:'anima/vae.safetensors',loras:[{name:'anima/style/lora.safetensors',strength_model:.85,strength_clip:1}]};
 const plain=buildWorkflow(p).graph,schemas=Object.fromEntries(Object.values(plain).map(n=>[n.class_type,{input:{required:{}}}]));
 for(const [type,key,value] of [['UNETLoader','unet_name','anima\\model.safetensors'],['CLIPLoader','clip_name','anima\\text.safetensors'],['VAELoader','vae_name','anima\\vae.safetensors'],['LoraLoader','lora_name','anima\\style\\lora.safetensors']])schemas[type].input.required[key]=[[value]];
 const graph=buildWorkflow(p,schemas).graph;for(const node of Object.values(graph))for(const [key,definition]of Object.entries(schemas[node.class_type].input.required))assert.equal(node.inputs[key],definition[0][0]);assert.equal(p.model,'anima/model.safetensors');
 const unavailable={...p,model:'other/model.safetensors'};assert.equal(Object.values(buildWorkflow(unavailable,schemas).graph).find(n=>n.class_type==='UNETLoader').inputs.unet_name,'other/model.safetensors');
});
