import {makeProfile} from '../server/profiles.mjs';
export const assistantParameterDefaults=Object.freeze({context:8192,maxTokens:4096,gpuLayers:'auto',temperature:.65,unloadAfter:true,cacheType:null,reserveMiB:null,useDefaultQuality:true});
const basic=['width','height','steps','cfg','sampler','scheduler','seed','shift','batch','tiledDecode'];
export const loraDefaults=name=>({strength_model:/style40_no_trigger_recommended/i.test(name||'')?0.85:1,strength_clip:1,enabled:true});
export function resetProfileParameters(profile,group='all'){
 const defaults=makeProfile(profile.type);
 if(group==='all'||group==='basic'){for(const key of basic)profile[key]=defaults[key];for(const lora of profile.loras||[])Object.assign(lora,loraDefaults(lora.name));}
 for(const key of ['inpaint','face','hand','upscale'])if(group==='all'||group===key){const current=profile[key]||{};profile[key]={...defaults[key]};if(key==='inpaint')for(const name of ['positive','negative','sourceImageId','maskDraft'])if(Object.hasOwn(current,name))profile[key][name]=current[name];}
 return profile;
}
export function resetStudioParameters(config,project){
 for(const profile of Object.values(config.profiles||{}))resetProfileParameters(profile);
 for(const page of project?.pages||[])for(const panel of page.objects||[]){if(panel.generation?.params)resetProfileParameters(panel.generation.params);for(const profile of Object.values(panel.generation?.profiles||{}))resetProfileParameters(profile);}
 config.llm||={};Object.assign(config.llm,assistantParameterDefaults);for(const key of Object.keys(config.previewSizes||{}))config.previewSizes[key]={width:null,height:430,zoom:null};config.previewHeight=430;config.previewReference={enabled:true,opacity:.35};
}
export function parameterValue(object,key){return key.split('.').reduce((value,name)=>value?.[name],object);}
export function restoreParameter(object,key,value){const names=key.split('.');if(names.some(name=>['__proto__','constructor','prototype'].includes(name)))return;let target=object;for(const name of names.slice(0,-1))target=target[name]||(target[name]={});target[names.at(-1)]=value===undefined?undefined:structuredClone(value);}
