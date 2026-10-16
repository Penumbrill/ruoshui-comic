import fs from 'node:fs/promises';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {execFile,spawn} from 'node:child_process';
import crypto from 'node:crypto';
import {applyTagAction,selectTagSubset} from './tag-actions.mjs';
import {promisify} from 'node:util';
import {flattenTagLibrary,validateTagLibrary,libraryFromGroups,mergeTagLibraries,tagLibrarySQL} from '../shared/tag-library.mjs';
const execute=promisify(execFile);
export class TagLibrary{
 constructor(service){this.service=service;this.file=path.join(service.data,'weilin/tag-library.json');this.previews=new Map();}
 worker(mode,payload){const s=this.service,bundle=s.bundle.replace('app.asar','app.asar.unpacked');return new Promise((resolve,reject)=>{const child=spawn(path.join(s.runtime,'python/python.exe'),['-I',path.join(bundle,'assets/weilin_tags_io.py'),mode,path.join(s.data,'weilin/user_data/userdatas_zh_CN_tags.db')],{windowsHide:true});let stdout='',stderr='';const timeout=setTimeout(()=>{child.kill();reject(Error('词库操作超时，现有词库已保留'));},20000);child.on('error',error=>{clearTimeout(timeout);reject(error);});child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.stdin.on('error',()=>{});child.on('exit',code=>{clearTimeout(timeout);if(code!==0)return reject(Error('词库操作未完成：'+stderr.slice(-500)));try{resolve(validateTagLibrary(JSON.parse(stdout)));}catch(error){reject(error);}});child.stdin.end(JSON.stringify(payload));});}
 async previewImport({format,contents}){
  if(typeof contents!=='string'||Buffer.byteLength(contents)>16*1024*1024)throw Error('请选择不超过 16 MB 的词库文件');
  let library,personal;
  if(format==='sql')library=await this.worker('decode-sql',{contents});
  else if(format==='json'){const parsed=JSON.parse(contents.replace(/^\uFEFF/,''));library=Array.isArray(parsed)?libraryFromGroups(parsed):validateTagLibrary(parsed);personal=parsed.personal;}
  else throw Error('请选择词库 SQL 或完整词库 JSON 文件');
  if(personal&&(!Array.isArray(personal.customTags||[])||(personal.customTags||[]).some(t=>typeof t.en!=='string'||typeof t.zh!=='string')||!Array.isArray(personal.favoriteTags||[])||(personal.favoriteTags||[]).some(t=>typeof t!=='string')))throw Error('自定义标签或收藏格式无效，本次未更改词库');
  if(!library.counts.tags)throw Error('文件中没有标签，本次未更改词库');
  for(const [key,value]of this.previews)if(value.expires<Date.now())this.previews.delete(key);
  if(this.previews.size>=4)this.previews.delete(this.previews.keys().next().value);
  const token=crypto.randomUUID();this.previews.set(token,{library,personal,expires:Date.now()+15*60000});return{token,counts:library.counts,personalTags:personal?.customTags?.length||0};
 }
 async import({token,mode='merge'}){
  if(this.importing)throw Error('词库正在导入，请稍候');
  const preview=this.previews.get(token);if(!preview||preview.expires<Date.now())throw Error('导入预览已过期，请重新选择文件');if(!['merge','replace'].includes(mode))throw Error('未知词库导入方式');
  this.importing=true;
  try{const existing=await this.load(),library=mode==='merge'?mergeTagLibraries(existing,preview.library):preview.library,{atomicJson}=await import('./service.mjs');
   const backup=path.join(this.service.data,'weilin/backups',`tags-${Date.now()}-${crypto.randomUUID()}.json`);await atomicJson(backup,{version:1,groups:existing.groups,counts:existing.counts,personal:{customTags:this.service.config.customTags||[],favoriteTags:this.service.config.favoriteTags||[]}});
   const saved=await this.worker('write',library);await atomicJson(this.file,saved);this.value={...saved,tags:flattenTagLibrary(saved)};
   if(preview.personal){const customTags=preview.personal.customTags||[],favoriteTags=preview.personal.favoriteTags||[];await this.service.saveConfig({customTags:mode==='replace'?customTags:[...new Map([...(this.service.config.customTags||[]),...customTags].map(t=>[t.en,t])).values()],favoriteTags:mode==='replace'?favoriteTags:[...new Set([...(this.service.config.favoriteTags||[]),...favoriteTags])]});}
   this.previews.delete(token);this.service.emit('tag-library',this.value);return{library:this.value,backup,personal:{customTags:this.service.config.customTags||[],favoriteTags:this.service.config.favoriteTags||[]}};
  }finally{this.importing=false;}
 }
 async mutate(request){
  if(this.importing)throw Error('词库正在保存，请稍候');this.importing=true;
  try{const existing=await this.load(),adopted=this.withLegacyCustom(existing),mapped={...request,id:adopted.ids.get(request.id)||request.id,referenceId:adopted.ids.get(request.referenceId)||request.referenceId,ids:request.ids?.map(id=>adopted.ids.get(id)||id)},library=applyTagAction(adopted.library,mapped),backup=await this.backup(existing),saved=await this.worker('write',library),{atomicJson}=await import('./service.mjs');await atomicJson(this.file,saved);this.value={...saved,tags:flattenTagLibrary(saved)};if(adopted.ids.size)await this.service.saveConfig({customTags:[]});this.service.emit('tag-library',this.value);return{library:this.value,backup,personal:{customTags:this.service.config.customTags||[],favoriteTags:this.service.config.favoriteTags||[]}};}finally{this.importing=false;}
 }
 withLegacyCustom(library){const groups=structuredClone(library.groups),ids=new Map(),custom=this.service.config.customTags||[];if(!custom.length)return{library,ids};let category=groups.find(c=>c.p_uuid==='custom');if(!category){category={name:'自定义',color:'#7954d9',p_uuid:'custom',create_time:Date.now(),groups:[]};groups.push(category);}let group=category.groups.find(g=>g.g_uuid==='custom');if(!group){group={name:'自定义标签',color:'#7954d9',p_uuid:'custom',g_uuid:'custom',create_time:Date.now(),tags:[]};category.groups.push(group);}custom.forEach((tag,i)=>{let record=group.tags.find(t=>t.text===tag.en&&t.desc===tag.zh);if(!record){record={text:tag.en,desc:tag.zh,t_uuid:crypto.randomUUID(),g_uuid:'custom',create_time:Date.now()-i,color:'#7954d9'};group.tags.push(record);}ids.set('custom-'+i,record.t_uuid);});return{library:libraryFromGroups(groups),ids};}
 async backup(library){const {atomicJson}=await import('./service.mjs'),backup=path.join(this.service.data,'weilin/backups',`tags-${Date.now()}-${crypto.randomUUID()}.json`);await atomicJson(backup,{version:1,groups:library.groups,counts:library.counts,personal:{customTags:this.service.config.customTags||[],favoriteTags:this.service.config.favoriteTags||[]}});return backup;}
 async backups(){const dir=path.join(this.service.data,'weilin/backups');let names=[];try{names=(await fs.readdir(dir)).filter(name=>/^tags-\d+-[a-f\d-]+\.json$/.test(name)).sort().reverse();}catch{}return names.map(name=>({id:name,created:new Date(Number(name.split('-')[1])).toISOString()}));}
 async previewBackup(id){if(typeof id!=='string'||!/^tags-\d+-[a-f\d-]+\.json$/.test(id))throw Error('备份不存在');const contents=await fs.readFile(path.join(this.service.data,'weilin/backups',id),'utf8');return this.previewImport({format:'json',contents});}
 async share({ids,format='sql'}){if(!Array.isArray(ids))throw Error('请选择标签');const adopted=this.withLegacyCustom(await this.load()),library=selectTagSubset(adopted.library,ids.map(id=>adopted.ids.get(id)||id));if(format==='json')return{name:'若水漫画-所选标签.json',contents:JSON.stringify(library,null,2)};if(format==='sql')return{name:'若水漫画-所选标签.sql',contents:tagLibrarySQL(library)};throw Error('请选择 JSON 或 SQL 分享格式');}
 async export(format='json'){
  const current=await this.load(),library={version:1,groups:current.groups,counts:current.counts,personal:{customTags:this.service.config.customTags||[],favoriteTags:this.service.config.favoriteTags||[]}};
  if(format==='json')return{name:'若水漫画-完整标签词库.json',contents:JSON.stringify(library,null,2)};
  if(format==='sql'){
   const groups=structuredClone(library.groups),custom=library.personal.customTags;
   if(custom.length){const p_uuid=crypto.randomUUID(),g_uuid=crypto.randomUUID();groups.push({name:'自定义',p_uuid,color:'#7954d9',create_time:Date.now(),groups:[{name:'自定义标签',g_uuid,p_uuid,color:'#7954d9',create_time:Date.now(),tags:custom.map((tag,i)=>({text:tag.en,desc:tag.zh,t_uuid:crypto.randomUUID(),g_uuid,create_time:custom.length-i,color:'#7954d9'}))}]});}
   return{name:'若水漫画-完整标签词库.sql',contents:tagLibrarySQL(libraryFromGroups(groups))};
  }
  throw Error('未知导出格式');
 }
 async readDatabase(database){const s=this.service,bundle=s.bundle.replace('app.asar','app.asar.unpacked');const {stdout}=await execute(path.join(s.runtime,'python/python.exe'),['-I',path.join(bundle,'assets/export_weilin_tags.py'),database],{windowsHide:true,timeout:20000,maxBuffer:16*1024*1024});return validateTagLibrary(JSON.parse(stdout));}
 async load(refresh=false){
  if(this.value&&!refresh)return this.value;
  if(this.loading)return this.loading;
  this.loading=this.read(refresh).finally(()=>this.loading=null);return this.loading;
 }
 async read(refresh){
  let local;try{local=validateTagLibrary(JSON.parse(await fs.readFile(this.file,'utf8')));}catch{}
  let library=local||validateTagLibrary(JSON.parse(await fs.readFile(path.join(this.service.bundle,'assets/weilin-tags.json'),'utf8')));
  // Only the integration's own Weilin database is eligible. Provenance in an
  // imported snapshot must never become a runtime dependency on another app.
  const database=path.join(this.service.data,'weilin/user_data/userdatas_zh_CN_tags.db');
  let warning='';
  if(existsSync(database))try{
   const stat=await fs.stat(database);
   if(refresh||!local||Math.abs(stat.mtimeMs-(local.source.mtimeMs||0))>2||stat.size!==local.source.bytes){library=await this.readDatabase(database);const {atomicJson}=await import('./service.mjs');await atomicJson(this.file,library);}
  }catch(error){warning='同步未完成，保留上次完整词库：'+error.message;}
  this.value={...library,tags:flattenTagLibrary(library),...(warning?{warning}:{})};return this.value;
 }
}
