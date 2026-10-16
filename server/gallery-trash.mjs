import path from 'node:path';
import {atomicJson,readJson} from './service.mjs';
import {collectImageMetadata,applyImageMetadataChange} from './image-metadata.mjs';

// The ledger is written before the gallery index, so an interrupted save can
// be reconciled on startup. Image files remain available to existing projects.
export async function loadGalleryTrash(service){
 service.galleryTrash=await readJson(path.join(service.data,'trash/images/index.json'),[]);
 const records=new Map(service.galleryTrash.map(item=>[item.id,item]));
 service.gallery=service.gallery.filter(item=>!records.has(item.id)||records.get(item.id).restoredAt);
 for(const item of records.values())if(item.restoredAt&&!service.gallery.some(image=>image.id===item.id))service.gallery.unshift(cleanItem(item));
 const deleted=service.galleryTrash.filter(item=>!item.restoredAt);for(const item of deleted)if(!item.metadata)item.metadata=await collectImageMetadata(service,item);
 if(deleted.length){await atomicJson(path.join(service.data,'trash/images/index.json'),service.galleryTrash);await applyImageMetadataChange(service,deleted);}
}
function cleanItem({deletedAt,restoredAt,metadata,...item}){return item;}
export function changeGalleryTrash(service,ids,restore=false){
 const pending=(service.galleryMutationChain||Promise.resolve()).catch(()=>{}).then(async()=>{
  if(!Array.isArray(ids)||!ids.length||ids.length>1000||ids.some(id=>typeof id!=='string'||!id))throw Error('请选择 1 至 1000 张图片');
  const unique=new Set(ids),source=restore?service.galleryTrash.filter(item=>!item.restoredAt):service.gallery;
  const items=[...unique].map(id=>source.find(item=>item.id===id));
  if(items.some(item=>!item))throw Error('部分图片已变动，请刷新画廊后重试');
  if(!restore&&service.jobs.some(job=>['queued','running','cancelling'].includes(job.status)&&(unique.has(job.imageId)||unique.has(job.resultId))))throw Error('所选图片仍用于未完成的重绘任务，请完成或停止任务后再删除');
  const now=new Date().toISOString(),records=new Map(service.galleryTrash.map(item=>[item.id,item]));
  for(const item of items)records.set(item.id,restore?{...item,restoredAt:now}:{...item,metadata:await collectImageMetadata(service,item),deletedAt:now,restoredAt:null});
  const ledger=[...records.values()];
  await atomicJson(path.join(service.data,'trash/images/index.json'),ledger);
  service.galleryTrash=ledger;
  await applyImageMetadataChange(service,items.map(item=>records.get(item.id)),restore);
  if(restore){for(const item of items)if(!service.gallery.some(image=>image.id===item.id))service.gallery.push(cleanItem(item));service.gallery.sort((a,b)=>String(b.created).localeCompare(String(a.created)));}
  else service.gallery=service.gallery.filter(item=>!unique.has(item.id));
  await service.persist();service.emit('gallery',service.gallery);
  return {count:items.length,gallery:service.gallery,trash:service.galleryTrash.filter(item=>!item.restoredAt)};
 });service.galleryMutationChain=pending;return pending;
}
