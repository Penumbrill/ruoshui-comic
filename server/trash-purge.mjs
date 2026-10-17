import fs from 'node:fs/promises';
import path from 'node:path';
import {atomicJson,readJson} from './service.mjs';
import {referencedImages} from './project-related.mjs';

const uuid=/^[0-9a-f-]{36}$/i;
async function removeManaged(service,relative){
 const root=await fs.realpath(service.data),target=path.resolve(service.data,relative),part=path.relative(service.data,target);
 if(!part||part.startsWith('..')||path.isAbsolute(part))throw Error('回收文件路径无效');
 try{
  const parent=await fs.realpath(path.dirname(target));if(parent!==root&&!parent.startsWith(root+path.sep))throw Error('回收文件路径超出工作区');
  const stat=await fs.lstat(target);if(!stat.isSymbolicLink()){const resolved=await fs.realpath(target);if(!resolved.startsWith(root+path.sep))throw Error('回收文件路径超出工作区');}
  await fs.rm(target,{recursive:stat.isDirectory()&&!stat.isSymbolicLink(),force:true});
 }catch(error){if(error.code!=='ENOENT')throw error;}
}
export async function purgeTrash(service,{projectIds=[],imageIds=[],confirmed=false}={}){
 if(confirmed!==true)throw Error('永久删除需要确认');
 if(!Array.isArray(projectIds)||!Array.isArray(imageIds)||projectIds.length+imageIds.length>20000||[...projectIds,...imageIds].some(id=>typeof id!=='string'||!uuid.test(id)))throw Error('回收记录无效');
 if(service.jobs.some(job=>['queued','running','cancelling'].includes(job.status)))throw Error('请先完成或停止创作任务再清空回收区');
 const projects=new Set(projectIds),images=new Set(imageIds),entries=service.projectTrash.filter(item=>projects.has(item.id)),records=service.galleryTrash.filter(item=>!item.restoredAt&&images.has(item.id));
 if(entries.length!==projects.size||records.length!==images.size)throw Error('回收区已变动，请刷新后重试');
 const catalog=[...service.gallery,...service.galleryTrash.filter(item=>!item.restoredAt)],protectedIds=new Set();
 for(const index of service.projects)referencedImages(await service.readProject(index.id),catalog,protectedIds);
 for(const entry of service.projectTrash)if(!projects.has(entry.id))referencedImages(await readJson(path.join(service.data,'trash/projects',entry.file),{}),catalog,protectedIds);
 for(const image of service.gallery)referencedImages(image,catalog,protectedIds);
 for(const image of service.galleryTrash)if(!image.restoredAt&&!images.has(image.id))referencedImages(image,catalog,protectedIds);
 const removable=records.filter(item=>!protectedIds.has(item.id)),retained=records.filter(item=>protectedIds.has(item.id));
 for(const entry of entries)if(!new RegExp('^'+entry.id+'-\\d+\\.json$').test(entry.file))throw Error('回收记录无效');
 for(const item of removable)if(!/^(imports|output)\/[\w.-]+$/i.test(item.file))throw Error('回收图片路径无效');
 // Tombstones prevent stale autosaves from recreating permanently removed projects.
 const tombstones=new Set(await readJson(path.join(service.data,'trash/projects/purged.json'),[]));
 for(const entry of entries)tombstones.add(entry.id);
 await atomicJson(path.join(service.data,'trash/projects/purged.json'),[...tombstones]);
 for(const entry of entries){
  if(!new RegExp('^'+entry.id+'-\\d+\\.json$').test(entry.file))throw Error('回收记录无效');
  for(const suffix of ['','.bak','.tmp'])await removeManaged(service,'trash/projects/'+entry.file+suffix);
  await removeManaged(service,'trash/projects/assets/'+entry.file.slice(0,-5));
  await removeManaged(service,'project-assets/'+entry.id);
  service.deletedProjectIds.add(entry.id);
 }
 const purgedIds=new Set(removable.map(item=>item.id));
 for(const item of removable){
  if(!/^(imports|output)\/[\w.-]+$/i.test(item.file))throw Error('回收图片路径无效');
  // A shared physical file is retained even if two gallery identities use it.
  if(!catalog.some(other=>other.file===item.file&&!purgedIds.has(other.id)))await removeManaged(service,item.file);
  await removeManaged(service,'trash/images/'+item.id);
  for(const suffix of ['.json','.json.bak','.json.tmp'])await removeManaged(service,'output/'+item.id+suffix);
 }
 service.projectTrash=service.projectTrash.filter(item=>!projects.has(item.id));service.galleryTrash=service.galleryTrash.filter(item=>!purgedIds.has(item.id));
 await atomicJson(path.join(service.data,'trash/projects/index.json'),service.projectTrash);
 await atomicJson(path.join(service.data,'trash/images/index.json'),service.galleryTrash);
 // Atomic-write backups should not keep the records just permanently removed.
 for(const kind of ['projects','images'])await fs.copyFile(path.join(service.data,'trash',kind,'index.json'),path.join(service.data,'trash',kind,'index.json.bak'));
 await service.persist();service.emit('trash',{});
 return {deletedProjects:entries.length,deletedImages:removable.length,retainedImages:retained.length,projects:service.projectTrash,images:service.galleryTrash.filter(item=>!item.restoredAt)};
}
