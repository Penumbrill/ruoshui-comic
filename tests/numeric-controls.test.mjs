import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {parse as parseSfc} from '@vue/compiler-sfc';
import {baseParse} from '@vue/compiler-dom';
import {installNumericWheel} from '../src/numeric-wheel.js';

const ratios=new Set(['page.cutoutOpacity??1','panel.imageScale','object.w/(object.cutoutBaseW||object.w)','object.opacity??1','page.bubbleLinks[object.linkGroup].strength','object.tailLength??.5','cutoutOptions.threshold','cutoutOptions.feather','cfg.detector_threshold','cfg.detector_crop_factor','compare','p.cfg','p.shift','p.inpaint.cfg','p.inpaint.denoise','p.inpaint.strength','p.inpaint.start_percent','p.inpaint.end_percent','c.temperature','prefs.opacity']);
function vueFiles(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?vueFiles(path.join(dir,entry.name)):entry.name.endsWith('.vue')?[path.join(dir,entry.name)]:[]);}

test('every numeric template control obeys its wheel category in both directions and requires focus',()=>{
 const original=globalThis.CustomEvent;globalThis.CustomEvent=class extends Event{};
 let controls=0;const components=new Set();
 try{for(const file of vueFiles('src')){
  const template=parseSfc(fs.readFileSync(file,'utf8')).descriptor.template;if(!template)continue;
  function walk(node){
   if(node.type===1){
    const props=Object.fromEntries(node.props.map(p=>[p.type===6?p.name:`${p.name}:${p.arg?.content||''}`,p.type===6?p.value?.content??'':p.exp?.content??'']));
    if(node.tag==='input'&&(['number','range'].includes(props.type)||'data-wheel-number' in props)){
     controls++;components.add(path.basename(file));
     const model=props['model:']??props['bind:value'];
     for(const featureStep of (props['bind:step']==='f.step'?[1,.1]:[null])){
      const attrs=Object.fromEntries(node.props.filter(p=>p.type===6).map(p=>[p.name,p.value?.content??'']));
      if(props['bind:step']){assert(['f.step','step'].includes(props['bind:step']),`${file}: unresolved step`);attrs.step=String(featureStep??1);}
      if(props['bind:data-wheel-step']){assert.equal(props['bind:data-wheel-step'],'f.wheelStep');attrs['data-wheel-step']=String(featureStep);}
      if(featureStep===1)attrs['data-wheel-integer']='';
      const step=featureStep??(/^lora\.strength_/.test(model)?.01:['p.width','p.height'].includes(model)?32:ratios.has(model)?.1:1);
      // Native range inputs snap assigned values to their declared HTML step.
      // A coarser range step would silently discard the global wheel increment.
      if(attrs.type==='range'&&attrs.step!=='any')assert(Math.abs(step/Number(attrs.step??1)-Math.round(step/Number(attrs.step??1)))<1e-8,`${file}: ${model} native range must accept its wheel increment`);
      const minimum=Number(attrs.min??attrs['data-wheel-min']??0),maximum=Number(attrs.max??attrs['data-wheel-max']??10000);
      const base=Math.max(minimum,Math.min(maximum-step,Math.round((minimum+maximum)/2)));
      const listeners={},root={activeElement:null,addEventListener:(name,fn)=>listeners[name]=fn,removeEventListener(){}},events=[];
      const input={value:String(base),ownerDocument:root,disabled:false,readOnly:false,getAttribute:name=>attrs[name]??null,dispatchEvent:event=>events.push(event.type)};
      const dispose=installNumericWheel(root);
      function wheel(deltaY){const event={target:{closest:()=>input},deltaY,deltaMode:0,preventDefault(){this.prevented=true;},stopPropagation(){}};listeners.wheel(event);return event;}
      assert(!wheel(-100).prevented,`${file}: ${model} unfocused`);assert.equal(input.value,String(base));
      root.activeElement=input;assert(wheel(-100).prevented);
      assert.equal(Number(input.value),Number((base+step).toFixed(10)),`${file}: ${model} increment`);
      wheel(100);assert.equal(Number(input.value),base,`${file}: ${model} decrement`);
      assert(events.includes('input')&&events.includes('change'),`${file}: ${model} binding events`);dispose();
     }
    }
   }
   for(const child of node.children||[])walk(child);
  }
  walk(baseParse(template.content));
 }
 assert(controls>=50,'All numeric templates must be audited');
 for(const name of ['Generation.vue','ComicEditor.vue','FeatureParams.vue','NumberControl.vue','LlmSettings.vue','CacheSettings.vue','CutoutEditor.vue','DecorationPicker.vue','PanelImageEditor.vue','PromptAssistant.vue','ReferenceOverlayControls.vue'])assert(components.has(name),name);
 }finally{globalThis.CustomEvent=original;}
});
