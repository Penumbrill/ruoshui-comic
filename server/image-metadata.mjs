import fs from 'node:fs/promises';import path from 'node:path';
import {stripProjectImageMetadata,restoreProjectImageMetadata,stripConfigImageMetadata,restoreConfigImageMetadata} from '../shared/image-metadata.mjs';
export async function collectImageMetadata(service,item){
 const ids=new Set([item.id]),config=structuredClone(service.config),projects=[];
 for(const index of service.projects){const project=await service.readProject(index.id).catch(()=>null);if(project){const entries=stripProjectImageMetadata(project,ids);if(entries.length)projects.push({projectId:project.id,entries});}}
 const scopes=projects.flatMap(project=>project.entries.map(entry=>'panel:'+project.projectId+':'+entry.panelId));return{jobs:service.jobs.filter(j=>j.resultId===item.id),config:stripConfigImageMetadata(config,ids,scopes),projects,scopes};
}
export async function applyImageMetadataChange(service,items,restore=false){
 const ids=new Set(items.map(i=>i.id));
 if(restore){
  for(const item of items){const metadata=item.metadata||{};for(const job of metadata.jobs||[])if(!service.jobs.some(j=>j.id===job.id))service.jobs.push(job);restoreConfigImageMetadata(service.config,metadata.config);
   for(const entry of metadata.projects||[]){const project=await service.readProject(entry.projectId).catch(()=>null);if(project){restoreProjectImageMetadata(project,entry.entries);await service.saveProject(project);}}
  }
 }else{
  service.jobs=service.jobs.filter(job=>!ids.has(job.resultId));stripConfigImageMetadata(service.config,ids,items.flatMap(item=>item.metadata?.scopes||[]));
  for(const index of service.projects){const project=await service.readProject(index.id).catch(()=>null);if(project){const removed=stripProjectImageMetadata(project,ids);if(removed.length)await service.saveProject(project);}}
 }
 // Sidecars and masks travel with the image's recycle record, never stay orphaned.
 for(const item of items){if(!/^[0-9a-f-]{36}$/i.test(item.id))continue;const backup=path.join(service.data,'trash/images',item.id);await fs.mkdir(backup,{recursive:true});const moves=['.json','.json.bak','.json.tmp'].map(ext=>[path.join(service.data,'output',item.id+ext),path.join(backup,'metadata'+ext)]);
  for(const job of item.metadata?.jobs||[])if(job.maskFile&&!service.jobs.some(other=>other.id!==job.id&&other.maskFile===job.maskFile))moves.push([path.join(service.data,'imports',path.basename(job.maskFile)),path.join(backup,path.basename(job.maskFile))]);
  for(const [original,trashed] of moves){const from=restore?trashed:original,to=restore?original:trashed;try{await fs.rename(from,to);}catch(error){if(error.code!=='ENOENT')throw error;}}
 }
 await service.saveConfig({});service.emit('jobs',service.jobs);service.emit('image-metadata',{ids:[...ids],restore,items:items.map(item=>({id:item.id,metadata:item.metadata}))});
}
