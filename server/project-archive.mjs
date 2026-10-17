import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import yauzl from 'yauzl';
import {FontCatalog,validateFont} from './fonts.mjs';

const limit=512*1024*1024,sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const crcTable=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(bytes){let value=0xffffffff;for(const b of bytes)value=crcTable[(value^b)&255]^(value>>>8);return(value^0xffffffff)>>>0;}
const safe=name=>typeof name==='string'&&/^(manifest|project|session)\.json$|^(images|fonts)\/[a-f0-9]{64}\.(png|jpg|jpeg|webp|ttf|otf|woff|woff2)$/.test(name)&&!name.includes('..');

// Images and fonts are already compressed. Stored ZIP entries avoid another large
// compression job while remaining readable by ordinary archive applications.
export function projectZip(entries){
 const local=[],central=[];let offset=0;
 for(const [name,bytes] of entries){
  if(!safe(name))throw Error('项目压缩包路径无效');
  const filename=Buffer.from(name),crc=crc32(bytes),head=Buffer.alloc(30),tail=Buffer.alloc(46);
  head.writeUInt32LE(0x04034b50);head.writeUInt16LE(20,4);head.writeUInt16LE(0x800,6);head.writeUInt16LE(33,12);head.writeUInt32LE(crc,14);head.writeUInt32LE(bytes.length,18);head.writeUInt32LE(bytes.length,22);head.writeUInt16LE(filename.length,26);
  tail.writeUInt32LE(0x02014b50);tail.writeUInt16LE(20,4);tail.writeUInt16LE(20,6);tail.writeUInt16LE(0x800,8);tail.writeUInt16LE(33,14);tail.writeUInt32LE(crc,16);tail.writeUInt32LE(bytes.length,20);tail.writeUInt32LE(bytes.length,24);tail.writeUInt16LE(filename.length,28);tail.writeUInt32LE(offset,42);
  local.push(head,filename,bytes);central.push(tail,filename);offset+=head.length+filename.length+bytes.length;
  if(offset>limit)throw Error('项目压缩包超过 512 MB，请拆分为多个项目');
 }
 const end=Buffer.alloc(22),directory=Buffer.concat(central);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.size,8);end.writeUInt16LE(entries.size,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...local,directory,end]);
}

export async function readProjectZip(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length>limit)throw Error('项目压缩包超过 512 MB');
 const zip=await new Promise((resolve,reject)=>yauzl.fromBuffer(bytes,{lazyEntries:true,strictFileNames:true,validateEntrySizes:true},(error,value)=>error?reject(error):resolve(value)));
 return new Promise((resolve,reject)=>{
  const entries=new Map();let total=0,failed=false;
  const fail=error=>{if(failed)return;failed=true;zip.close();reject(error);};zip.on('error',fail);zip.on('end',()=>{if(!failed)resolve(entries);});
  zip.on('entry',entry=>{
   if(!safe(entry.fileName)||entries.has(entry.fileName)||entry.generalPurposeBitFlag&1||((entry.externalFileAttributes>>>16)&0xf000)===0xa000||entries.size>=20000||(total+=entry.uncompressedSize)>limit)return fail(Error('项目压缩包含无效、重复或过大的文件'));
   zip.openReadStream(entry,(error,stream)=>{if(error)return fail(error);const chunks=[];stream.on('error',fail);stream.on('data',chunk=>chunks.push(chunk));stream.on('end',()=>{const content=Buffer.concat(chunks);if(crc32(content)!==entry.crc32)return fail(Error('项目文件校验失败'));entries.set(entry.fileName,content);zip.readEntry();});});
  });zip.readEntry();
 });
}

async function mapTree(value,transform,key=''){
 if(typeof value==='string')return transform(value,key);
 if(Array.isArray(value))return Promise.all(value.map(item=>mapTree(item,transform,key)));
 if(value&&typeof value==='object'){const result={};for(const [name,item] of Object.entries(value)){if(['__proto__','prototype','constructor'].includes(name))throw Error('项目数据无效');result[name]=await mapTree(item,transform,name);}return result;}
 return value;
}
function validateProject(project){
 if(!project||typeof project.name!=='string'||!Array.isArray(project.pages)||!project.pages.length||project.pages.length>100)throw Error('项目格式不正确');
 for(const page of project.pages){if(!Number.isFinite(page.width)||!Number.isFinite(page.height)||page.width<128||page.height<128||page.width>8192||page.height>8192||!Array.isArray(page.objects)||page.objects.length>500)throw Error('画布数据无效');for(const item of page.objects)if(!['panel','text','bubble','sticker','stroke'].includes(item.kind))throw Error('未知图层类型');}
}
function imageExtension(bytes){if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return'png';if(bytes[0]===255&&bytes[1]===216)return'jpg';if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return'webp';throw Error('项目中的图片损坏');}

export async function exportProjectArchive(service,id){
 const project=structuredClone(await service.readProject(id));validateProject(project);
 const entries=new Map(),assets=[],images=new Map();
 const add=(kind,bytes,extension,details={})=>{const name=kind+'/'+sha(bytes)+'.'+extension;if(!entries.has(name)){entries.set(name,bytes);assets.push({path:name,size:bytes.length,sha256:sha(bytes),kind,...details});}return name;};
 const capture=async item=>{
  if(images.has(item.id))return images.get(item.id);
  // Reserve before traversing metadata, which may refer back to this image.
  const record={id:item.id};images.set(item.id,record);
  const bytes=await fs.readFile(service.filePath(item.file));record.path=add('images',bytes,imageExtension(bytes));
  const {file,url,...metadata}=item;record.metadata=await mapTree(metadata,replace);return record;
 };
 async function replace(value){
  if(value.startsWith('/api/files/')){const item=service.findImage(value.slice(11));if(!item)throw Error('项目引用的图片不存在，请先恢复原图');await capture(item);return'archive-image:'+item.id;}
  const inline=value.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/s);if(inline){const bytes=Buffer.from(inline[2],'base64');return'archive:'+add('images',bytes,imageExtension(bytes));}
  const item=/^[0-9a-f-]{36}$/.test(value)&&service.findImage(value);if(item)await capture(item);return value;
 }
 let document=await mapTree(project,replace);
 // Candidate images and their source chains belong to the project even when
 // they are not currently displayed on a panel.
 for(const item of service.gallery)if(item.target?.projectId===id)await capture(item);
 const session={cutoutDrafts:{},scopes:{},workspace:{panelSizes:Object.fromEntries(Object.entries(service.config.panelSizes||{}).filter(([key])=>/^(comic|panel-generator|panel-image|cutout)(:|$)/.test(key))),previewReference:service.config.previewReference||{}}};
 for(const [key,value] of Object.entries(service.config.cutoutDrafts||{}))if(images.has(key))session.cutoutDrafts[key]=value;
 for(const field of ['quickPromptDrafts','promptHistory','disabledPromptTags','previewSizes'])for(const [key,value] of Object.entries(service.config[field]||{}))if(key.includes(id))(session.scopes[field]||={})[key]=value;
 const state=await mapTree(session,replace),catalog=service.fontCatalog||=new FontCatalog(service),fonts=[];
 const families=new Set(project.pages.flatMap(page=>page.objects.map(item=>item.fontFamily)).filter(Boolean));
 for(const item of (await catalog.entries()).filter(item=>families.has(item.family))){const {bytes}=await catalog.file(item.id);fonts.push({family:item.family,name:item.label+path.extname(item.file),path:add('fonts',bytes,path.extname(item.file).slice(1))});}
 for(const font of project.embeddedFonts||[]){const {bytes,extension}=validateFont(font.name,font.base64);fonts.push({family:font.family,name:font.name,path:add('fonts',bytes,extension.slice(1))});}
 delete document.embeddedFonts;delete document.portableState;
 entries.set('project.json',Buffer.from(JSON.stringify(document)));entries.set('session.json',Buffer.from(JSON.stringify(state)));
 const manifest={format:'ruoshui-project',version:1,project:'project.json',assets,images:[...images.values()],fonts};
 manifest.documents=['project.json','session.json'].map(name=>({path:name,size:entries.get(name).length,sha256:sha(entries.get(name))}));
 entries.set('manifest.json',Buffer.from(JSON.stringify(manifest,null,2)));return projectZip(entries);
}

export async function importProjectArchive(service,bytes){
 const entries=await readProjectZip(bytes);let manifest,project,session;
 try{manifest=JSON.parse(entries.get('manifest.json'));project=JSON.parse(entries.get('project.json'));session=JSON.parse(entries.get('session.json'));}catch{throw Error('这不是完整的若水漫画项目压缩包');}
 if(manifest.format!=='ruoshui-project'||manifest.version!==1||!Array.isArray(manifest.assets)||!Array.isArray(manifest.documents)||!Array.isArray(manifest.images)||!Array.isArray(manifest.fonts))throw Error('项目压缩包格式不支持');validateProject(project);
 const names=new Set(['manifest.json']);for(const record of [...manifest.assets,...manifest.documents]){const content=entries.get(record.path);if(names.has(record.path)||!content||record.size!==content.length||record.sha256!==sha(content))throw Error('项目文件缺失或校验失败');names.add(record.path);}
 if(names.size!==entries.size)throw Error('项目压缩包含未登记的文件');
 for(const item of manifest.assets){if(item.kind==='images')imageExtension(entries.get(item.path));else if(item.kind==='fonts')validateFont(item.path,entries.get(item.path).toString('base64'));else throw Error('项目资源类型无效');}
 for(const item of manifest.images)if(!entries.has(item.path)||!item.path.startsWith('images/')||typeof item.id!=='string')throw Error('项目图片清单无效');
 for(const item of manifest.fonts)if(!entries.has(item.path)||!item.path.startsWith('fonts/')||typeof item.family!=='string')throw Error('项目字体清单无效');
 await mapTree([project,session,manifest.images],value=>{if(value.startsWith('archive:')&&!entries.has(value.slice(8))||value.startsWith('archive-image:')&&!manifest.images.some(item=>item.id===value.slice(14))||value.startsWith('/api/files/'))throw Error('项目资源引用缺失');return value;});
 const originalId=project.id,newId=crypto.randomUUID(),urls=new Map(),ids=new Map([[originalId,newId]]),families=new Map(),catalog=service.fontCatalog||=new FontCatalog(service);
 for(const item of manifest.assets.filter(item=>item.kind==='images')){const image=await service.importImage({name:path.basename(item.path),base64:entries.get(item.path).toString('base64')});urls.set(item.path,image);}
 const originals=new Map(),usedPaths=new Set();
 for(const item of manifest.images){const image=usedPaths.has(item.path)?await service.importImage({name:path.basename(item.path),base64:entries.get(item.path).toString('base64')}):urls.get(item.path);usedPaths.add(item.path);originals.set(item.id,image);ids.set(item.id,image.id);}
 for(const item of manifest.fonts){const font=await catalog.import({name:item.name,base64:entries.get(item.path).toString('base64')});families.set(item.family,font.family);}
 const restore=value=>{if(value.startsWith('archive-image:'))return originals.get(value.slice(14)).url;if(value.startsWith('archive:')){const image=urls.get(value.slice(8));if(!image)throw Error('项目资源引用缺失');return image.url;}return ids.get(value)||families.get(value)||value;};
 for(const item of manifest.images){const image=originals.get(item.id),metadata=await mapTree(item.metadata,restore);const {id,file,url,...details}=metadata;Object.assign(image,details);image.imported=metadata.imported===true;}
 project=await mapTree(project,restore);project.id=newId;session=await mapTree(session,restore);
 session.cutoutDrafts=Object.fromEntries(Object.entries(session.cutoutDrafts||{}).map(([id,value])=>[ids.get(id)||id,value]));
 for(const [field,values] of Object.entries(session.scopes||{}))session.scopes[field]=Object.fromEntries(Object.entries(values).map(([key,value])=>[key.replaceAll(originalId,newId),value]));
 project.portableState=session;
 for(const [id,value] of Object.entries(session.cutoutDrafts||{}))(service.config.cutoutDrafts||={})[ids.get(id)||id]=value;
 for(const [field,values] of Object.entries(session.scopes||{}))for(const [key,value] of Object.entries(values))(service.config[field]||={})[key.replaceAll(originalId,newId)]=value;
 service.config.panelSizes={...service.config.panelSizes,...session.workspace?.panelSizes};if(session.workspace?.previewReference)service.config.previewReference=session.workspace.previewReference;
 const folder=path.join(service.data,'project-assets',newId);await fs.mkdir(folder,{recursive:true});
 // Keep the portable source beside the restored engineering document, so all
 // related resources remain available independently of the original installation.
 await fs.writeFile(path.join(folder,'project.ruoshui.zip'),bytes);
 await service.persist();await service.saveConfig({});return service.saveProject(project);
}
