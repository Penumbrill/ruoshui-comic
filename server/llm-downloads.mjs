import fs from 'node:fs/promises';
import path from 'node:path';
import {atomicJson,readJson} from './service.mjs';
import {matchingProjectors} from '../shared/llm-recommendation.mjs';

const recordPath=service=>path.join(service.data,'assistant/model-downloads.json');
const safeName=name=>typeof name==='string'&&name===path.basename(name)&&!name.includes('\\')&&!name.includes('/')&&/\.gguf$/i.test(name);
export async function registerLlmDownload(service,selection,items){
 if(!selection.model)return;
 const record=await readJson(recordPath(service),{pairs:{}});
 const entry={modelName:path.basename(selection.model.name),projectorName:selection.projector?path.basename(selection.projector.name):'',files:items};
 record.pairs||={};record.pairs[entry.modelName]=entry;record.pending=entry;
 await atomicJson(recordPath(service),record);
}
export async function completeLlmDownload(service){
 const record=await readJson(recordPath(service),{pairs:{}}),pending=record.pending;
 if(!pending||!safeName(pending.modelName)||pending.projectorName&&!safeName(pending.projectorName))return false;
 for(const item of pending.files||[]){
  if(!/^llm\/[^/\\]+\.gguf$/i.test(item.target))return false;
  const file=path.join(service.folder('models'),item.target);
  try{
   const stat=await fs.stat(file,{bigint:true}),receipt=JSON.parse(await fs.readFile(file+'.verified.json','utf8'));
   if(stat.size!==BigInt(item.size)||receipt.sha256!==item.sha256||!Number.isFinite(receipt.mtime_ns))return false;
   const difference=stat.mtimeNs-BigInt(Math.trunc(receipt.mtime_ns));if(difference>1000000n||difference< -1000000n)return false;
  }catch{return false;}
 }
 if(!pending.files?.length)return false;
 const folder=service.folder('llm'),selection={model:path.join(folder,pending.modelName),mmproj:pending.projectorName?path.join(folder,pending.projectorName):'',modelDirs:[folder]};
 await service.saveConfig({llm:selection});delete record.pending;await atomicJson(recordPath(service),record);
 service.emit('llm-download',selection);return true;
}
export async function modelProjectorLinks(service,models){
 const record=await readJson(recordPath(service),{pairs:{}}),links={};
 for(const model of models.filter(m=>!m.mmproj)){
  const registered=record.pairs?.[model.name];
  if(registered){const found=models.find(m=>m.mmproj&&m.name===registered.projectorName);if(found)links[model.path]=found.path;continue;}
  const candidate=matchingProjectors(models,model.name)[0];if(candidate)links[model.path]=candidate.path;
 }
 return links;
}
