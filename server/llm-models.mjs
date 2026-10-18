import path from 'node:path';import fs from 'node:fs/promises';
import {networkFetch} from './network.mjs';import {hfJson} from './hf-network.mjs';import {searchPredicate} from '../shared/search.mjs';
export async function searchLlmModels(query,{fetcher=networkFetch}={}){
 const text=String(query||'').trim().slice(0,200),match=searchPredicate(text);
 const request=async search=>{const {data}=await hfJson('https://huggingface.co/api/models?'+new URLSearchParams({search,filter:'gguf',limit:'200',sort:'downloads',direction:'-1'}),{fetcher,validate:Array.isArray});return data;};
 const primary=await request(text),terms=text.split(/[\s/_-]+/).filter(t=>t&&!/^gguf$/i.test(t));let candidates=primary;
 if(terms.length>1&&primary.length<20)candidates=[...primary,...await request(terms[0])];
 return [...new Map(candidates.map(m=>[m.id,m])).values()].filter(m=>match(m.id)).slice(0,80).map(m=>({id:m.id,downloads:m.downloads,likes:m.likes}));
}
export const defaultLlmRepository='HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF';
export async function importLlmFolder(service,source){
 const target=service.folder('llm');await fs.mkdir(target,{recursive:true});let count=0;
 async function walk(dir,depth=0){if(depth>3)return;for(const entry of await fs.readdir(dir,{withFileTypes:true})){
  const file=path.join(dir,entry.name);if(entry.isSymbolicLink())continue;
  if(entry.isDirectory())await walk(file,depth+1);
  else if(entry.isFile()&&/\.gguf$/i.test(entry.name)){
   const destination=path.join(target,entry.name);if(path.resolve(file)===path.resolve(destination)){count++;continue;}
   const a=await fs.stat(file),b=await fs.stat(destination).catch(()=>null);
   if(b&&b.size!==a.size)throw Error('独立模型目录中有不同的同名文件：'+entry.name);
   if(!b){const temporary=destination+'.importing';await fs.copyFile(file,temporary);await fs.rename(temporary,destination);}count++;
  }
 }}await walk(source);if(!count)throw Error('此目录没有 GGUF 模型');
 await service.saveConfig({llm:{modelDirs:[target]}});return target;
}
