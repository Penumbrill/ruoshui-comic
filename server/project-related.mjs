import fs from 'node:fs/promises';
import path from 'node:path';

// Follow image identities and source chains, rather than deleting by filename.
export function referencedImages(value,gallery,ids=new Set()){
 const byId=new Map(gallery.map(item=>[item.id,item]));
 const byFile=new Map(gallery.filter(item=>item.file).map(item=>[item.file,item.id]));
 function visit(part){
  if(typeof part==='string'){
   const id=byId.has(part)?part:part.match(/^\/api\/files\/([0-9a-f-]{36})(?:[?#].*)?$/i)?.[1]||byFile.get(part);
   if(id&&byId.has(id)&&!ids.has(id)){ids.add(id);visit(byId.get(id));}
  }else if(Array.isArray(part)){for(const child of part)visit(child);}
  else if(part&&typeof part==='object'){for(const child of Object.values(part))visit(child);}
 }
 visit(value);return ids;
}
export async function projectRelatedImages(service,project){
 const related=referencedImages(project,service.gallery),protectedIds=new Set();
 for(const item of service.gallery)if(item.target?.projectId===project.id)referencedImages(item,service.gallery,related);
 for(const index of service.projects)if(index.id!==project.id)referencedImages(await service.readProject(index.id),service.gallery,protectedIds);
 // A project in the recycle bin may still need shared images when restored.
 for(const entry of service.projectTrash)if(entry.id!==project.id){
  const file=path.join(service.data,'trash/projects',entry.file);
  try{referencedImages(JSON.parse(await fs.readFile(file,'utf8')),service.gallery,protectedIds);}catch(error){if(error.code!=='ENOENT')throw error;}
 }
 for(const item of service.gallery)if(item.target?.projectId&&item.target.projectId!==project.id)referencedImages(item,service.gallery,protectedIds);
 const ids=[...related].filter(id=>!protectedIds.has(id));
 if(service.jobs.some(job=>['queued','running','cancelling'].includes(job.status)&&(ids.includes(job.imageId)||ids.includes(job.resultId))))throw Error('关联图片仍有任务，请先停止任务再删除');
 return {ids,retained:[...related].filter(id=>protectedIds.has(id))};
}
function safeDataPath(service,relative){
 const resolved=path.resolve(service.data,relative),inside=path.relative(service.data,resolved);
 if(!inside||inside.startsWith('..')||path.isAbsolute(inside))throw Error('关联文件路径无效');
 return resolved;
}
async function move(service,from,to){
 const source=safeDataPath(service,from),target=safeDataPath(service,to);
 try{await fs.mkdir(path.dirname(target),{recursive:true});await fs.rename(source,target);}catch(error){if(error.code!=='ENOENT')throw error;}
}
export function relatedFileMoves(service,id,ids,stem){
 // The gallery recycle ledger owns image files. Keep their paths stable so
 // restoring a single image and trash thumbnails work independently of projects.
 return [[`project-assets/${id}`,`trash/projects/assets/${stem}/project-assets`]];
}
export async function moveRelatedFiles(service,moves,restore=false){for(const [from,to] of moves||[])await move(service,restore?to:from,restore?from:to);}
export function takeProjectScopes(config,id){
 const scopes={};for(const field of ['quickPromptDrafts','promptHistory','disabledPromptTags','previewSizes'])for(const [key,value] of Object.entries(config[field]||{}))if(key.split(':').includes(id)){(scopes[field]||={})[key]=structuredClone(value);delete config[field][key];}
 return scopes;
}
export function restoreProjectScopes(config,scopes){for(const [field,values] of Object.entries(scopes||{}))for(const [key,value] of Object.entries(values)){config[field]||={};config[field][key]??=value;}}
